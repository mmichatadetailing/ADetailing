import Decimal from "decimal.js";
import type {
  Expense,
  Intervention,
  Invoice,
  Lead,
  Money,
  MonthlyObjective,
  Payment,
  Quote,
} from "./types";

const cents = (value: Decimal.Value): Money => new Decimal(value).toDecimalPlaces(0).toNumber();

export function grossMargin(intervention: Intervention): Money {
  const revenue = intervention.items.reduce((sum, item) => sum.plus(item.revenueAllocated), new Decimal(0));
  return cents(
    revenue
      .minus(intervention.productCost)
      .minus(intervention.travelCost)
      .minus(intervention.otherDirectCosts),
  );
}

export function actualPersonMinutes(intervention: Intervention): number {
  return intervention.workers.reduce(
    (sum, worker) => sum + (worker.actualMinutes ?? worker.plannedMinutes),
    0,
  );
}

export function hourlyMargin(intervention: Intervention): Money | null {
  const minutes = actualPersonMinutes(intervention);
  if (minutes <= 0) return null;
  return cents(new Decimal(grossMargin(intervention)).mul(60).div(minutes));
}

export function calculateVat(amountExcludingTax: Money, vatRateBasisPoints: number): Money {
  return cents(new Decimal(amountExcludingTax).mul(vatRateBasisPoints).div(10_000));
}

export function inferDiscount(quantity: number, unitPrice: Money, netAmount: Money) {
  const gross = new Decimal(unitPrice).mul(quantity);
  if (gross.lte(0)) return { amount: 0, rateBasisPoints: 0, detected: false };
  const discount = gross.minus(netAmount);
  if (discount.lte(0)) return { amount: 0, rateBasisPoints: 0, detected: false };
  return {
    amount: cents(discount),
    rateBasisPoints: cents(discount.div(gross).mul(10_000)),
    detected: true,
  };
}

export function paymentsForInvoice(invoiceId: string, payments: Payment[]): Money {
  return payments
    .filter((payment) => payment.invoiceId === invoiceId)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function paymentsForIntervention(interventionId: string, payments: Payment[]): Money {
  return payments
    .filter((payment) => payment.interventionId === interventionId)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function paymentStatusForInvoice(
  invoice: Invoice,
  payments: Payment[],
  now = new Date(),
): Invoice["paymentStatus"] {
  const paid = paymentsForInvoice(invoice.id, payments);
  if (paid >= invoice.totalIncludingTax) return "paid";
  if (paid > 0) return "partial";
  if (invoice.dueAt && new Date(invoice.dueAt).getTime() < now.getTime()) return "overdue";
  return "unpaid";
}

export function conversionRate(leads: Lead[]): number {
  const decided = leads.filter((lead) => lead.stage === "won" || lead.stage === "lost");
  if (decided.length === 0) return 0;
  return decided.filter((lead) => lead.stage === "won").length / decided.length;
}

export function occupancyRate(plannedMinutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0) return 0;
  return Math.min(plannedMinutes / availableMinutes, 1);
}

export function objectiveProgress(realized: Money, objective?: MonthlyObjective): number {
  if (!objective || objective.revenueTarget <= 0) return 0;
  return realized / objective.revenueTarget;
}

export function signedRevenue(quotes: Quote[]): Money {
  return quotes
    .filter((quote) => quote.status === "accepted")
    .reduce((sum, quote) => sum + quote.totalIncludingTax, 0);
}

export function plannedRevenue(interventions: Intervention[]): Money {
  return interventions
    .filter((item) => ["scheduled", "confirmed", "in_progress"].includes(item.status))
    .reduce(
      (sum, item) => sum + item.items.reduce((itemSum, line) => itemSum + line.revenueAllocated, 0),
      0,
    );
}

export function invoicedRevenue(invoices: Invoice[]): Money {
  return invoices
    .filter((invoice) => invoice.status === "issued")
    .reduce((sum, invoice) => sum + invoice.totalIncludingTax, 0);
}

export function collectedRevenue(payments: Payment[]): Money {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

export function unpaidAmount(invoices: Invoice[], payments: Payment[]): Money {
  return invoices
    .filter((invoice) => invoice.status === "issued")
    .reduce(
      (sum, invoice) =>
        sum + Math.max(invoice.totalIncludingTax - paymentsForInvoice(invoice.id, payments), 0),
      0,
    );
}

export function cashBalance(initialCash: Money, payments: Payment[], expenses: Expense[]): Money {
  const paidExpenses = expenses
    .filter((expense) => expense.paid)
    .reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  return initialCash + collectedRevenue(payments) - paidExpenses;
}
