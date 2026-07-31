import type { Expense, Invoice, MonthlyObjective, Payment } from "./types";

export interface RevenueChartPoint {
  key: string;
  month: string;
  objective: number | null;
  realized: number;
}

export interface CashFlowChartPoint {
  key: string;
  month: string;
  receipts: number;
  expenses: number;
  cashFlow: number;
}

function monthLabel(year: number, monthIndex: number) {
  const label = new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(year, monthIndex, 1));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function buildDashboardChartData({
  year,
  objectives,
  invoices,
  payments,
  expenses,
}: {
  year: number;
  objectives: Array<Pick<MonthlyObjective, "month" | "revenueTarget">>;
  invoices: Array<Pick<Invoice, "issuedAt" | "status" | "totalIncludingTax">>;
  payments: Array<Pick<Payment, "paidAt" | "amount">>;
  expenses: Array<Pick<Expense, "date" | "paidAt" | "paid" | "amountIncludingTax">>;
}) {
  const revenue: RevenueChartPoint[] = [];
  const cashFlow: CashFlowChartPoint[] = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const label = monthLabel(year, monthIndex);
    const objective = objectives.find((item) => item.month === key)?.revenueTarget ?? null;
    const realized = invoices
      .filter((invoice) => invoice.status === "issued" && invoice.issuedAt.slice(0, 7) === key)
      .reduce((sum, invoice) => sum + invoice.totalIncludingTax, 0);
    const receipts = payments
      .filter((payment) => payment.paidAt.slice(0, 7) === key)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const paidExpenses = expenses
      .filter((expense) => expense.paid && (expense.paidAt ?? expense.date).slice(0, 7) === key)
      .reduce((sum, expense) => sum + expense.amountIncludingTax, 0);

    revenue.push({ key, month: label, objective, realized });
    cashFlow.push({ key, month: label, receipts, expenses: paidExpenses, cashFlow: receipts - paidExpenses });
  }

  return { revenue, cashFlow };
}
