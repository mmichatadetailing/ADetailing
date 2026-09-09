import type { Expense, Intervention, MonthlyObjective, Payment } from "./types";
import { collectedInterventionRevenue, paidExpenseAmountForMonth, projectedExpenseAmountForMonth } from "./calculations";

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
  cashFlow: number;
  actualCashFlow: number;
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
  payments: Array<Pick<Payment, "invoiceId" | "interventionId" | "paidAt" | "amount">>;
  expenses: Array<Pick<Expense, "date" | "paidAt" | "paid" | "recurrence" | "amountIncludingTax">>;
  reference?: Date;
}) {
  const revenue: RevenueChartPoint[] = [];
  const cashFlow: CashFlowChartPoint[] = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const label = monthLabel(year, monthIndex);
    const objective = objectives.find((item) => item.month === key)?.revenueTarget ?? null;
    const monthPayments = payments.filter((payment) => payment.paidAt.slice(0, 7) === key);
    const collected = collectedInterventionRevenue(interventions.filter((intervention) => intervention.status !== "cancelled"), monthPayments);
    const receipts = monthPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const paidExpenses = paidExpenseAmountForMonth(expenses, key, reference);
    const scheduledExpenses = projectedExpenseAmountForMonth(expenses, key);

    revenue.push({ key, month: label, objective, collected });
    cashFlow.push({
      key,
      month: label,
      receipts,
      expenses: scheduledExpenses,
      paidExpenses,
      cashFlow: receipts - scheduledExpenses,
      actualCashFlow: receipts - paidExpenses,
    });
  }

  return { revenue, cashFlow };
}
