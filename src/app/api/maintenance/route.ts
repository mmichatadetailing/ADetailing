import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageBusiness, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const contractFields = {
  clientId: z.uuid(),
  serviceId: z.uuid().nullable().optional(),
  title: z.string().trim().min(2).max(160),
  status: z.enum(["active", "paused", "ended"]),
  billingFrequency: z.enum(["monthly", "annual"]),
  billingAmount: z.number().int().positive().max(100_000_000_000),
  vehicleCount: z.number().int().min(1).max(1000),
  firstVisitOn: z.iso.date(),
  preferredStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  plannedDurationMinutes: z.number().int().min(15).max(1440),
  assignedMemberIds: z.array(z.uuid()).min(1).max(12).refine((ids) => new Set(ids).size === ids.length),
  address: z.string().trim().max(300),
  notes: z.string().trim().max(3000),
  endsOn: z.iso.date().nullable().optional(),
};

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contractFields }),
  z.object({ action: z.literal("update"), contractId: z.uuid(), ...contractFields }),
  z.object({ action: z.literal("generate"), contractId: z.uuid(), through: z.iso.date() }),
  z.object({ action: z.literal("setPayment"), periodId: z.uuid(), paid: z.boolean(), paidAt: z.iso.datetime(), method: z.string().trim().min(2).max(80) }),
]);

function addMonths(dateKey: string, months: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ensureNoError(error: { message?: string } | null) {
  if (error) throw new Error(error.message || "Enregistrement impossible.");
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!canManageBusiness(workspace.role)) {
      return NextResponse.json({ error: "Cette action est réservée aux administrateurs et associés." }, { status: 403 });
    }

    if (input.action === "setPayment") {
      if (input.paid && new Date(input.paidAt).getTime() > Date.now()) {
        throw new Error("La date du paiement ne peut pas être dans le futur.");
      }
      const { data, error } = await supabase.rpc("set_maintenance_billing_paid", {
        target_period: input.periodId,
        mark_paid: input.paid,
        payment_date: input.paidAt,
        payment_method_name: input.method,
      });
      ensureNoError(error);
      return NextResponse.json({ ok: true, id: data });
    }

    if (input.action === "generate") {
      const { data, error } = await supabase.rpc("generate_maintenance_schedule", {
        target_contract: input.contractId,
        target_through: input.through,
      });
      ensureNoError(error);
      return NextResponse.json({ ok: true, generated: data ?? 0 });
    }

    const { data: client, error: clientError } = await supabase.from("clients")
      .select("id")
      .eq("organization_id", workspace.organizationId)
      .eq("id", input.clientId)
      .is("archived_at", null)
      .maybeSingle();
    ensureNoError(clientError);
    if (!client) throw new Error("Client introuvable ou supprimé.");

    if (input.serviceId) {
      const { data: service, error: serviceError } = await supabase.from("services")
        .select("id,kind")
        .eq("organization_id", workspace.organizationId)
        .eq("id", input.serviceId)
        .is("archived_at", null)
        .maybeSingle();
      ensureNoError(serviceError);
      if (!service) throw new Error("Formule d’entretien introuvable.");
      if (service.kind !== "subscription") throw new Error("Sélectionnez une formule de type abonnement.");
    }

    const { data: members, error: membersError } = await supabase.from("organization_members")
      .select("id,profile_id")
      .eq("organization_id", workspace.organizationId)
      .eq("active", true);
    ensureNoError(membersError);
    const availableMemberIds = new Set((members ?? []).flatMap((member) => [member.id, member.profile_id].filter(Boolean)));
    if (input.assignedMemberIds.some((memberId) => !availableMemberIds.has(memberId))) {
      throw new Error("Un collaborateur sélectionné n’est plus actif dans cette équipe.");
    }
    if (input.endsOn && input.endsOn < input.firstVisitOn) throw new Error("La date de fin doit suivre la première visite.");
    const visitDay = Number(input.firstVisitOn.slice(8, 10));
    if (visitDay < 1 || visitDay > 28) throw new Error("La première visite doit être fixée entre le 1er et le 28 du mois.");

    const row = {
      organization_id: workspace.organizationId,
      location_id: workspace.locationId,
      client_id: input.clientId,
      service_id: input.serviceId || null,
      title: input.title,
      status: input.status,
      billing_frequency: input.billingFrequency,
      billing_amount_cents: input.billingAmount,
      vehicle_count: input.vehicleCount,
      first_visit_on: input.firstVisitOn,
      visit_day: visitDay,
      preferred_start_time: input.preferredStartTime,
      planned_duration_minutes: input.plannedDurationMinutes,
      assigned_member_ids: input.assignedMemberIds,
      address: input.address,
      notes: input.notes,
      ends_on: input.endsOn || null,
    };

    if (input.action === "create") {
      const { data: contract, error } = await supabase.from("maintenance_contracts")
        .insert({ ...row, created_by: workspace.user.id })
        .select("id")
        .single();
      ensureNoError(error);
      if (!contract) throw new Error("Contrat d’entretien introuvable après création.");
      const through = addMonths(input.firstVisitOn, 11);
      const { error: generationError } = await supabase.rpc("generate_maintenance_schedule", { target_contract: contract.id, target_through: through });
      ensureNoError(generationError);
      return NextResponse.json({ ok: true, id: contract.id }, { status: 201 });
    }

    const { data: existing, error: existingError } = await supabase.from("maintenance_contracts")
      .select("id,generated_through")
      .eq("organization_id", workspace.organizationId)
      .eq("id", input.contractId)
      .is("archived_at", null)
      .maybeSingle();
    ensureNoError(existingError);
    if (!existing) throw new Error("Contrat d’entretien introuvable.");

    const { error } = await supabase.from("maintenance_contracts")
      .update(row)
      .eq("organization_id", workspace.organizationId)
      .eq("id", input.contractId);
    ensureNoError(error);
    const through = existing.generated_through && existing.generated_through > input.firstVisitOn
      ? existing.generated_through
      : addMonths(input.firstVisitOn, 11);
    const { error: refreshError } = await supabase.rpc("refresh_maintenance_schedule", { target_contract: input.contractId, target_through: through });
    ensureNoError(refreshError);
    return NextResponse.json({ ok: true, id: input.contractId });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Les informations du contrat sont invalides.", details: error.flatten() }, { status: 400 });
    console.error("Maintenance contract action failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Modification impossible." }, { status: 500 });
  }
}

