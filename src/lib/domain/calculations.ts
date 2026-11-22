import Decimal from "decimal.js";
import { expenseScheduleKey, paymentsByExpenseOccurrence, registeredOutflowsByMonth } from "./expense-ledger";
import { financialDateKey, isRecordedBy } from "./periods";
import { interventionBalance } from "./intervention-balance";
import { maintenanceBillingState } from "./maintenance";
import { isInternalLedgerHistory } from "./ledger-history";
import type {
  Expense,
  Intervention,
  Invoice,
  MaintenanceBillingPeriod,
  MaintenanceContract,
  Money,
  MonthlyObjective,
  Payment,
  Quote,
} from "./types";

const cents = (value: Decimal.Value): Money => new Decimal(value).toDecimalPlaces(0).toNumber();

export type ExpenseSchedule = Pick<Expense, "date" | "endsAt" | "seriesId" | "recurrence" | "amountIncludingTax" | "paid" | "paidAt" | "settlements" | "paymentMethod" | "legacyRow" | "legacyId" | "qontoRecurrence">;

export type ExpenseOccurrenceStatus = "paid" | "due" | "upcoming";

export interface ExpenseOccurrence<T extends ExpenseSchedule = ExpenseSchedule> {
  expense: T;
  month: string;
  dueDate: string;
  amount: Money;
  status: ExpenseOccurrenceStatus;
  estimatedDebit: boolean;
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

export interface RankedExpense<T extends ExpenseSchedule & { id: string } = ExpenseSchedule & { id: string }> {
  expense: T;
  total: Money;
  paid: Money;
  remaining: Money;
  occurrenceCount: number;
  lastMonth: string;
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

function scheduledExpenseDate(expense: ExpenseSchedule, month: string): Date | null {
  const startMonth = expense.date.slice(0, 7);
  if (month < startMonth) return null;
  if (expense.recurrence === "one_off" && month !== startMonth) return null;
  if (expense.recurrence === "annual" && month.slice(5, 7) !== startMonth.slice(5, 7)) return null;
  const target = monthParts(month);
  const start = expenseStartParts(expense);
  const lastDay = new Date(target.year, target.month, 0).getDate();
  return new Date(target.year, target.month - 1, Math.min(start.day, lastDay), 12, 0, 0, 0);
}

export function expenseOccursInMonth(expense: ExpenseSchedule, month: string): boolean {
  const occurrence = scheduledExpenseDate(expense, month);
  if (!occurrence) return false;
  return !expense.endsAt || dateKey(occurrence) <= expense.endsAt.slice(0, 10);
}

export function expenseOccurrenceDate(expense: ExpenseSchedule, month: string): Date | null {
  if (!expenseOccursInMonth(expense, month)) return null;
  return scheduledExpenseDate(expense, month);
}

export function expenseOccurrenceDateKey(expense: ExpenseSchedule, month: string): string | null {
  const occurrence = expenseOccurrenceDate(expense, month);
  return occurrence ? dateKey(occurrence) : null;
}

function latestSeriesVersions<T extends ExpenseSchedule>(expenses: T[]): T[] {
  const unversioned: T[] = [];
  const versioned = new Map<string, T>();

  for (const expense of expenses) {
    if (!expense.seriesId) {
      unversioned.push(expense);
      continue;
    }
    const current = versioned.get(expense.seriesId);
    if (!current || expense.date > current.date) versioned.set(expense.seriesId, expense);
  }

  return [...unversioned, ...versioned.values()];
}

export function nextExpenseOccurrenceDateKey(expense: ExpenseSchedule, reference = new Date()): string | null {
  const referenceDate = financialDateKey(reference.toISOString());
  const referenceMonth = referenceDate.slice(0, 7);
  const searchMonths = expense.recurrence === "annual" ? 25 : 14;

  for (let offset = 0; offset < searchMonths; offset += 1) {
    const occurrence = expenseOccurrenceDateKey(expense, nextMonth(referenceMonth, offset));
    if (occurrence && occurrence >= referenceDate) return occurrence;
  }
  return null;
}

export function projectedExpensesForMonth<T extends ExpenseSchedule>(expenses: T[], month: string): T[] {
  const eligible = expenses.filter((expense) => expenseOccursInMonth(expense, month));
  const settledVersions = new Map(eligible.filter((expense) => expense.seriesId && expense.settlements?.some((settlement) => settlement.month === month)).map((expense) => [expense.seriesId, expense]));
  // Un tarif révisé en cours de mois ne remplace pas une échéance déjà pointée.
  return latestSeriesVersions(eligible).map((expense) => settledVersions.get(expense.seriesId) ?? expense);
}

export function projectedExpenseAmountForMonth(expenses: ExpenseSchedule[], month: string): Money {
  return expenseOccurrencesForMonth(expenses, month).reduce((sum, entry) => sum + entry.amount, 0);
}

/** For learned tariffs only. A later debit must not reprice earlier months
 * or supersede a tariff that someone explicitly entered in the register. */
export function forecastExpensePrice(expense: ExpenseSchedule, month: string, today = financialDateKey(new Date().toISOString())) {
  if (!expense.qontoRecurrence) return expense.amountIncludingTax;
  let latest: NonNullable<Expense["settlements"]>[number] | undefined;
  for (const paid of expense.settlements ?? []) {
    if (paid.month < month && financialDateKey(paid.paidAt) <= today && (!latest || paid.month > latest.month)) latest = paid;
  }
  return latest?.amount ?? expense.amountIncludingTax;
}

export function expenseOccurrencesForMonth<T extends ExpenseSchedule>(expenses: T[], month: string, reference: Date | string = new Date(), register = paymentsByExpenseOccurrence(expenses)): ExpenseOccurrence<T>[] {
  const referenceDate = typeof reference === "string" ? reference : financialDateKey(reference.toISOString());
  return projectedExpensesForMonth(expenses, month)
    .map((expense) => {
      const dueDate = expenseOccurrenceDateKey(expense, month)!;
      const payment = register.get(expenseScheduleKey(expense))?.get(month);
      const isPaid = payment && payment.day <= referenceDate;
      return {
        expense,
        month,
        dueDate,
        amount: payment && (isPaid || !expense.qontoRecurrence) ? payment.amount : forecastExpensePrice(expense, month, referenceDate),
        estimatedDebit: !payment && expense.recurrence !== "one_off" && expense.paid && dueDate <= referenceDate,
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

export function rankExpensesForMonths<T extends ExpenseSchedule & { id: string }>(
  expenses: T[],
  months: string[],
  reference = new Date(),
): RankedExpense<T>[] {
  const ranking = new Map<string, RankedExpense<T>>();
  const register = paymentsByExpenseOccurrence(expenses);

  for (const month of new Set(months)) {
    for (const occurrence of expenseOccurrencesForMonth(expenses, month, reference, register)) {
      const seriesId = occurrence.expense.seriesId ?? occurrence.expense.id;
      const current = ranking.get(seriesId) ?? {
        expense: occurrence.expense,
        total: 0,
        paid: 0,
        remaining: 0,
        occurrenceCount: 0,
        lastMonth: month,
      };
      if (occurrence.expense.date > current.expense.date) current.expense = occurrence.expense;
      if (month > current.lastMonth) current.lastMonth = month;
      current.total += occurrence.amount;
      current.occurrenceCount += 1;
      if (occurrence.status === "paid") current.paid += occurrence.amount;
      else current.remaining += occurrence.amount;
      ranking.set(seriesId, current);
    }
  }

  return [...ranking.values()].sort((a, b) => b.total - a.total || a.expense.id.localeCompare(b.expense.id));
}

export function expenseForecast(expenses: ExpenseSchedule[], startMonth: string, monthCount = 12): ExpenseForecastPoint[] {
  const register = paymentsByExpenseOccurrence(expenses);
  const today = financialDateKey(new Date().toISOString());
  return Array.from({ length: Math.max(0, monthCount) }, (_, index) => {
    const month = nextMonth(startMonth, index);
    const occurrences = expenseOccurrencesForMonth(expenses, month, today, register);
    const totalFor = (r: Expense["recurrence"]) => occurrences.reduce((sum, o) => sum + (o.expense.recurrence === r ? o.amount : 0), 0);
    const monthly = totalFor("monthly"), annual = totalFor("annual"), oneOff = totalFor("one_off");
    return { month, total: monthly + annual + oneOff, monthly, annual, oneOff };
  });
}

export function paidExpenseAmountForMonth(expenses: ExpenseSchedule[], month: string, reference = new Date()): Money {
  // Estimated cash movement (not the register's confirmed expense total).
  const referenceDate = financialDateKey(reference.toISOString());
  const actual = registeredOutflowsByMonth(expenses, referenceDate).get(month);
  return (actual?.paid ?? 0) + (actual?.cashDelta ?? 0) + expenseOccurrencesForMonth(expenses, month, referenceDate).reduce((sum, e) => sum + (e.estimatedDebit ? e.amount : 0), 0);
}

export function recurringExpenseMetrics(expenses: ExpenseSchedule[], month: string) {
  const active = latestSeriesVersions(expenses.filter((expense) => {
    if (expense.recurrence === "one_off" || expense.date.slice(0, 7) > month) return false;
    if (expense.qontoRecurrence === "estimated" || expense.qontoRecurrence === "expired") return false;
    return !expense.endsAt || expense.endsAt.slice(0, 7) >= month;
  }));
  const monthly = active.filter((expense) => expense.recurrence === "monthly").reduce((sum, expense) => sum + (expense.qontoRecurrence
    ? expense.settlements?.find(s => s.month === month)?.amount ?? forecastExpensePrice(expense, month) : expense.amountIncludingTax), 0);
  const annual = active.filter((expense) => expense.recurrence === "annual").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  return { monthly, annual, monthlyEquivalent: monthly + Math.round(annual / 12), annualCommitment: monthly * 12 + annual };
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

export interface ServicePerformance {
  sales: number;
  revenue: Money;
  margin: Money;
  averageMargin: Money;
}

export function servicePerformance(serviceId: string, interventions: Intervention[]): ServicePerformance {
  return performanceByService(interventions).get(serviceId) ?? { sales: 0, revenue: 0, margin: 0, averageMargin: 0 };
}

export function performanceByService(jobs: Intervention[]) {
  const result = new Map<string | undefined, ServicePerformance>();
  for (const job of jobs) {
    if (job.status !== "completed") continue;
    const amounts = new Map<string | undefined, number>();
    for (const line of job.items) amounts.set(line.serviceId, (amounts.get(line.serviceId) ?? 0) + line.revenueAllocated);
    if (!amounts.size) amounts.set(undefined, 0);
    const revenue = [...amounts.values()].reduce((sum, n) => sum + n, 0);
    const costs = job.productCost + job.travelCost + job.otherDirectCosts;
    // Largest remainders allocate every cent, including to offers outside the catalogue.
    const denominator = revenue || amounts.size;
    const shares = [...amounts].map(([id, amount]) => {
      const numerator = new Decimal(costs).mul(revenue ? amount : 1);
      return { id, amount, cost: numerator.divToInt(denominator).toNumber(), remainder: numerator.mod(denominator).toNumber() };
    }).sort((a, b) => b.remainder - a.remainder || (a.id ?? "").localeCompare(b.id ?? ""));
    const extra = costs - shares.reduce((sum, part) => sum + part.cost, 0);
    shares.forEach((part, i) => {
      const stat = result.get(part.id) ?? { sales: 0, revenue: 0, margin: 0, averageMargin: 0 };
      stat.sales++; stat.revenue += part.amount; stat.margin += part.amount - part.cost - Number(i < extra);
      result.set(part.id, stat);
    });
  }
  for (const stat of result.values()) stat.averageMargin = cents(new Decimal(stat.margin).div(stat.sales));
  return result;
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

export function averageHourlyMargin(interventions: Intervention[]): Money | null {
  const timed = interventions.filter((intervention) => actualPersonMinutes(intervention) > 0);
  const minutes = timed.reduce((sum, intervention) => sum + actualPersonMinutes(intervention), 0);
  if (minutes === 0) return null;
  return cents(new Decimal(timed.reduce((sum, intervention) => sum + grossMargin(intervention), 0)).mul(60).div(minutes));
}

export function remainingExpenseAmountForMonths(expenses: ExpenseSchedule[], months: string[], reference = new Date()): Money {
  const register = paymentsByExpenseOccurrence(expenses);
  return [...new Set(months)].reduce((sum, month) => {
    return sum + expenseOccurrencesForMonth(expenses, month, reference, register).reduce((subtotal, entry) => subtotal + (entry.status !== "paid" ? entry.amount : 0), 0);
  }, 0);
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
  maintenanceContracts: Array<Pick<MaintenanceContract, "id" | "clientId">> = [],
  maintenanceBillingPeriods: Array<Pick<MaintenanceBillingPeriod, "id" | "contractId"> & Partial<Pick<MaintenanceBillingPeriod, "status" | "amount" | "dueOn" | "paidAt">>> = [],
  reference = new Date(),
) {
  const clientInvoices = invoices.filter((invoice) => invoice.clientId === clientId);
  const issuedInvoices = clientInvoices.filter((invoice) => invoice.status === "issued");
  const clientInterventions = interventions.filter((intervention) => intervention.clientId === clientId);
  const completedInterventions = clientInterventions.filter((intervention) => intervention.status === "completed" && (!intervention.startAt || isRecordedBy(intervention.startAt, reference)));
  const invoiced = issuedInvoices.reduce((sum, invoice) => sum + invoice.totalIncludingTax, 0);
  const completedRevenue = completedInterventions.reduce(
    (sum, intervention) => sum + intervention.items.reduce((itemSum, item) => itemSum + item.revenueAllocated, 0),
    0,
  );
  const clientContractIds = new Set(
    maintenanceContracts
      .filter((contract) => contract.clientId === clientId)
      .map((contract) => contract.id),
  );
  const billingPeriodContractIds = new Map(
    maintenanceBillingPeriods.map((period) => [period.id, period.contractId]),
  );
  const clientPayments = payments.filter((payment) => {
    if (!isRecordedBy(payment.paidAt, reference)) return false;
    if (!payment.maintenanceContractId && !payment.maintenanceBillingPeriodId) return true;
    const contractId = payment.maintenanceContractId
      ?? (payment.maintenanceBillingPeriodId ? billingPeriodContractIds.get(payment.maintenanceBillingPeriodId) : undefined);
    return Boolean(contractId && clientContractIds.has(contractId));
  });
  const invoiceIds = new Set(clientInvoices.map(invoice => invoice.id));
  const jobIds = new Set(clientInterventions.map(job => job.id));
  const collected = companyCollectedRevenue(
    clientInterventions.filter((intervention) => intervention.status !== "cancelled"),
    clientPayments.filter(p => !isInternalLedgerHistory(p.paidAt) || p.maintenanceContractId || p.maintenanceBillingPeriodId
      || (p.invoiceId && invoiceIds.has(p.invoiceId)) || (p.interventionId && jobIds.has(p.interventionId))),
  );
  // Un forfait payé d’avance ne doit pas masquer une autre prestation impayée.
  const outstanding = completedInterventions
    .filter((intervention) => !intervention.maintenanceContractId)
    .reduce((sum, intervention) => {
      const invoice = clientInvoices.find((item) => item.id === intervention.invoiceId);
      return sum + interventionBalance(intervention, invoice, clientPayments, reference).outstanding;
    }, 0) + maintenanceBillingPeriods
      .filter((period) => {
        if (!clientContractIds.has(period.contractId) || !period.status) return false;
        if (!period.dueOn) return period.status === "due";
        const state = maintenanceBillingState({ status: period.status, dueOn: period.dueOn, paidAt: period.paidAt }, reference);
        return state === "due" || state === "overdue";
      })
      .reduce((sum, period) => sum + (period.amount ?? 0), 0);

  return {
    invoices: clientInvoices,
    interventions: clientInterventions,
    invoiced,
    completedRevenue,
    revenue: completedRevenue,
    collected,
    outstanding,
    revenueEntryCount: completedInterventions.length,
  };
}

export function paymentStatusForInvoice(
  invoice: Invoice,
  payments: Payment[],
  now = new Date(),
): Invoice["paymentStatus"] {
  const paid = paymentsForInvoice(invoice.id, payments.filter(p => isRecordedBy(p.paidAt, now)));
  if (paid >= invoice.totalIncludingTax) return "paid";
  if (paid > 0) return "partial";
  if (invoice.dueAt && financialDateKey(invoice.dueAt) < financialDateKey(now.toISOString())) return "overdue";
  return "unpaid";
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

export function collectedRevenue(payments: Array<Pick<Payment, "amount">>): Money {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

/** Company-wide only: legacy payments need not have a modern service link.
 * Per-client/per-service reports must still require ownership of the payment. */
export function companyCollectedRevenue(interventions: Array<Pick<Intervention, "id" | "invoiceId">>,
  payments: Array<Pick<Payment, "invoiceId" | "interventionId" | "maintenanceContractId" | "maintenanceBillingPeriodId" | "amount" | "paidAt">>): Money {
  const linkedPeriod = payments.filter(p => !isInternalLedgerHistory(p.paidAt));
  return collectedRevenue(payments.filter(p => isInternalLedgerHistory(p.paidAt))) + collectedInterventionRevenue(interventions, linkedPeriod);
}

export function collectedInterventionRevenue(
  interventions: Array<Pick<Intervention, "id" | "invoiceId">>,
  payments: Array<Pick<Payment, "invoiceId" | "interventionId" | "maintenanceContractId" | "maintenanceBillingPeriodId" | "amount">>,
): Money {
  const interventionIds = new Set(interventions.map((intervention) => intervention.id));
  const linkedInvoiceIds = new Set(
    interventions.flatMap((intervention) => intervention.invoiceId ? [intervention.invoiceId] : []),
  );

  return payments.reduce((sum, payment) => {
    const isDirectInterventionPayment = Boolean(payment.interventionId && interventionIds.has(payment.interventionId));
    const isLinkedInvoicePayment = Boolean(payment.invoiceId && linkedInvoiceIds.has(payment.invoiceId));
    const isMaintenancePayment = Boolean(payment.maintenanceContractId || payment.maintenanceBillingPeriodId);
    return sum + (isDirectInterventionPayment || isLinkedInvoicePayment || isMaintenancePayment ? payment.amount : 0);
  }, 0);
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
  const today = financialDateKey(reference.toISOString());
  const outflows = registeredOutflowsByMonth(expenses, today);
  let paidExpenses = [...outflows.values()].reduce((sum, flow) => sum + flow.paid + flow.cashDelta, 0);
  const recurring = expenses.filter(e => e.recurrence !== "one_off");
  const register = paymentsByExpenseOccurrence(recurring);
  const firstMonth = recurring.filter(e => e.paid).map(e => e.date.slice(0, 7)).filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort()[0];
  for (let month = firstMonth; month && month <= today.slice(0, 7); month = nextMonth(month, 1)) {
    paidExpenses += expenseOccurrencesForMonth(recurring, month, today, register).reduce((sum, entry) => sum + (entry.estimatedDebit ? entry.amount : 0), 0);
  }
  const received = payments.filter((payment) => isRecordedBy(payment.paidAt, reference));
  return initialCash + collectedRevenue(received) - paidExpenses;
}
