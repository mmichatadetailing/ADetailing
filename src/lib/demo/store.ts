"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { paymentStatusForInvoice } from "@/lib/domain/calculations";
import type {
  AppData,
  AppSettings,
  Client,
  Expense,
  Intervention,
  InterventionStatus,
  Lead,
  LeadStage,
  MonthlyObjective,
  Payment,
  Service,
  Vehicle,
} from "@/lib/domain/types";
import { normalizePhone } from "@/lib/utils";
import { normalizeText } from "@/lib/utils";
import type { ParsedHenrriDocument } from "@/lib/import/henrri-parser";
import type { HistoricalImportPreview } from "@/lib/import/xlsx-importer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { queueWorkspaceMutation, type WorkspaceMutation } from "@/lib/supabase/sync";
import { ALBAN_ID, demoSeed, DEMO_LOCATION_ID, DEMO_ORG_ID } from "./seed";

const createId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const persistMutation = (mutation: WorkspaceMutation) => {
  if (isSupabaseConfigured) queueWorkspaceMutation(mutation);
};
const entityBase = () => ({
  id: createId(),
  organizationId: DEMO_ORG_ID,
  locationId: DEMO_LOCATION_ID,
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

export interface NewClientInput {
  kind: "individual" | "business";
  company?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  source: string;
  vehicle?: {
    make: string;
    model: string;
    registration: string;
    format: string;
  };
}

export interface NewLeadInput {
  prospectName: string;
  phone: string;
  email: string;
  vehicleLabel: string;
  serviceLabel: string;
  estimatedAmount: number;
  source: string;
  ownerId: string;
}

export interface NewExpenseInput {
  date: string;
  family: Expense["family"];
  category: string;
  supplier: string;
  description: string;
  amountIncludingTax: number;
  vatRateBasisPoints: number;
  paid: boolean;
}

export interface NewServiceInput {
  name: string;
  kind: Service["kind"];
  category: string;
  price: number;
  targetDurationMinutes: number;
  targetProductCost: number;
}

export interface NewAppointmentInput {
  clientId: string;
  vehicleFormat?: string;
  serviceId?: string;
  title: string;
  startAt: string;
  plannedDurationMinutes: number;
  workerIds: string[];
  address: string;
  revenueAllocated: number;
  completed: boolean;
}

export interface InterventionEditInput {
  clientId: string;
  vehicleId?: string;
  vehicleFormat?: string;
  title: string;
  status: InterventionStatus;
  startAt?: string;
  plannedDurationMinutes: number;
  address: string;
  notes?: string;
  workers: Array<{ memberId: string; plannedMinutes: number }>;
  items: Array<{ id?: string; serviceId?: string; label: string; quantity: number; revenueAllocated: number }>;
}

interface DemoActions {
  hydrateFromSupabase: (data: AppData) => void;
  resetDemo: () => void;
  addClient: (input: NewClientInput) => string;
  mergeClients: (primaryId: string, duplicateId: string) => void;
  addLead: (input: NewLeadInput) => string;
  moveLead: (leadId: string, stage: LeadStage) => void;
  addExpense: (input: NewExpenseInput) => string;
  addAppointment: (input: NewAppointmentInput) => string;
  addPayment: (invoiceId: string, amount: number, method: string) => string;
  addInterventionPayment: (interventionId: string, amount: number, method: string, paidAt: string) => string;
  updateInterventionPayment: (paymentId: string, input: { amount: number; method: string; paidAt: string }) => void;
  importHenrriDocument: (document: ParsedHenrriDocument, fileName: string) => string;
  linkInvoiceToQuote: (invoiceId: string, quoteId: string) => void;
  linkInvoiceToIntervention: (interventionId: string, invoiceId?: string) => void;
  updateIntervention: (interventionId: string, input: InterventionEditInput) => void;
  setInterventionStatus: (interventionId: string, status: InterventionStatus) => void;
  updateInterventionActuals: (
    interventionId: string,
    input: { actualDurationMinutes: number; productCost: number; travelCost: number; otherDirectCosts: number; workerMinutes: Record<string, number> },
  ) => void;
  incrementChecklist: (interventionId: string) => void;
  rescheduleIntervention: (interventionId: string, startAt: string, endAt: string) => void;
  addService: (input: NewServiceInput) => string;
  duplicateService: (serviceId: string) => string | null;
  archiveService: (serviceId: string) => void;
  reorderService: (serviceId: string, direction: -1 | 1) => void;
  updateObjective: (month: string, patch: Partial<MonthlyObjective>) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  addMessage: (body: string, entityType?: AppData["messages"][number]["entityType"], entityId?: string) => string;
  addTeamMember: (input: { firstName: string; lastName: string; email: string; role: "partner" | "employee"; weeklyCapacityMinutes: number }) => string;
  updateTeamMember: (memberId: string, patch: Partial<AppData["team"][number]>) => void;
  applyHistoricalPreview: (preview: HistoricalImportPreview) => { created: number; skipped: number; warnings: number };
}

export type DemoStore = AppData & DemoActions;

function activity(
  kind: AppData["activities"][number]["kind"],
  title: string,
  description: string,
  entityType?: string,
  entityId?: string,
) {
  return {
    ...entityBase(),
    kind,
    title,
    description,
    actorId: ALBAN_ID,
    occurredAt: nowIso(),
    entityType,
    entityId,
  };
}

export const useDemoStore = create<DemoStore>()(
  persist(
    (set, get) => ({
      ...structuredClone(demoSeed),
      hydrateFromSupabase: (data) => set(structuredClone(data)),
      resetDemo: () => set(structuredClone(demoSeed)),
      addClient: (input) => {
        const client: Client = {
          ...entityBase(),
          kind: input.kind,
          company: input.company,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email: input.email.trim().toLowerCase(),
          phone: normalizePhone(input.phone),
          address: "",
          postalCode: "",
          city: input.city.trim(),
          source: input.source,
          ownerId: ALBAN_ID,
          notes: "",
        };
        const vehicle: Vehicle | null = input.vehicle?.make
          ? {
              ...entityBase(),
              clientId: client.id,
              make: input.vehicle.make,
              model: input.vehicle.model,
              registration: input.vehicle.registration.toUpperCase(),
              format: input.vehicle.format,
            }
          : null;
        set((state) => ({
          clients: [client, ...state.clients],
          vehicles: vehicle ? [vehicle, ...state.vehicles] : state.vehicles,
          activities: [
            activity("lead_created", "Nouveau client", `${client.firstName} ${client.lastName}`, "client", client.id),
            ...state.activities,
          ],
        }));
        return client.id;
      },
      mergeClients: (primaryId, duplicateId) => {
        set((state) => {
          if (primaryId === duplicateId) return state;
          const primary = state.clients.find((client) => client.id === primaryId);
          const duplicate = state.clients.find((client) => client.id === duplicateId);
          if (!primary || !duplicate) return state;
          const mergedClient: Client = {
            ...primary,
            company: primary.company || duplicate.company,
            email: primary.email || duplicate.email,
            phone: primary.phone || duplicate.phone,
            address: primary.address || duplicate.address,
            postalCode: primary.postalCode || duplicate.postalCode,
            city: primary.city || duplicate.city,
            siret: primary.siret || duplicate.siret,
            vatNumber: primary.vatNumber || duplicate.vatNumber,
            notes: [primary.notes, duplicate.notes].filter(Boolean).join("\n"),
            updatedAt: nowIso(),
          };
          return {
            clients: state.clients.filter((client) => client.id !== duplicateId).map((client) => client.id === primaryId ? mergedClient : client),
            vehicles: state.vehicles.map((vehicle) => vehicle.clientId === duplicateId ? { ...vehicle, clientId: primaryId, updatedAt: nowIso() } : vehicle),
            leads: state.leads.map((lead) => lead.clientId === duplicateId ? { ...lead, clientId: primaryId, updatedAt: nowIso() } : lead),
            quotes: state.quotes.map((quote) => quote.clientId === duplicateId ? { ...quote, clientId: primaryId, updatedAt: nowIso() } : quote),
            invoices: state.invoices.map((invoice) => invoice.clientId === duplicateId ? { ...invoice, clientId: primaryId, updatedAt: nowIso() } : invoice),
            interventions: state.interventions.map((item) => item.clientId === duplicateId ? { ...item, clientId: primaryId, updatedAt: nowIso() } : item),
            reviews: state.reviews.map((review) => review.clientId === duplicateId ? { ...review, clientId: primaryId, updatedAt: nowIso() } : review),
            activities: [
              activity("comment_added", "Clients fusionnés", `${duplicate.firstName} ${duplicate.lastName} → ${primary.firstName} ${primary.lastName}`, "client", primaryId),
              ...state.activities,
            ],
          };
        });
        persistMutation({ action: "mergeClients", primaryId, duplicateId });
      },
      addLead: (input) => {
        const lead: Lead = {
          ...entityBase(),
          prospectName: input.prospectName.trim(),
          phone: normalizePhone(input.phone),
          email: input.email.trim().toLowerCase(),
          vehicleLabel: input.vehicleLabel.trim(),
          serviceLabel: input.serviceLabel.trim(),
          estimatedAmount: input.estimatedAmount,
          source: input.source,
          stage: "received",
          ownerId: input.ownerId,
          requestedAt: nowIso(),
          nextAction: "Qualifier la demande",
        };
        set((state) => ({
          leads: [lead, ...state.leads],
          activities: [
            activity("lead_created", "Nouvelle demande", lead.prospectName, "lead", lead.id),
            ...state.activities,
          ],
        }));
        return lead.id;
      },
      moveLead: (leadId, stage) => {
        set((state) => ({
          leads: state.leads.map((lead) =>
            lead.id === leadId
              ? {
                  ...lead,
                  stage,
                  updatedAt: nowIso(),
                  nextAction:
                    stage === "won"
                      ? "Planifier la prestation"
                      : stage === "lost"
                        ? "Renseigner la raison de perte"
                        : lead.nextAction,
                }
              : lead,
          ),
        }));
        persistMutation({ action: "moveLead", leadId, stage });
      },
      addExpense: (input) => {
        const amountExcludingTax = Math.round(
          input.amountIncludingTax / (1 + input.vatRateBasisPoints / 10_000),
        );
        const expense: Expense = {
          ...entityBase(),
          date: input.date,
          family: input.family,
          category: input.category,
          supplier: input.supplier,
          description: input.description,
          amountIncludingTax: input.amountIncludingTax,
          amountExcludingTax,
          vatAmount: input.amountIncludingTax - amountExcludingTax,
          vatRecoverable: input.family !== "personal",
          recurrence: "one_off",
          allocatedMonth: input.date.slice(0, 7),
          paid: input.paid,
          paidAt: input.paid ? input.date : undefined,
          paymentMethod: input.paid ? "Carte" : undefined,
        };
        set((state) => ({
          expenses: [expense, ...state.expenses],
          assets: input.family === "investment"
            ? [{
                ...entityBase(),
                name: input.description,
                category: input.category,
                status: input.paid ? "in_service" as const : "to_buy" as const,
                priority: "medium" as const,
                priceIncludingTax: input.amountIncludingTax,
                expectedTimeGainMinutes: 0,
                expectedMonthlyRevenue: 0,
                supplier: input.supplier,
                commissionedAt: input.paid ? input.date : undefined,
              }, ...state.assets]
            : state.assets,
        }));
        return expense.id;
      },
      addAppointment: (input) => {
        const service = input.serviceId ? get().services.find((item) => item.id === input.serviceId) : undefined;
        const intervention: Intervention = {
          ...entityBase(),
          clientId: input.clientId,
          vehicleFormat: input.vehicleFormat,
          status: input.completed ? "completed" : "scheduled",
          title: input.title.trim(),
          startAt: input.startAt,
          endAt: new Date(new Date(input.startAt).getTime() + input.plannedDurationMinutes * 60_000).toISOString(),
          plannedDurationMinutes: input.plannedDurationMinutes,
          actualDurationMinutes: input.completed ? input.plannedDurationMinutes : undefined,
          preparationMinutes: 0,
          cleanupMinutes: 0,
          workers: [...new Set(input.workerIds)].map((memberId) => ({ memberId, plannedMinutes: input.plannedDurationMinutes, actualMinutes: input.completed ? input.plannedDurationMinutes : undefined })),
          items: [{ id: createId(), serviceId: service?.id, label: input.title.trim(), quantity: 1, revenueAllocated: input.revenueAllocated }],
          productCost: service?.targetProductCost ?? 0,
          travelCost: service?.targetTravelCost ?? 0,
          otherDirectCosts: 0,
          address: input.address.trim(),
          checklistDone: 0,
          checklistTotal: 0,
          depositAmount: 0,
        };
        set((state) => ({
          interventions: [intervention, ...state.interventions],
          activities: [activity("comment_added", input.completed ? "Prestation effectuée enregistrée" : "Rendez-vous créé", intervention.title, "intervention", intervention.id), ...state.activities],
        }));
        return intervention.id;
      },
      addPayment: (invoiceId, amount, method) => {
        const payment: Payment = {
          ...entityBase(),
          invoiceId,
          amount,
          paidAt: nowIso(),
          method,
        };
        const nextPayments = [payment, ...get().payments];
        set((state) => ({
          payments: nextPayments,
          invoices: state.invoices.map((invoice) =>
            invoice.id === invoiceId
              ? {
                  ...invoice,
                  paymentStatus: paymentStatusForInvoice(invoice, nextPayments),
                  updatedAt: nowIso(),
                }
              : invoice,
          ),
          activities: [
            activity("payment_added", "Paiement ajouté", `${amount / 100} €`, "invoice", invoiceId),
            ...state.activities,
          ],
        }));
        persistMutation({ action: "addPayment", invoiceId, amount, method });
        return payment.id;
      },
      addInterventionPayment: (interventionId, amount, method, paidAt) => {
        const payment: Payment = {
          ...entityBase(),
          interventionId,
          amount,
          paidAt,
          method,
        };
        set((state) => ({
          payments: [payment, ...state.payments],
          activities: [
            activity("payment_added", "Paiement manuel ajouté", `${amount / 100} €`, "intervention", interventionId),
            ...state.activities,
          ],
        }));
        persistMutation({ action: "addInterventionPayment", interventionId, amount, method, paidAt });
        return payment.id;
      },
      updateInterventionPayment: (paymentId, input) => {
        const currentPayment = get().payments.find((payment) => payment.id === paymentId && payment.interventionId);
        if (!currentPayment) return;
        set((state) => ({
          payments: state.payments.map((payment) => payment.id === paymentId ? { ...payment, amount: input.amount, method: input.method, paidAt: input.paidAt, updatedAt: nowIso() } : payment),
          activities: [
            activity("payment_added", "Paiement manuel modifié", `${input.amount / 100} €`, "intervention", currentPayment.interventionId),
            ...state.activities,
          ],
        }));
        persistMutation({ action: "updateInterventionPayment", paymentId, amount: input.amount, method: input.method, paidAt: input.paidAt });
      },
      importHenrriDocument: (document, fileName) => {
        const displayName = document.company || document.clientName || "Client à vérifier";
        const existingClient = get().clients.find((client) =>
          normalizeText(client.company || `${client.firstName} ${client.lastName}`) === normalizeText(displayName),
        );
        let clientId = existingClient?.id;
        if (!clientId) {
          const parts = displayName.trim().split(/\s+/);
          const importedClient: Client = {
            ...entityBase(),
            kind: document.professional ? "business" : "individual",
            company: document.professional ? displayName : undefined,
            firstName: document.professional ? "Contact" : (parts.shift() ?? "À"),
            lastName: document.professional ? displayName : (parts.join(" ") || "vérifier"),
            email: "",
            phone: "",
            address: "",
            postalCode: "",
            city: "",
            source: "Import Henrri",
            ownerId: ALBAN_ID,
            notes: "Créé depuis un document importé, coordonnées à vérifier.",
          };
          clientId = importedClient.id;
          set((state) => ({ clients: [importedClient, ...state.clients] }));
        }
        const documentId = createId();
        const baseDocument = {
          ...entityBase(),
          id: documentId,
          number: document.number || `À-VÉRIFIER-${documentId.slice(0, 8)}`,
          clientId,
          issuedAt: document.date ?? nowIso(),
          totalExcludingTax: document.totalExcludingTax ?? document.totalIncludingTax ?? 0,
          totalTax: document.totalTax ?? 0,
          totalIncludingTax: document.totalIncludingTax ?? 0,
          lines: document.lines.map((line) => ({
            id: createId(),
            designation: line.designation,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            netAmount: line.netAmount,
            vatRateBasisPoints: line.vatRateBasisPoints,
          })),
          sourceFileName: fileName,
        };
        if (document.documentType === "quote") {
          const quote = {
            ...baseDocument,
            status: "imported" as const,
            paymentTerms: document.paymentTerms,
          };
          set((state) => {
            const existing = state.quotes.find((item) => item.number === quote.number);
            return {
              quotes: existing ? state.quotes.map((item) => item.id === existing.id ? { ...quote, id: existing.id, createdAt: existing.createdAt } : item) : [quote, ...state.quotes],
              activities: [activity("quote_imported", "Devis importé", quote.number, "quote", existing?.id ?? quote.id), ...state.activities],
            };
          });
        } else {
          const invoice = {
            ...baseDocument,
            status: "issued" as const,
            paymentStatus: "unpaid" as const,
            dueAt: document.dueDate,
            expectedPaymentMethod: document.paymentMethod,
          };
          set((state) => {
            const existing = state.invoices.find((item) => item.number === invoice.number);
            return {
              invoices: existing ? state.invoices.map((item) => item.id === existing.id ? { ...invoice, id: existing.id, createdAt: existing.createdAt } : item) : [invoice, ...state.invoices],
              activities: [activity("invoice_imported", "Facture importée", invoice.number, "invoice", existing?.id ?? invoice.id), ...state.activities],
            };
          });
        }
        persistMutation({ action: "importHenrriDocument", document, fileName });
        return documentId;
      },
      linkInvoiceToQuote: (invoiceId, quoteId) => {
        set((state) => ({
          invoices: state.invoices.map((invoice) => invoice.id === invoiceId ? { ...invoice, quoteId, updatedAt: nowIso() } : invoice),
        }));
        persistMutation({ action: "linkInvoiceToQuote", invoiceId, quoteId });
      },
      linkInvoiceToIntervention: (interventionId, invoiceId) => {
        set((state) => ({
          interventions: state.interventions.map((item) => item.id === interventionId ? { ...item, invoiceId, updatedAt: nowIso() } : item),
        }));
        persistMutation({ action: "linkInvoiceToIntervention", interventionId, invoiceId: invoiceId ?? null });
      },
      updateIntervention: (interventionId, input) => {
        set((state) => ({
          interventions: state.interventions.map((item) => {
            if (item.id !== interventionId) return item;
            const nextStatus = input.status === "to_schedule" && input.startAt ? "scheduled" : input.status;
            return {
              ...item,
              clientId: input.clientId,
              vehicleId: input.vehicleId,
              vehicleFormat: input.vehicleFormat,
              quoteId: input.clientId === item.clientId ? item.quoteId : undefined,
              invoiceId: input.clientId === item.clientId ? item.invoiceId : undefined,
              title: input.title.trim(),
              status: nextStatus,
              startAt: input.startAt,
              endAt: input.startAt ? new Date(new Date(input.startAt).getTime() + input.plannedDurationMinutes * 60_000).toISOString() : undefined,
              plannedDurationMinutes: input.plannedDurationMinutes,
              address: input.address.trim(),
              notes: input.notes?.trim() || undefined,
              workers: input.workers.map((worker) => ({
                ...worker,
                actualMinutes: item.workers.find((existing) => existing.memberId === worker.memberId)?.actualMinutes,
              })),
              items: input.items.map((line) => ({ ...line, id: line.id ?? createId() })),
              updatedAt: nowIso(),
            };
          }),
        }));
        persistMutation({ action: "updateIntervention", interventionId, ...input });
      },
      setInterventionStatus: (interventionId, status) => {
        set((state) => ({
          interventions: state.interventions.map((item) =>
            item.id === interventionId ? { ...item, status, updatedAt: nowIso() } : item,
          ),
        }));
        persistMutation({ action: "setInterventionStatus", interventionId, status });
      },
      updateInterventionActuals: (interventionId, input) => {
        set((state) => ({
          interventions: state.interventions.map((item) =>
            item.id === interventionId
              ? {
                  ...item,
                  status: "completed",
                  actualDurationMinutes: Math.max(0, input.actualDurationMinutes),
                  productCost: Math.max(0, input.productCost),
                  travelCost: Math.max(0, input.travelCost),
                  otherDirectCosts: Math.max(0, input.otherDirectCosts),
                  workers: item.workers.map((worker) => ({
                    ...worker,
                    actualMinutes: Math.max(0, input.workerMinutes[worker.memberId] ?? worker.plannedMinutes),
                  })),
                  checklistDone: item.checklistTotal,
                  updatedAt: nowIso(),
                }
              : item,
          ),
        }));
        persistMutation({ action: "completeIntervention", interventionId, ...input });
      },
      incrementChecklist: (interventionId) => {
        set((state) => ({
          interventions: state.interventions.map((item) =>
            item.id === interventionId
              ? { ...item, checklistDone: Math.min(item.checklistDone + 1, item.checklistTotal), updatedAt: nowIso() }
              : item,
          ),
        }));
        persistMutation({ action: "incrementChecklist", interventionId });
      },
      rescheduleIntervention: (interventionId, startAt, endAt) => {
        set((state) => ({
          interventions: state.interventions.map((item) =>
            item.id === interventionId
              ? { ...item, startAt, endAt, status: item.status === "to_schedule" ? "scheduled" : item.status, updatedAt: nowIso() }
              : item,
          ),
          activities: [
            activity("intervention_moved", "Prestation déplacée", new Date(startAt).toLocaleString("fr-FR"), "intervention", interventionId),
            ...state.activities,
          ],
        }));
        persistMutation({ action: "rescheduleIntervention", interventionId, startAt, endAt });
      },
      addService: (input) => {
        const service: Service = {
          ...entityBase(),
          kind: input.kind,
          category: input.category,
          name: input.name,
          clientDescription: "Description à compléter",
          internalDescription: "",
          prices: [{ vehicleFormat: "Tous formats", amount: input.price }],
          targetDurationMinutes: input.targetDurationMinutes,
          targetProductCost: input.targetProductCost,
          targetTravelCost: 0,
          targetHourlyMargin: get().settings.hourlyMarginTarget,
          vatRateBasisPoints: get().settings.standardVatBasisPoints,
          active: true,
          displayOrder: get().services.length + 1,
          aliases: [],
          recommendedWorkers: 1,
          photosRequired: false,
        };
        set((state) => ({ services: [...state.services, service] }));
        persistMutation({ action: "addService", ...input });
        return service.id;
      },
      duplicateService: (serviceId) => {
        const source = get().services.find((service) => service.id === serviceId);
        if (!source) return null;
        const copy: Service = {
          ...structuredClone(source),
          ...entityBase(),
          name: `${source.name} — copie`,
          displayOrder: get().services.length + 1,
          archivedAt: undefined,
          active: false,
        };
        set((state) => ({ services: [...state.services, copy] }));
        persistMutation({ action: "duplicateService", serviceId });
        return copy.id;
      },
      archiveService: (serviceId) => {
        set((state) => ({
          services: state.services.map((service) =>
            service.id === serviceId
              ? { ...service, active: false, archivedAt: nowIso(), updatedAt: nowIso() }
              : service,
          ),
        }));
        persistMutation({ action: "archiveService", serviceId });
      },
      reorderService: (serviceId, direction) => {
        set((state) => {
          const ordered = [...state.services].sort((a, b) => a.displayOrder - b.displayOrder);
          const index = ordered.findIndex((service) => service.id === serviceId);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= ordered.length) return state;
          const currentService = ordered[index];
          const targetService = ordered[target];
          if (!currentService || !targetService) return state;
          const currentOrder = currentService.displayOrder;
          const targetOrder = targetService.displayOrder;
          return {
            services: state.services.map((service) =>
              service.id === currentService.id
                ? { ...service, displayOrder: targetOrder, updatedAt: nowIso() }
                : service.id === targetService.id
                  ? { ...service, displayOrder: currentOrder, updatedAt: nowIso() }
                  : service,
            ),
          };
        });
        persistMutation({ action: "reorderService", serviceId, direction });
      },
      updateObjective: (month, patch) => {
        set((state) => {
          const existing = state.objectives.find((objective) => objective.month === month);
          const objectives = existing
            ? state.objectives.map((objective) =>
                objective.month === month ? { ...objective, ...patch, updatedAt: nowIso() } : objective,
              )
            : [
                ...state.objectives,
                {
                  ...entityBase(),
                  month,
                  revenueTarget: 0,
                  interventionTarget: 0,
                  averageBasketTarget: state.settings.averageBasketTarget,
                  hourlyMarginTarget: state.settings.hourlyMarginTarget,
                  reviewTarget: state.settings.monthlyReviewTarget,
                  ...patch,
                },
              ];
          return {
            objectives,
            activities: [
              activity("objective_updated", "Objectif mis à jour", month, "monthly_objective", existing?.id),
              ...state.activities,
            ],
          };
        });
        if (patch.revenueTarget !== undefined) persistMutation({ action: "updateObjective", month, revenueTarget: patch.revenueTarget });
      },
      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      addMessage: (body, entityType, entityId) => {
        const message = {
          ...entityBase(),
          channel: entityType ? "entity" as const : "general" as const,
          entityType,
          entityId,
          authorId: ALBAN_ID,
          body: body.trim(),
          sentAt: nowIso(),
          readBy: [ALBAN_ID],
        };
        set((state) => ({
          messages: [...state.messages, message],
          activities: [activity("comment_added", "Commentaire ajouté", body.slice(0, 80), entityType, entityId), ...state.activities],
        }));
        return message.id;
      },
      addTeamMember: (input) => {
        const member = {
          ...entityBase(),
          firstName: input.firstName,
          lastName: input.lastName,
          initials: `${input.firstName[0] ?? ""}${input.lastName[0] ?? ""}`.toUpperCase(),
          email: input.email,
          phone: "",
          role: input.role,
          color: "#a78bfa",
          active: true,
          weeklyCapacityMinutes: input.weeklyCapacityMinutes,
        };
        set((state) => ({ team: [...state.team, member] }));
        return member.id;
      },
      updateTeamMember: (memberId, patch) =>
        set((state) => ({ team: state.team.map((member) => member.id === memberId ? { ...member, ...patch, updatedAt: nowIso() } : member) })),
      applyHistoricalPreview: (preview) => {
        const report = { created: 0, skipped: 0, warnings: preview.errors.length + preview.warnings.length };
        set((state) => {
          const clients = [...state.clients];
          const vehicles = [...state.vehicles];
          const interventions = [...state.interventions];
          const expenses = [...state.expenses];
          const objectives = [...state.objectives];
          const leads = [...state.leads];
          const clientKey = (client: Client) => client.email || client.phone || normalizeText(`${client.company ?? ""} ${client.firstName} ${client.lastName}`);
          preview.normalized.clients.forEach((row) => {
            const key = row.email || row.phone || normalizeText(`${row.company ?? ""} ${row.firstName} ${row.lastName}`);
            if (clients.some((client) => client.legacyRow === row.legacyRow || clientKey(client) === key)) { report.skipped += 1; return; }
            clients.push({ ...entityBase(), legacyRow: row.legacyRow, kind: row.company ? "business" : "individual", company: row.company, firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone, address: "", postalCode: "", city: row.city, source: row.source, ownerId: ALBAN_ID, notes: "Import historique" });
            report.created += 1;
          });
          preview.normalized.interventions.forEach((row) => {
            if (interventions.some((item) => item.legacyRow === row.legacyRow)) { report.skipped += 1; return; }
            const client = clients.find((item) => clientKey(item) === row.clientKey || normalizeText(item.company || `${item.firstName} ${item.lastName}`) === normalizeText(row.clientName));
            if (!client) { report.warnings += 1; return; }
            let vehicle = vehicles.find((item) => item.clientId === client.id);
            if (!vehicle) {
              vehicle = { ...entityBase(), clientId: client.id, make: "Véhicule", model: "historique", registration: "", format: "Autre", notes: "À compléter après import" };
              vehicles.push(vehicle);
              report.created += 1;
            }
            interventions.push({ ...entityBase(), legacyRow: row.legacyRow, clientId: client.id, vehicleId: vehicle.id, status: "completed", title: row.serviceLabel, startAt: row.interventionDate, endAt: row.interventionDate && row.actualMinutes ? new Date(new Date(row.interventionDate).getTime() + row.actualMinutes * 60_000).toISOString() : undefined, plannedDurationMinutes: row.actualMinutes, actualDurationMinutes: row.actualMinutes || undefined, workers: [{ memberId: ALBAN_ID, plannedMinutes: row.actualMinutes, actualMinutes: row.actualMinutes || undefined }], items: [{ id: createId(), label: row.serviceLabel, revenueAllocated: row.revenueCents, quantity: 1 }], productCost: row.productCostCents, travelCost: row.travelCostCents, otherDirectCosts: 0, address: "", checklistDone: 0, checklistTotal: 0, depositAmount: 0, notes: row.notes });
            report.created += 1;
          });
          preview.normalized.expenses.forEach((row) => {
            if (expenses.some((item) => item.legacyRow === row.legacyRow)) { report.skipped += 1; return; }
            const excludingTax = Math.round(row.amountCents / 1.2);
            expenses.push({ ...entityBase(), legacyRow: row.legacyRow, date: row.date ?? nowIso(), family: row.family, category: row.category, supplier: row.supplier, description: row.description, amountIncludingTax: row.amountCents, amountExcludingTax: excludingTax, vatAmount: row.amountCents - excludingTax, vatRecoverable: row.family !== "personal", recurrence: row.recurrence, allocatedMonth: (row.date ?? nowIso()).slice(0, 7), paid: row.paid, paidAt: row.paid ? row.date : undefined });
            report.created += 1;
          });
          preview.normalized.objectives.forEach((row) => {
            if (!row.month) { report.warnings += 1; return; }
            const existingIndex = objectives.findIndex((item) => item.month === row.month);
            const value = { ...entityBase(), legacyRow: row.legacyRow, month: row.month, revenueTarget: row.revenueTargetCents, interventionTarget: row.interventionTarget, averageBasketTarget: row.averageBasketTargetCents, hourlyMarginTarget: row.hourlyMarginTargetCents, reviewTarget: row.reviewTarget };
            if (existingIndex >= 0) { objectives[existingIndex] = { ...objectives[existingIndex]!, ...value, id: objectives[existingIndex]!.id, createdAt: objectives[existingIndex]!.createdAt }; report.skipped += 1; }
            else { objectives.push(value); report.created += 1; }
          });
          preview.normalized.leads.forEach((row) => {
            if (leads.some((lead) => lead.legacyRow === row.legacyRow)) { report.skipped += 1; return; }
            const historicalStatus = normalizeText(row.stage);
            const stage = historicalStatus.includes("perdu") ? "lost" : historicalStatus.includes("accepte") || historicalStatus.includes("gagne") ? "won" : historicalStatus.includes("relance") ? "follow_up" : historicalStatus.includes("envoye") ? "quote_sent" : "received";
            leads.push({ ...entityBase(), legacyRow: row.legacyRow, prospectName: row.prospectName, phone: row.phone, email: "", vehicleLabel: "À compléter", serviceLabel: row.serviceLabel, estimatedAmount: row.amountCents, source: row.source, stage, ownerId: ALBAN_ID, requestedAt: nowIso(), nextAction: stage === "won" ? "Historique importé" : "À vérifier après import" });
            report.created += 1;
          });
          return { clients, vehicles, interventions, expenses, objectives, leads, activities: [activity("comment_added", "Import historique appliqué", `${report.created} éléments créés · ${report.skipped} ignorés`, "document_import"), ...state.activities] };
        });
        return report;
      },
    }),
    {
      name: "adetailing-pilotage-demo-v1",
      storage: createJSONStorage(() => isSupabaseConfigured ? {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      } : localStorage),
      version: 1,
      partialize: (state) => ({
        team: state.team,
        clients: state.clients,
        vehicles: state.vehicles,
        leads: state.leads,
        services: state.services,
        quotes: state.quotes,
        invoices: state.invoices,
        payments: state.payments,
        interventions: state.interventions,
        expenses: state.expenses,
        assets: state.assets,
        objectives: state.objectives,
        reviews: state.reviews,
        activities: state.activities,
        messages: state.messages,
        settings: state.settings,
      }),
    },
  ),
);
