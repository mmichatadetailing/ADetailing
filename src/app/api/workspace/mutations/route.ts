import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";
import { normalizeText } from "@/lib/utils";

const leadStages = ["received", "qualify", "quote_to_prepare", "quote_sent", "follow_up", "won", "lost"] as const;
const interventionStatuses = ["to_schedule", "scheduled", "confirmed", "in_progress", "completed", "cancelled"] as const;
const serviceKinds = ["formula", "option", "subscription", "pack"] as const;

const henrriLineSchema = z.object({
  designation: z.string(),
  description: z.string().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  discount: z.number(),
  netAmount: z.number(),
  vatRateBasisPoints: z.number(),
}).passthrough();

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("moveLead"), leadId: z.uuid(), stage: z.enum(leadStages) }),
  z.object({ action: z.literal("rescheduleIntervention"), interventionId: z.uuid(), startAt: z.iso.datetime(), endAt: z.iso.datetime() }),
  z.object({ action: z.literal("setInterventionStatus"), interventionId: z.uuid(), status: z.enum(interventionStatuses) }),
  z.object({
    action: z.literal("updateIntervention"), interventionId: z.uuid(), clientId: z.uuid(), vehicleId: z.uuid().optional(), vehicleFormat: z.enum(["Citadine", "Berline", "SUV", "Monospace", "4x4", "Fourgon", "Autre"]).optional(), title: z.string().trim().min(2).max(160), status: z.enum(interventionStatuses), startAt: z.iso.datetime().nullable().optional(), plannedDurationMinutes: z.number().int().min(15).max(1440), address: z.string().trim().max(300), notes: z.string().trim().max(3000).nullable().optional(),
    workers: z.array(z.object({ memberId: z.uuid(), plannedMinutes: z.number().int().min(0).max(1440) })).min(1).max(12).refine((workers) => new Set(workers.map((worker) => worker.memberId)).size === workers.length),
    items: z.array(z.object({ id: z.uuid().optional(), serviceId: z.uuid().nullable().optional(), label: z.string().trim().min(2).max(200), quantity: z.number().positive().max(100), revenueAllocated: z.number().int().min(0) })).min(1).max(30),
  }),
  z.object({ action: z.literal("completeIntervention"), interventionId: z.uuid(), actualDurationMinutes: z.number().int().min(0), productCost: z.number().int().min(0), travelCost: z.number().int().min(0), otherDirectCosts: z.number().int().min(0), workerMinutes: z.record(z.string(), z.number().int().min(0)) }),
  z.object({ action: z.literal("incrementChecklist"), interventionId: z.uuid() }),
  z.object({ action: z.literal("addService"), name: z.string().trim().min(2), kind: z.enum(serviceKinds), category: z.string().trim().min(2), price: z.number().int().min(0), targetDurationMinutes: z.number().int().positive(), targetProductCost: z.number().int().min(0) }),
  z.object({ action: z.literal("duplicateService"), serviceId: z.uuid() }),
  z.object({ action: z.literal("archiveService"), serviceId: z.uuid() }),
  z.object({ action: z.literal("reorderService"), serviceId: z.uuid(), direction: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ action: z.literal("updateObjective"), month: z.string().regex(/^\d{4}-\d{2}$/), revenueTarget: z.number().int().min(0) }),
  z.object({ action: z.literal("mergeClients"), primaryId: z.uuid(), duplicateId: z.uuid() }),
  z.object({ action: z.literal("addPayment"), invoiceId: z.uuid(), amount: z.number().int().positive(), method: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("addInterventionPayment"), interventionId: z.uuid(), amount: z.number().int().positive(), method: z.string().trim().min(2).max(80), paidAt: z.iso.datetime() }),
  z.object({ action: z.literal("updateInterventionPayment"), paymentId: z.uuid(), amount: z.number().int().positive(), method: z.string().trim().min(2).max(80), paidAt: z.iso.datetime() }),
  z.object({ action: z.literal("linkInvoiceToIntervention"), interventionId: z.uuid(), invoiceId: z.uuid().nullable() }),
  z.object({ action: z.literal("linkInvoiceToQuote"), invoiceId: z.uuid(), quoteId: z.uuid() }),
  z.object({ action: z.literal("importHenrriDocument"), fileName: z.string().trim().min(1).max(255), document: z.object({
    documentType: z.enum(["quote", "invoice"]),
    number: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    professional: z.boolean(),
    totalExcludingTax: z.number().nullable().optional(),
    totalTax: z.number().nullable().optional(),
    totalIncludingTax: z.number().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    paymentMethod: z.string().nullable().optional(),
    lines: z.array(henrriLineSchema),
  }).passthrough() }),
]);

