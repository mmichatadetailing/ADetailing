import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const leadSchema = z.object({
  kind: z.literal("lead"), prospectName: z.string().min(2), phone: z.string().min(6), email: z.email().or(z.literal("")), vehicleLabel: z.string().min(2), serviceLabel: z.string().min(2), estimatedAmount: z.number().min(0), source: z.string().min(1), ownerId: z.uuid().optional(),
});
const clientSchema = z.object({
  kind: z.literal("client"), clientKind: z.enum(["individual", "business"]), company: z.string().optional(), firstName: z.string().min(2), lastName: z.string().min(2), email: z.email().or(z.literal("")), phone: z.string().min(6), city: z.string().min(2), source: z.string().min(1),
  vehicle: z.object({ make: z.string(), model: z.string(), registration: z.string(), format: z.string() }).optional(),
});
const expenseSchema = z.object({
  kind: z.literal("expense"), date: z.iso.date(), family: z.enum(["fixed", "variable", "investment", "personal"]), category: z.string().min(2), supplier: z.string().min(2), description: z.string().min(2), amountIncludingTax: z.number().positive(), vatRateBasisPoints: z.number().min(0).max(10000), paid: z.boolean(),
});
const quickCreateSchema = z.discriminatedUnion("kind", [leadSchema, clientSchema, expenseSchema]);

export async function POST(request: Request) {
  try {
    const input = quickCreateSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const { data: membership, error: membershipError } = await supabase.from("organization_members").select("organization_id,location_id").eq("profile_id", user.id).eq("active", true).limit(1).single();
    if (membershipError || !membership) throw membershipError ?? new Error("Espace de travail introuvable.");
    const organizationId = membership.organization_id;
    const locationId = membership.location_id;
    const { data: source } = await supabase.from("lead_sources").select("id").eq("organization_id", organizationId).eq("name", "source" in input ? input.source : "").maybeSingle();

    if (input.kind === "lead") {
      let ownerId = user.id;
      if (input.ownerId) {
        const { data: owner } = await supabase.from("organization_members").select("profile_id").eq("organization_id", organizationId).eq("profile_id", input.ownerId).eq("active", true).maybeSingle();
        if (owner) ownerId = owner.profile_id;
      }
      const { data, error } = await supabase.from("leads").insert({ organization_id: organizationId, location_id: locationId, prospect_name: input.prospectName.trim(), phone: input.phone.trim(), email: input.email.trim().toLowerCase(), vehicle_label: input.vehicleLabel.trim(), service_label: input.serviceLabel.trim(), estimated_amount_cents: input.estimatedAmount, source_id: source?.id ?? null, stage: "received", owner_id: ownerId, next_action: "Qualifier la demande", created_by: user.id }).select("id").single();
      if (error) throw error;
      await supabase.from("activity_logs").insert({ organization_id: organizationId, actor_id: user.id, kind: "lead_created", title: "Nouvelle demande", description: input.prospectName.trim(), entity_type: "lead", entity_id: data.id });
      return NextResponse.json({ id: data.id }, { status: 201 });
    }

    if (input.kind === "client") {
      const { data, error } = await supabase.from("clients").insert({ organization_id: organizationId, location_id: locationId, kind: input.clientKind, company: input.company?.trim() || null, first_name: input.firstName.trim(), last_name: input.lastName.trim(), email: input.email.trim().toLowerCase(), phone: input.phone.trim(), city: input.city.trim(), lead_source_id: source?.id ?? null, owner_id: user.id, notes: "", created_by: user.id }).select("id").single();
      if (error) throw error;
      if (input.vehicle?.make.trim()) {
        const { data: format } = await supabase.from("vehicle_formats").select("id").eq("organization_id", organizationId).eq("name", input.vehicle.format).maybeSingle();
        const { error: vehicleError } = await supabase.from("vehicles").insert({ organization_id: organizationId, location_id: locationId, client_id: data.id, format_id: format?.id ?? null, make: input.vehicle.make.trim(), model: input.vehicle.model.trim(), registration: input.vehicle.registration.trim().toUpperCase(), created_by: user.id });
        if (vehicleError) throw vehicleError;
      }
      await supabase.from("activity_logs").insert({ organization_id: organizationId, actor_id: user.id, kind: "lead_created", title: "Nouveau client", description: `${input.firstName} ${input.lastName}`, entity_type: "client", entity_id: data.id });
      return NextResponse.json({ id: data.id }, { status: 201 });
    }

    const excludingTax = Math.round(input.amountIncludingTax / (1 + input.vatRateBasisPoints / 10000));
    const vatAmount = input.amountIncludingTax - excludingTax;
    const { data, error } = await supabase.from("expenses").insert({ organization_id: organizationId, location_id: locationId, expense_date: input.date, family: input.family, category: input.category.trim(), supplier: input.supplier.trim(), description: input.description.trim(), amount_including_tax_cents: input.amountIncludingTax, amount_excluding_tax_cents: excludingTax, vat_rate_basis_points: input.vatRateBasisPoints, vat_amount_cents: vatAmount, vat_recoverable: input.family !== "personal", recurrence: "one_off", allocated_month: `${input.date.slice(0, 7)}-01`, paid: input.paid, paid_at: input.paid ? new Date().toISOString() : null, created_by: user.id }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Les informations saisies sont invalides.", details: error.flatten() }, { status: 400 });
    console.error("Quick create failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enregistrement impossible." }, { status: 500 });
  }
}

