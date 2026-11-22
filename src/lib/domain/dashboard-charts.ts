import type { Intervention, MonthlyObjective, Payment } from "./types";
import { companyCollectedRevenue, expenseOccurrencesForMonth, type ExpenseSchedule } from "./calculations";
import { paymentsByExpenseOccurrence, registeredOutflowsByMonth } from "./expense-ledger";
import { financialDateKey, isRecordedBy } from "./periods";

export interface RevenueChartPoint {
  key: string;
  month: string;
  objective: number | null;
  collected: number;
}

export interface CashFlowChartPoint {
  key: string;
  month: string;
  receipts: number;
  expenses: number;
  paidExpenses: number;
  registeredExpenses: number;
  outstandingExpenses: number;
  cashFlow: number;
  actualCashFlow: number;
}

export function totalRevenueObjective(points: RevenueChartPoint[]) {
  return points.reduce((sum, point) => sum + (point.objective ?? 0), 0);
}

function monthLabel(year: number, monthIndex: number) {
  const label = new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(year, monthIndex, 1));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function buildDashboardChartData({
  year,
  objectives,
  interventions,
  payments,
  expenses,
  reference = new Date(),
}: {
  year: number;
  objectives: Array<Pick<MonthlyObjective, "month" | "revenueTarget">>;
  interventions: Array<Pick<Intervention, "id" | "invoiceId"> & Partial<Pick<Intervention, "status">>>;
  payments: Array<Pick<Payment, "invoiceId" | "interventionId" | "maintenanceContractId" | "maintenanceBillingPeriodId" | "paidAt" | "amount">>;
  expenses: ExpenseSchedule[];
  reference?: Date;
}) {
  const revenue: RevenueChartPoint[] = [];
  const cashFlow: CashFlowChartPoint[] = [];
  const receiptsByMonth = new Map<string, typeof payments>();
  for (const payment of payments) {
    if (!isRecordedBy(payment.paidAt, reference)) continue;
    const key = financialDateKey(payment.paidAt).slice(0, 7);
    if (!receiptsByMonth.has(key)) receiptsByMonth.set(key, []);
    receiptsByMonth.get(key)!.push(payment);
  }
  const activeJobs = interventions.filter(job => job.status !== "cancelled");
  const today = financialDateKey(reference.toISOString());
  const register = paymentsByExpenseOccurrence(expenses);
  const outflows = registeredOutflowsByMonth(expenses, today);

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const label = monthLabel(year, monthIndex);
    const objective = objectives.find((item) => item.month === key)?.revenueTarget ?? null;
    const monthPayments = receiptsByMonth.get(key) ?? [];
    const collected = companyCollectedRevenue(activeJobs, monthPayments);
    const receipts = monthPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const occurrences = expenseOccurrencesForMonth(expenses, key, today, register);
    const actual = outflows.get(key);
    const registeredExpenses = actual?.paid ?? 0;
    const paidExpenses = registeredExpenses + (actual?.cashDelta ?? 0) + occurrences.reduce((sum, e) => sum + (e.estimatedDebit ? e.amount : 0), 0);
    const scheduledExpenses = occurrences.reduce((sum, e) => sum + e.amount, 0);
    const outstandingExpenses = occurrences.reduce((sum, e) => sum + (e.status !== "paid" ? e.amount : 0), 0);

    revenue.push({ key, month: label, objective, collected });
    cashFlow.push({
      key,
      month: label,
      receipts,
      expenses: scheduledExpenses,
      paidExpenses,
      registeredExpenses, outstandingExpenses,
      cashFlow: receipts - scheduledExpenses,
      actualCashFlow: receipts - paidExpenses,
    });
  }

  return { revenue, cashFlow };
}
