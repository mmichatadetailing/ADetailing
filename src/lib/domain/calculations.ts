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

type ExpenseSchedule = Pick<Expense, "date" | "recurrence" | "amountIncludingTax" | "paid" | "paidAt">;

function expenseStartParts(expense: ExpenseSchedule) {
  const date = expense.date.slice(0, 10);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) || 1 };
}

function monthParts(month: string) {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

export function expenseOccursInMonth(expense: ExpenseSchedule, month: string): boolean {
  const startMonth = expense.date.slice(0, 7);
  if (month < startMonth) return false;
  if (expense.recurrence === "one_off") return month === startMonth;
  if (expense.recurrence === "monthly") return true;
  return month.slice(5, 7) === startMonth.slice(5, 7);
}

export function expenseOccurrenceDate(expense: ExpenseSchedule, month: string): Date | null {
  if (!expenseOccursInMonth(expense, month)) return null;
  const target = monthParts(month);
  const start = expenseStartParts(expense);
  const lastDay = new Date(target.year, target.month, 0).getDate();
  return new Date(target.year, target.month - 1, Math.min(start.day, lastDay), 12, 0, 0, 0);
}

export function projectedExpensesForMonth<T extends ExpenseSchedule>(expenses: T[], month: string): T[] {
  return expenses.filter((expense) => expenseOccursInMonth(expense, month));
}

export function projectedExpenseAmountForMonth(expenses: ExpenseSchedule[], month: string): Money {
  return projectedExpensesForMonth(expenses, month).reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
}

export function paidExpenseAmountForMonth(expenses: ExpenseSchedule[], month: string, reference = new Date()): Money {
  return expenses.reduce((sum, expense) => {
    if (!expense.paid) return sum;
    if (expense.recurrence === "one_off") {
      const paidOn = expense.paidAt ?? expense.date;
      return paidOn.slice(0, 7) === month && new Date(paidOn).getTime() <= reference.getTime()
        ? sum + expense.amountIncludingTax
        : sum;
    }
    const occurrence = expenseOccurrenceDate(expense, month);
    return occurrence && occurrence.getTime() <= reference.getTime() ? sum + expense.amountIncludingTax : sum;
  }, 0);
}

export function recurringExpenseMetrics(expenses: ExpenseSchedule[], month: string) {
  const active = expenses.filter((expense) => expense.recurrence !== "one_off" && expense.date.slice(0, 7) <= month);
  const monthly = active.filter((expense) => expense.recurrence === "monthly").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  const annual = active.filter((expense) => expense.recurrence === "annual").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  return { monthly, annual, monthlyEquivalent: monthly + Math.round(annual / 12), annualCommitment: monthly * 12 + annual };
}

function paidRecurringExpenseAmountThrough(expense: ExpenseSchedule, reference: Date): Money {
  if (!expense.paid || expense.recurrence === "one_off") return 0;
  const startMonth = expense.date.slice(0, 7);
  const endMonth = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
  const cursor = new Date(Number(startMonth.slice(0, 4)), Number(startMonth.slice(5, 7)) - 1, 1, 12);
  let total = 0;
  while (`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}` <= endMonth) {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const occurrence = expenseOccurrenceDate(expense, month);
    if (occurrence && occurrence.getTime() <= reference.getTime()) total += expense.amountIncludingTax;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return total;
}

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

export function cashBalance(initialCash: Money, payments: Payment[], expenses: Expense[], reference = new Date()): Money {
  const paidExpenses = expenses.reduce((sum, expense) => {
    if (!expense.paid) return sum;
    if (expense.recurrence !== "one_off") return sum + paidRecurringExpenseAmountThrough(expense, reference);
    const paidOn = expense.paidAt ?? expense.date;
    return new Date(paidOn).getTime() <= reference.getTime() ? sum + expense.amountIncludingTax : sum;
  }, 0);
  return initialCash + collectedRevenue(payments) - paidExpenses;
}
