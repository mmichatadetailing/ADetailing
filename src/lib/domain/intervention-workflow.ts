import { paymentStatusForInvoice, paymentsForIntervention, paymentsForInvoice } from "./calculations";
import type { Intervention, Invoice, Payment } from "./types";

export type WorkflowStepId = "appointment" | "service" | "invoice" | "payment";
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
  const invoiceDone = Boolean(invoice && invoice.status !== "cancelled") || directPaidAmount > 0;
  const payableTotal = invoice?.totalIncludingTax ?? intervention.items.reduce((sum, item) => sum + item.revenueAllocated, 0);
  const paidAmount = invoice ? paymentsForInvoice(invoice.id, payments) : directPaidAmount;
  const paid = invoice ? paymentStatusForInvoice(invoice, payments) === "paid" : payableTotal > 0 && paidAmount >= payableTotal;
  const outstanding = invoice || directPaidAmount > 0 ? Math.max(payableTotal - paidAmount, 0) : 0;
  const completed = [appointmentDone, serviceDone, invoiceDone, paid];
  const currentIndex = completed.findIndex((value) => !value);
  const details = [
    intervention.startAt ? "Créneau défini" : "À planifier",
    serviceDone ? "Terminée" : intervention.status === "in_progress" ? "En cours" : "À réaliser",
    invoice ? invoice.number : directPaidAmount > 0 ? "Sans facture" : "Facture ou paiement manuel",
    paid ? "Encaissée" : paidAmount > 0 ? "Paiement partiel" : "À encaisser",
  ];
  const labels = ["Rendez-vous", "Prestation", "Facture", "Paiement"];
  const ids: WorkflowStepId[] = ["appointment", "service", "invoice", "payment"];
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
    paymentMode: invoice ? "invoice" as const : directPaidAmount > 0 ? "manual" as const : null,
  };
}
