import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceTermEndDate } from "@/lib/domain/maintenance";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageBusiness, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const contractFields = {
  clientId: z.uuid(),
  serviceId: z.uuid().nullable().optional(),
  title: z.string().trim().min(2).max(160),
  status: z.enum(["active", "paused", "ended"]),
  billingFrequency: z.enum(["monthly", "annual", "prepaid"]),
  billingAmount: z.number().int().positive().max(100_000_000_000),
  termMonths: z.number().int().min(1).max(36).nullable().optional(),
  renewalReminderDays: z.number().int().min(7).max(90),
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
  z.object({ action: z.literal("renew"), contractId: z.uuid() }),
  z.object({ action: z.literal("archive"), contractId: z.uuid() }),
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

    if (input.action === "renew") {
      const { data, error } = await supabase.rpc("renew_maintenance_contract", { target_contract: input.contractId });
      ensureNoError(error);
      const renewal = Array.isArray(data) ? data[0] : data;
      return NextResponse.json({ ok: true, generated: renewal?.generated_count ?? 0, endsOn: renewal?.new_ends_on });
    }

    if (input.action === "archive") {
      const { data, error } = await supabase.rpc("archive_maintenance_contract", { target_contract: input.contractId });
      ensureNoError(error);
      return NextResponse.json({ ok: true, id: data });
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
    if (input.billingFrequency === "prepaid" && !input.termMonths) throw new Error("Choisissez une durée comprise entre 1 et 36 mois.");
    const visitDay = Number(input.firstVisitOn.slice(8, 10));
    if (visitDay < 1 || visitDay > 28) throw new Error("La première visite doit être fixée entre le 1er et le 28 du mois.");

    let existing: Record<string, unknown> | null = null;
    if (input.action === "update") {
      const { data, error } = await supabase.from("maintenance_contracts")
        .select("id,generated_through,billing_frequency,term_months,first_visit_on,ends_on")
        .eq("organization_id", workspace.organizationId)
        .eq("id", input.contractId)
        .is("archived_at", null)
        .maybeSingle();
      ensureNoError(error);
      if (!data) throw new Error("Contrat d’entretien introuvable.");
      existing = data;

      const structuralTermsChanged = data.billing_frequency !== input.billingFrequency
        || Number(data.term_months ?? 0) !== Number(input.termMonths ?? 0)
        || data.first_visit_on !== input.firstVisitOn;
      if (structuralTermsChanged) {
        const [visitsResult, billingResult] = await Promise.all([
          supabase.from("interventions").select("id,status,start_at").eq("organization_id", workspace.organizationId).eq("maintenance_contract_id", input.contractId).is("archived_at", null),
          supabase.from("maintenance_billing_periods").select("id,status").eq("organization_id", workspace.organizationId).eq("contract_id", input.contractId),
        ]);
        ensureNoError(visitsResult.error);
        ensureNoError(billingResult.error);
        const now = new Date().toISOString();
        const hasHistory = (visitsResult.data ?? []).some((visit) => visit.status === "completed" || Boolean(visit.start_at && visit.start_at < now))
          || (billingResult.data ?? []).some((period) => period.status === "paid");
        if (hasHistory) throw new Error("Le rythme, la durée et la date d’origine sont verrouillés car ce contrat possède déjà un historique. Créez un nouveau contrat pour changer ces éléments.");
      }
    }

    const preserveFixedTermEnd = existing?.billing_frequency === "prepaid"
      && input.billingFrequency === "prepaid"
      && existing.first_visit_on === input.firstVisitOn
      && Number(existing.term_months) === Number(input.termMonths)
      && typeof existing.ends_on === "string";
    const fixedTermEnd = input.billingFrequency === "prepaid"
      ? preserveFixedTermEnd ? existing!.ends_on as string : maintenanceTermEndDate(input.firstVisitOn, input.termMonths!)
      : input.endsOn || null;
    const row = {
      organization_id: workspace.organizationId,
      location_id: workspace.locationId,
      client_id: input.clientId,
      service_id: input.serviceId || null,
      title: input.title,
      status: input.status,
      billing_frequency: input.billingFrequency,
      billing_amount_cents: input.billingAmount,
      term_months: input.billingFrequency === "prepaid" ? input.termMonths : null,
      renewal_reminder_days: input.renewalReminderDays,
      vehicle_count: input.vehicleCount,
      first_visit_on: input.firstVisitOn,
      visit_day: visitDay,
      preferred_start_time: input.preferredStartTime,
      planned_duration_minutes: input.plannedDurationMinutes,
      assigned_member_ids: input.assignedMemberIds,
      address: input.address,
      notes: input.notes,
      ends_on: fixedTermEnd,
    };

    if (input.action === "create") {
      const { data: contract, error } = await supabase.from("maintenance_contracts")
        .insert({ ...row, created_by: workspace.user.id })
        .select("id")
        .single();
      ensureNoError(error);
      if (!contract) throw new Error("Contrat d’entretien introuvable après création.");
      const through = input.billingFrequency === "prepaid" ? fixedTermEnd! : addMonths(input.firstVisitOn, 11);
      const { error: generationError } = await supabase.rpc("generate_maintenance_schedule", { target_contract: contract.id, target_through: through });
      ensureNoError(generationError);
      return NextResponse.json({ ok: true, id: contract.id }, { status: 201 });
    }

    const { error } = await supabase.from("maintenance_contracts")
      .update(row)
      .eq("organization_id", workspace.organizationId)
      .eq("id", input.contractId);
    ensureNoError(error);
    const existingGeneratedThrough = typeof existing?.generated_through === "string" ? existing.generated_through : undefined;
    const through = input.billingFrequency === "prepaid" ? fixedTermEnd! : existingGeneratedThrough && existingGeneratedThrough > input.firstVisitOn
      ? existingGeneratedThrough
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

