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

export type ExpenseSchedule = Pick<Expense, "date" | "recurrence" | "amountIncludingTax" | "paid" | "paidAt">;

export type ExpenseOccurrenceStatus = "paid" | "due" | "upcoming";

export interface ExpenseOccurrence<T extends ExpenseSchedule = ExpenseSchedule> {
  expense: T;
  month: string;
  dueDate: string;
  amount: Money;
  status: ExpenseOccurrenceStatus;
}

export interface ExpenseMonthSummary<T extends ExpenseSchedule = ExpenseSchedule> {
  month: string;
  occurrences: ExpenseOccurrence<T>[];
  total: Money;
  paid: Money;
  due: Money;
  upcoming: Money;
  recurring: Money;
  oneOff: Money;
}

export interface ExpenseForecastPoint {
  month: string;
  total: Money;
  monthly: Money;
  annual: Money;
  oneOff: Money;
}

function expenseStartParts(expense: ExpenseSchedule) {
  const date = expense.date.slice(0, 10);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) || 1 };
}

function monthParts(month: string) {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

function dateKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function nextMonth(month: string, offset: number) {
  const target = monthParts(month);
  const date = new Date(target.year, target.month - 1 + offset, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

export function expenseOccurrenceDateKey(expense: ExpenseSchedule, month: string): string | null {
  const occurrence = expenseOccurrenceDate(expense, month);
  return occurrence ? dateKey(occurrence) : null;
}

export function projectedExpensesForMonth<T extends ExpenseSchedule>(expenses: T[], month: string): T[] {
  return expenses.filter((expense) => expenseOccursInMonth(expense, month));
}

export function projectedExpenseAmountForMonth(expenses: ExpenseSchedule[], month: string): Money {
  return projectedExpensesForMonth(expenses, month).reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
}

export function expenseOccurrencesForMonth<T extends ExpenseSchedule>(expenses: T[], month: string, reference = new Date()): ExpenseOccurrence<T>[] {
  const referenceDate = dateKey(reference);
  return projectedExpensesForMonth(expenses, month)
    .map((expense) => {
      const dueDate = expenseOccurrenceDateKey(expense, month)!;
      const paymentDate = expense.recurrence === "one_off" ? (expense.paidAt ?? expense.date).slice(0, 10) : dueDate;
      const isPaid = expense.paid && Boolean(paymentDate) && paymentDate! <= referenceDate;
      return {
        expense,
        month,
        dueDate,
        amount: expense.amountIncludingTax,
        status: isPaid ? "paid" as const : dueDate <= referenceDate ? "due" as const : "upcoming" as const,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function expenseMonthSummary<T extends ExpenseSchedule>(expenses: T[], month: string, reference = new Date()): ExpenseMonthSummary<T> {
  const occurrences = expenseOccurrencesForMonth(expenses, month, reference);
  return occurrences.reduce<ExpenseMonthSummary<T>>((summary, occurrence) => {
    summary.total += occurrence.amount;
    summary[occurrence.status] += occurrence.amount;
    if (occurrence.expense.recurrence === "one_off") summary.oneOff += occurrence.amount;
    else summary.recurring += occurrence.amount;
    return summary;
  }, { month, occurrences, total: 0, paid: 0, due: 0, upcoming: 0, recurring: 0, oneOff: 0 });
}

export function expenseForecast(expenses: ExpenseSchedule[], startMonth: string, monthCount = 12): ExpenseForecastPoint[] {
  return Array.from({ length: Math.max(0, monthCount) }, (_, index) => {
    const month = nextMonth(startMonth, index);
    const active = projectedExpensesForMonth(expenses, month);
    const monthly = active.filter((expense) => expense.recurrence === "monthly").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
    const annual = active.filter((expense) => expense.recurrence === "annual").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
    const oneOff = active.filter((expense) => expense.recurrence === "one_off").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
    return { month, total: monthly + annual + oneOff, monthly, annual, oneOff };
  });
}

export function paidExpenseAmountForMonth(expenses: ExpenseSchedule[], month: string, reference = new Date()): Money {
  const referenceDate = dateKey(reference);
  return expenses.reduce((sum, expense) => {
    if (!expense.paid) return sum;
    if (expense.recurrence === "one_off") {
      const paidOn = expense.paidAt ?? expense.date;
      return paidOn.slice(0, 7) === month && paidOn.slice(0, 10) <= referenceDate
        ? sum + expense.amountIncludingTax
        : sum;
    }
    const occurrence = expenseOccurrenceDateKey(expense, month);
    return occurrence && occurrence <= referenceDate ? sum + expense.amountIncludingTax : sum;
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
    const occurrence = expenseOccurrenceDateKey(expense, month);
    if (occurrence && occurrence <= dateKey(reference)) total += expense.amountIncludingTax;
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

export function clientRevenueMetrics(
  clientId: string,
  invoices: Invoice[],
  interventions: Intervention[],
  payments: Payment[],
) {
  const clientInvoices = invoices.filter((invoice) => invoice.clientId === clientId);
  const issuedInvoices = clientInvoices.filter((invoice) => invoice.status === "issued");
  const issuedInvoiceIds = new Set(issuedInvoices.map((invoice) => invoice.id));
  const clientInterventions = interventions.filter((intervention) => intervention.clientId === clientId);
  const completedWithoutIssuedInvoice = clientInterventions.filter(
    (intervention) => intervention.status === "completed" && (!intervention.invoiceId || !issuedInvoiceIds.has(intervention.invoiceId)),
  );
  const invoiced = issuedInvoices.reduce((sum, invoice) => sum + invoice.totalIncludingTax, 0);
  const completedRevenue = completedWithoutIssuedInvoice.reduce(
    (sum, intervention) => sum + intervention.items.reduce((itemSum, item) => itemSum + item.revenueAllocated, 0),
    0,
  );
  const clientInvoiceIds = new Set(clientInvoices.map((invoice) => invoice.id));
  const clientInterventionIds = new Set(clientInterventions.map((intervention) => intervention.id));
  const collected = payments
    .filter((payment) => (payment.invoiceId && clientInvoiceIds.has(payment.invoiceId)) || (payment.interventionId && clientInterventionIds.has(payment.interventionId)))
    .reduce((sum, payment) => sum + payment.amount, 0);

  return {
    invoices: clientInvoices,
    interventions: clientInterventions,
    invoiced,
    completedRevenue,
    revenue: invoiced + completedRevenue,
    collected,
    revenueEntryCount: issuedInvoices.length + completedWithoutIssuedInvoice.length,
  };
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