function ensureNoError(error: { message?: string } | null) {
  if (error) throw new Error(error.message || "Écriture Supabase impossible.");
}

export async function POST(request: Request) {
  try {
    const input = mutationSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const organizationId = workspace.organizationId;
    const locationId = workspace.locationId;
    const userId = workspace.user.id;

    if (input.action === "moveLead") {
      const nextAction = input.stage === "won" ? "Planifier la prestation" : input.stage === "lost" ? "Renseigner la raison de perte" : undefined;
      const patch: Record<string, unknown> = { stage: input.stage };
      if (nextAction) patch.next_action = nextAction;
      const { error } = await supabase.from("leads").update(patch).eq("organization_id", organizationId).eq("id", input.leadId);
      ensureNoError(error);
    }

    if (input.action === "rescheduleIntervention") {
      const { data: intervention, error: readError } = await supabase.from("interventions").select("status").eq("organization_id", organizationId).eq("id", input.interventionId).single();
      ensureNoError(readError);
      if (!intervention) throw new Error("Intervention introuvable.");
      const { error } = await supabase.from("interventions").update({ start_at: input.startAt, end_at: input.endAt, status: intervention.status === "to_schedule" ? "scheduled" : intervention.status }).eq("organization_id", organizationId).eq("id", input.interventionId);
      ensureNoError(error);
    }

    if (input.action === "setInterventionStatus") {
      const { error } = await supabase.from("interventions").update({ status: input.status }).eq("organization_id", organizationId).eq("id", input.interventionId);
      ensureNoError(error);
    }

    if (input.action === "updateIntervention") {
      const { data: existingIntervention, error: existingError } = await supabase.from("interventions").select("client_id,quote_id,invoice_id").eq("organization_id", organizationId).eq("id", input.interventionId).single();
      ensureNoError(existingError);
      if (!existingIntervention) throw new Error("Prestation introuvable.");
      if (input.vehicleId) {
        const { data: vehicle, error: vehicleError } = await supabase.from("vehicles").select("id,client_id").eq("organization_id", organizationId).eq("id", input.vehicleId).single();
        ensureNoError(vehicleError);
        if (!vehicle || vehicle.client_id !== input.clientId) throw new Error("Le véhicule ne correspond pas au client sélectionné.");
      }
      const { data: members, error: membersError } = await supabase.from("organization_members").select("profile_id").eq("organization_id", organizationId).eq("active", true).in("profile_id", input.workers.map((worker) => worker.memberId));
      ensureNoError(membersError);
      if ((members?.length ?? 0) !== input.workers.length) throw new Error("Un collaborateur sélectionné n’est plus actif dans cette équipe.");

      const startAt = input.startAt ?? null;
      const endAt = startAt ? new Date(new Date(startAt).getTime() + input.plannedDurationMinutes * 60_000).toISOString() : null;
      const status = !startAt && ["scheduled", "confirmed"].includes(input.status) ? "to_schedule" : startAt && input.status === "to_schedule" ? "scheduled" : input.status;
      const clientChanged = existingIntervention.client_id !== input.clientId;
      const { error } = await supabase.from("interventions").update({ client_id: input.clientId, vehicle_id: input.vehicleId ?? null, vehicle_format: input.vehicleFormat ?? null, quote_id: clientChanged ? null : existingIntervention.quote_id, invoice_id: clientChanged ? null : existingIntervention.invoice_id, title: input.title, status, start_at: startAt, end_at: endAt, planned_duration_minutes: input.plannedDurationMinutes, address: input.address, notes: input.notes || null }).eq("organization_id", organizationId).eq("id", input.interventionId);
      ensureNoError(error);

      const { data: existingWorkers, error: existingWorkersError } = await supabase.from("intervention_workers").select("profile_id,actual_minutes").eq("organization_id", organizationId).eq("intervention_id", input.interventionId);
      ensureNoError(existingWorkersError);
      const workersDelete = await supabase.from("intervention_workers").delete().eq("organization_id", organizationId).eq("intervention_id", input.interventionId);
      ensureNoError(workersDelete.error);
      const workersInsert = await supabase.from("intervention_workers").insert(input.workers.map((worker) => ({ organization_id: organizationId, intervention_id: input.interventionId, profile_id: worker.memberId, planned_minutes: worker.plannedMinutes, actual_minutes: existingWorkers?.find((existing) => existing.profile_id === worker.memberId)?.actual_minutes ?? null })));
      ensureNoError(workersInsert.error);

      const itemsDelete = await supabase.from("intervention_items").delete().eq("organization_id", organizationId).eq("intervention_id", input.interventionId);
      ensureNoError(itemsDelete.error);
      const itemsInsert = await supabase.from("intervention_items").insert(input.items.map((item) => ({ organization_id: organizationId, intervention_id: input.interventionId, service_id: item.serviceId || null, label: item.label, quantity: item.quantity, revenue_allocated_cents: item.revenueAllocated })));
      ensureNoError(itemsInsert.error);
    }

    if (input.action === "completeIntervention") {
      const { error } = await supabase.from("interventions").update({ status: "completed", actual_duration_minutes: input.actualDurationMinutes, product_cost_cents: input.productCost, travel_cost_cents: input.travelCost, other_direct_costs_cents: input.otherDirectCosts }).eq("organization_id", organizationId).eq("id", input.interventionId);
      ensureNoError(error);
      for (const [profileId, actualMinutes] of Object.entries(input.workerMinutes)) {
        const { error: workerError } = await supabase.from("intervention_workers").update({ actual_minutes: actualMinutes }).eq("organization_id", organizationId).eq("intervention_id", input.interventionId).eq("profile_id", profileId);
        ensureNoError(workerError);
      }
      const { error: checklistError } = await supabase.from("intervention_checklist_items").update({ completed: true, completed_at: new Date().toISOString(), completed_by: userId }).eq("organization_id", organizationId).eq("intervention_id", input.interventionId).eq("completed", false);
      ensureNoError(checklistError);
    }

    if (input.action === "incrementChecklist") {
      const { data: item, error: readError } = await supabase.from("intervention_checklist_items").select("id").eq("organization_id", organizationId).eq("intervention_id", input.interventionId).eq("completed", false).order("display_order").limit(1).maybeSingle();
      ensureNoError(readError);
      if (item) {
        const { error } = await supabase.from("intervention_checklist_items").update({ completed: true, completed_at: new Date().toISOString(), completed_by: userId }).eq("id", item.id);
        ensureNoError(error);
      }
    }

    if (input.action === "addService") {
      const categoryResult = await supabase.from("service_categories").select("id").eq("organization_id", organizationId).eq("name", input.category).limit(1).maybeSingle();
      ensureNoError(categoryResult.error);
      let category = categoryResult.data;
      if (!category) {
        const result = await supabase.from("service_categories").insert({ organization_id: organizationId, name: input.category }).select("id").single();
        ensureNoError(result.error);
        category = result.data;
      }
      if (!category) throw new Error("Catégorie introuvable.");
      const { data: lastServices, error: orderError } = await supabase.from("services").select("display_order").eq("organization_id", organizationId).order("display_order", { ascending: false }).limit(1);
      ensureNoError(orderError);
      const { data: service, error } = await supabase.from("services").insert({ organization_id: organizationId, kind: input.kind, category_id: category.id, name: input.name, client_description: "Description à compléter", internal_description: "", target_duration_minutes: input.targetDurationMinutes, target_product_cost_cents: input.targetProductCost, target_hourly_margin_cents: 0, display_order: (lastServices?.[0]?.display_order ?? 0) + 1, created_by: userId }).select("id").single();
      ensureNoError(error);
      if (!service) throw new Error("Offre introuvable après création.");
      const { error: priceError } = await supabase.from("service_prices").insert({ organization_id: organizationId, service_id: service.id, vehicle_format_id: null, amount_cents: input.price, created_by: userId });
      ensureNoError(priceError);
      return NextResponse.json({ ok: true, id: service.id });
    }

    if (input.action === "duplicateService") {
      const { data: source, error: sourceError } = await supabase.from("services").select("*,service_prices(*),service_aliases(*)").eq("organization_id", organizationId).eq("id", input.serviceId).single();
      ensureNoError(sourceError);
      if (!source) throw new Error("Offre introuvable.");
      const { data: service, error } = await supabase.from("services").insert({ organization_id: organizationId, kind: source.kind, category_id: source.category_id, name: `${source.name} — copie ${Date.now().toString().slice(-4)}`, client_description: source.client_description, internal_description: source.internal_description, target_duration_minutes: source.target_duration_minutes, target_product_cost_cents: source.target_product_cost_cents, target_travel_cost_cents: source.target_travel_cost_cents, target_hourly_margin_cents: source.target_hourly_margin_cents, vat_rate_basis_points: source.vat_rate_basis_points, checklist_template_id: source.checklist_template_id, recommended_workers: source.recommended_workers, photos_required: source.photos_required, active: false, display_order: source.display_order + 1, created_by: userId }).select("id").single();
      ensureNoError(error);
      if (!service) throw new Error("Copie introuvable après création.");
      if (source.service_prices?.length) {
        const { error: pricesError } = await supabase.from("service_prices").insert(source.service_prices.map((price: Record<string, unknown>) => ({ organization_id: organizationId, service_id: service.id, vehicle_format_id: price.vehicle_format_id, amount_cents: price.amount_cents, valid_from: price.valid_from, valid_until: price.valid_until, created_by: userId })));
        ensureNoError(pricesError);
      }
      return NextResponse.json({ ok: true, id: service.id });
    }

    if (input.action === "archiveService") {
      const { error } = await supabase.from("services").update({ active: false, archived_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", input.serviceId);
      ensureNoError(error);
    }

    if (input.action === "reorderService") {
      const { data: services, error: readError } = await supabase.from("services").select("id,display_order").eq("organization_id", organizationId).is("archived_at", null).order("display_order");
      ensureNoError(readError);
      const index = services?.findIndex((service) => service.id === input.serviceId) ?? -1;
      const targetIndex = index + input.direction;
      if (index >= 0 && services && targetIndex >= 0 && targetIndex < services.length) {
        const current = services[index];
        const target = services[targetIndex];
        if (!current || !target) throw new Error("Ordre de catalogue invalide.");
        const first = await supabase.from("services").update({ display_order: target.display_order }).eq("organization_id", organizationId).eq("id", current.id);
        ensureNoError(first.error);
        const second = await supabase.from("services").update({ display_order: current.display_order }).eq("organization_id", organizationId).eq("id", target.id);
        ensureNoError(second.error);
      }
    }

    if (input.action === "updateObjective") {
      const month = `${input.month}-01`;
      const { error } = await supabase.from("monthly_objectives").upsert({ organization_id: organizationId, location_id: locationId, month, revenue_target_cents: input.revenueTarget, created_by: userId }, { onConflict: "organization_id,location_id,month" });
      ensureNoError(error);
    }

    if (input.action === "mergeClients") {
      if (input.primaryId === input.duplicateId) throw new Error("Les deux clients sont identiques.");
      const { data: clientRows, error: clientsError } = await supabase.from("clients").select("*").eq("organization_id", organizationId).in("id", [input.primaryId, input.duplicateId]);
      ensureNoError(clientsError);
      const primary = clientRows?.find((client) => client.id === input.primaryId);
      const duplicate = clientRows?.find((client) => client.id === input.duplicateId);
      if (!primary || !duplicate) throw new Error("Client introuvable.");
      const references = ["vehicles", "leads", "quotes", "invoices", "interventions", "reviews"] as const;
      for (const table of references) {
        const { error } = await supabase.from(table).update({ client_id: input.primaryId }).eq("organization_id", organizationId).eq("client_id", input.duplicateId);
        ensureNoError(error);
      }
      const { error: primaryError } = await supabase.from("clients").update({ company: primary.company || duplicate.company, email: primary.email || duplicate.email, phone: primary.phone || duplicate.phone, address: primary.address || duplicate.address, postal_code: primary.postal_code || duplicate.postal_code, city: primary.city || duplicate.city, siret: primary.siret || duplicate.siret, vat_number: primary.vat_number || duplicate.vat_number, notes: [primary.notes, duplicate.notes].filter(Boolean).join("\n") }).eq("id", input.primaryId);
      ensureNoError(primaryError);
      const { error: archiveError } = await supabase.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", input.duplicateId);
      ensureNoError(archiveError);
    }

    if (input.action === "addPayment") {
      const { data: invoice, error: invoiceError } = await supabase.from("invoices").select("total_including_tax_cents").eq("organization_id", organizationId).eq("id", input.invoiceId).single();
      ensureNoError(invoiceError);
      if (!invoice) throw new Error("Facture introuvable.");
      const { data: payments, error: paymentsError } = await supabase.from("payments").select("amount_cents").eq("organization_id", organizationId).eq("invoice_id", input.invoiceId);
      ensureNoError(paymentsError);
      const alreadyPaid = payments?.reduce((sum, payment) => sum + Number(payment.amount_cents), 0) ?? 0;
      if (alreadyPaid + input.amount > Number(invoice.total_including_tax_cents)) throw new Error("Le paiement dépasse le solde restant.");
      const { data, error } = await supabase.from("payments").insert({ organization_id: organizationId, location_id: locationId, invoice_id: input.invoiceId, amount_cents: input.amount, paid_at: new Date().toISOString(), method: input.method, created_by: userId }).select("id").single();
      ensureNoError(error);
      if (!data) throw new Error("Paiement introuvable après création.");
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (input.action === "addInterventionPayment") {
      if (new Date(input.paidAt).getTime() > Date.now()) throw new Error("La date du paiement ne peut pas être dans le futur.");
      const { data: intervention, error: interventionError } = await supabase.from("interventions").select("id,status,invoice_id").eq("organization_id", organizationId).eq("id", input.interventionId).single();
      ensureNoError(interventionError);
      if (!intervention) throw new Error("Prestation introuvable.");
      if (intervention.status !== "completed") throw new Error("La prestation doit être terminée avant d’enregistrer son paiement.");
      if (intervention.invoice_id) throw new Error("Cette prestation possède déjà une facture : enregistrez le paiement sur la facture.");
      const { data: items, error: itemsError } = await supabase.from("intervention_items").select("revenue_allocated_cents").eq("organization_id", organizationId).eq("intervention_id", input.interventionId);
      ensureNoError(itemsError);
      const total = items?.reduce((sum, item) => sum + Number(item.revenue_allocated_cents), 0) ?? 0;
      if (total <= 0) throw new Error("Renseignez le montant de la prestation avant de valider son paiement.");
      const { data: payments, error: paymentsError } = await supabase.from("payments").select("amount_cents").eq("organization_id", organizationId).eq("intervention_id", input.interventionId);
      ensureNoError(paymentsError);
      const alreadyPaid = payments?.reduce((sum, payment) => sum + Number(payment.amount_cents), 0) ?? 0;
      if (alreadyPaid + input.amount > total) throw new Error("Le paiement dépasse le solde restant de la prestation.");
      const { data, error } = await supabase.from("payments").insert({ organization_id: organizationId, location_id: locationId, invoice_id: null, intervention_id: input.interventionId, amount_cents: input.amount, paid_at: input.paidAt, method: input.method, created_by: userId }).select("id").single();
      ensureNoError(error);
      if (!data) throw new Error("Paiement introuvable après création.");
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (input.action === "updateInterventionPayment") {
      if (new Date(input.paidAt).getTime() > Date.now()) throw new Error("La date du paiement ne peut pas être dans le futur.");
      const { data: payment, error: paymentError } = await supabase.from("payments").select("id,intervention_id").eq("organization_id", organizationId).eq("id", input.paymentId).single();
      ensureNoError(paymentError);
      if (!payment?.intervention_id) throw new Error("Paiement manuel introuvable.");
      const { data: items, error: itemsError } = await supabase.from("intervention_items").select("revenue_allocated_cents").eq("organization_id", organizationId).eq("intervention_id", payment.intervention_id);
      ensureNoError(itemsError);
      const total = items?.reduce((sum, item) => sum + Number(item.revenue_allocated_cents), 0) ?? 0;
      const { data: otherPayments, error: otherPaymentsError } = await supabase.from("payments").select("amount_cents").eq("organization_id", organizationId).eq("intervention_id", payment.intervention_id).neq("id", input.paymentId);
      ensureNoError(otherPaymentsError);
      const paidExcludingCurrent = otherPayments?.reduce((sum, item) => sum + Number(item.amount_cents), 0) ?? 0;
      if (paidExcludingCurrent + input.amount > total) throw new Error("Le paiement dépasse le montant total de la prestation.");
      const { error } = await supabase.from("payments").update({ amount_cents: input.amount, method: input.method, paid_at: input.paidAt }).eq("organization_id", organizationId).eq("id", input.paymentId);
      ensureNoError(error);
      return NextResponse.json({ ok: true, id: input.paymentId });
    }

    if (input.action === "linkInvoiceToIntervention") {
      const { data: intervention, error: interventionError } = await supabase.from("interventions").select("id,client_id").eq("organization_id", organizationId).eq("id", input.interventionId).single();
      ensureNoError(interventionError);
      if (!intervention) throw new Error("Prestation introuvable.");
      if (input.invoiceId) {
        const { data: directPayment, error: directPaymentError } = await supabase.from("payments").select("id").eq("organization_id", organizationId).eq("intervention_id", input.interventionId).limit(1).maybeSingle();
        ensureNoError(directPaymentError);
        if (directPayment) throw new Error("Cette prestation possède déjà un paiement manuel et ne peut plus être liée à une facture.");
        const { data: invoice, error: invoiceError } = await supabase.from("invoices").select("id,client_id").eq("organization_id", organizationId).eq("id", input.invoiceId).single();
        ensureNoError(invoiceError);
        if (!invoice || invoice.client_id !== intervention.client_id) throw new Error("Cette facture ne correspond pas au client de la prestation.");
      }
      const { error } = await supabase.from("interventions").update({ invoice_id: input.invoiceId }).eq("organization_id", organizationId).eq("id", input.interventionId);
      ensureNoError(error);
    }

    if (input.action === "linkInvoiceToQuote") {
      const { data: quote, error: quoteError } = await supabase.from("quotes").select("id").eq("organization_id", organizationId).eq("id", input.quoteId).single();
      ensureNoError(quoteError);
      if (!quote) throw new Error("Devis introuvable.");
      const { error } = await supabase.from("invoices").update({ quote_id: input.quoteId }).eq("organization_id", organizationId).eq("id", input.invoiceId);
      ensureNoError(error);
    }

    if (input.action === "importHenrriDocument") {
      const document = input.document;
      const displayName = document.company || document.clientName || "Client à vérifier";
      const { data: clients, error: clientsError } = await supabase.from("clients").select("id,company,first_name,last_name").eq("organization_id", organizationId).is("archived_at", null);
      ensureNoError(clientsError);
      let clientId = clients?.find((client) => normalizeText(client.company || `${client.first_name} ${client.last_name}`) === normalizeText(displayName))?.id;
      if (!clientId) {
        const parts = displayName.trim().split(/\s+/);
        const { data: client, error } = await supabase.from("clients").insert({ organization_id: organizationId, location_id: locationId, kind: document.professional ? "business" : "individual", company: document.professional ? displayName : null, first_name: document.professional ? "Contact" : (parts.shift() || "À"), last_name: document.professional ? displayName : (parts.join(" ") || "vérifier"), owner_id: userId, notes: "Créé depuis un document Henrri importé, coordonnées à vérifier.", created_by: userId }).select("id").single();
        ensureNoError(error);
        if (!client) throw new Error("Client introuvable après création.");
        clientId = client.id;
      }
      const number = document.number || `A-VERIFIER-${Date.now()}`;
      const table = document.documentType === "quote" ? "quotes" : "invoices";
      const common = { organization_id: organizationId, location_id: locationId, client_id: clientId, number, issued_at: document.date || new Date().toISOString().slice(0, 10), total_excluding_tax_cents: document.totalExcludingTax ?? document.totalIncludingTax ?? 0, total_tax_cents: document.totalTax ?? 0, total_including_tax_cents: document.totalIncludingTax ?? 0, source_file_path: input.fileName, created_by: userId };
      const documentRow = document.documentType === "quote" ? { ...common, status: "imported", payment_terms: document.paymentTerms ?? null } : { ...common, status: "issued", payment_status: "unpaid", due_at: document.dueDate ?? null, expected_payment_method: document.paymentMethod ?? null };
      const { data: savedDocument, error } = await supabase.from(table).upsert(documentRow as never, { onConflict: "organization_id,number" }).select("id").single();
      ensureNoError(error);
      if (!savedDocument) throw new Error("Document introuvable après import.");
      const itemTable = document.documentType === "quote" ? "quote_items" : "invoice_items";
      const parentKey = document.documentType === "quote" ? "quote_id" : "invoice_id";
      const { count, error: countError } = await supabase.from(itemTable).select("id", { count: "exact", head: true }).eq(parentKey, savedDocument.id);
      ensureNoError(countError);
      if ((count ?? 0) === 0 && document.lines.length > 0) {
        const { error: itemsError } = await supabase.from(itemTable).insert(document.lines.map((line) => ({ organization_id: organizationId, [parentKey]: savedDocument.id, designation: line.designation, description: line.description ?? null, quantity: line.quantity, unit_price_cents: line.unitPrice, discount_cents: line.discount, net_amount_cents: line.netAmount, vat_rate_basis_points: line.vatRateBasisPoints })));
        ensureNoError(itemsError);
      }
      return NextResponse.json({ ok: true, id: savedDocument.id });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La modification demandée est invalide.", details: error.flatten() }, { status: 400 });
    console.error("Workspace mutation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Modification impossible." }, { status: 500 });
  }
}
