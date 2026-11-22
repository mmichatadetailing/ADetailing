import { isRecordedBy } from "./periods";
import type { Intervention, Invoice, Payment } from "./types";

/** One receipt can reference both the service and its invoice. Keep that row once. */
export function interventionBalance(job: Intervention, invoice: Invoice | undefined, payments: Payment[], reference = new Date()) {
  const relatedPayments = payments.filter(p => p.interventionId === job.id || Boolean(invoice && p.invoiceId === invoice.id));
  const paidAmount = relatedPayments.reduce((sum, p) => sum + (isRecordedBy(p.paidAt, reference) ? p.amount : 0), 0);
  const lineTotal = job.items.reduce((sum, item) => sum + item.revenueAllocated, 0);
  const payableTotal = lineTotal > 0 ? lineTotal : invoice?.totalIncludingTax ?? 0;
  const outstanding = job.maintenanceContractId || job.status === "cancelled" ? 0 : Math.max(payableTotal - paidAmount, 0);
  return { relatedPayments, paidAmount, payableTotal, outstanding };
}
