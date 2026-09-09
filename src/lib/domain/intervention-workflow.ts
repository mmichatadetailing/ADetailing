import { paymentsForIntervention, paymentsForInvoice } from "./calculations";
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
  const appointmentDone = Boolean(intervention.startAt) && intervention.status !== "to_schedule";
  const serviceDone = intervention.status === "completed";
  const directPaidAmount = paymentsForIntervention(intervention.id, payments);
  const interventionTotal = intervention.items.reduce((sum, item) => sum + item.revenueAllocated, 0);
  const payableTotal = interventionTotal > 0 ? interventionTotal : (invoice?.totalIncludingTax ?? 0);
  const invoicePaidAmount = invoice ? paymentsForInvoice(invoice.id, payments) : 0;
  const paidAmount = directPaidAmount + invoicePaidAmount;
  const paid = payableTotal > 0 && paidAmount >= payableTotal;
  const outstanding = Math.max(payableTotal - paidAmount, 0);
  const completed = [appointmentDone, serviceDone, paid];
  const currentIndex = completed.findIndex((value) => !value);
  const details = [
    intervention.startAt ? "Créneau défini" : "À planifier",
    serviceDone ? "Terminée" : intervention.status === "in_progress" ? "En cours" : "À réaliser",
    paid ? "Encaissée" : paidAmount > 0 ? "Paiement partiel" : "À encaisser",
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
    isComplete: paid,
    isCancelled: intervention.status === "cancelled",
    paidAmount,
    outstanding,
    hasInvoice: Boolean(invoice),
    paymentMode: invoice ? "invoice" as const : directPaidAmount > 0 ? "manual" as const : null,
  };
}
