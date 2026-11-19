import { paymentSource, type FinanceState } from "./finance-presentation";
import type { Intervention, Invoice, Payment } from "./types";

export type WorkflowStepId = "appointment" | "service" | "payment";
export type WorkflowStepState = "done" | "current" | "pending";

export interface InterventionWorkflowStep {
  id: WorkflowStepId;
  label: string;
  detail: string;
  state: WorkflowStepState;
}

export function getInterventionWorkflow(
  intervention: Intervention,
  invoice: Invoice | undefined,
  payments: Payment[],
) {
  const serviceDone = intervention.status === "completed";
  const appointmentDone = serviceDone || (Boolean(intervention.startAt) && intervention.status !== "to_schedule");
  const relatedPayments = payments.filter((p) => p.interventionId === intervention.id || (invoice && p.invoiceId === invoice.id));
  const source = paymentSource(relatedPayments);
  const bankLinked = source === "qonto" || source === "mixed";
  const interventionTotal = intervention.items.reduce((sum, item) => sum + item.revenueAllocated, 0);
  const payableTotal = interventionTotal > 0 ? interventionTotal : (invoice?.totalIncludingTax ?? 0);
  const paidAmount = relatedPayments.reduce((sum, p) => sum + p.amount, 0);
  const contractManaged = Boolean(intervention.maintenanceContractId);
  const paid = contractManaged || (payableTotal > 0 && paidAmount >= payableTotal);
  const outstanding = contractManaged ? 0 : Math.max(payableTotal - paidAmount, 0);
  const paymentState: FinanceState = contractManaged ? { label: "Incluse au contrat", tone: "violet" }
    : paidAmount > 0 ? { label: (paid ? "Encaissée" : "Paiement partiel") + (source === "qonto" ? " · Qonto" : source === "mixed" ? " · sources mixtes" : ""), tone: paid ? "emerald" : "amber" }
    : intervention.status === "cancelled" ? { label: "Annulée", tone: "neutral" }
    : payableTotal <= 0 ? { label: "Sans montant", tone: "neutral" }
    : serviceDone ? { label: "À encaisser", tone: "amber" } : { label: "Montant prévu", tone: "blue" };
  const completed = [appointmentDone, serviceDone, paid];
  const currentIndex = completed.findIndex((value) => !value);
  const details = [
    intervention.startAt ? "Créneau défini" : serviceDone ? "Réalisée sans créneau renseigné" : "À planifier",
    serviceDone ? "Terminée" : intervention.status === "in_progress" ? "En cours" : "À réaliser",
    contractManaged ? "Géré par l’entretien mensuel" : paid ? "Encaissée" : paidAmount > 0 ? "Paiement partiel" : "À encaisser",
  ];
  const labels = ["Rendez-vous", "Prestation", "Encaissement"];
  const ids: WorkflowStepId[] = ["appointment", "service", "payment"];
  const steps: InterventionWorkflowStep[] = ids.map((id, index) => ({
    id,
    label: labels[index] ?? id,
    detail: details[index] ?? "",
    state: completed[index] ? "done" : index === currentIndex ? "current" : "pending",
  }));

  return {
    steps,
    currentStep: intervention.status === "cancelled" ? null : (steps.find((step) => step.state === "current")?.id ?? null),
    isComplete: completed.every(Boolean),
    isCancelled: intervention.status === "cancelled",
    paidAmount,
    payableTotal,
    relatedPayments,
    source,
    bankLinked,
    paymentState,
    isPaid: paid && !contractManaged,
    outstanding,
    hasInvoice: Boolean(invoice),
    paymentMode: contractManaged ? "maintenance" as const : invoice ? "invoice" as const : source === "qonto" ? "qonto" as const : source === "mixed" ? "mixed" as const : paidAmount > 0 ? "manual" as const : null,
  };
}
