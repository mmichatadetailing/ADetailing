import { expenseOccurrencesForMonth } from "./calculations";
import { expenseRegisterPayments, paymentsByExpenseOccurrence } from "./expense-ledger";
import { financialDateKey } from "./periods";
import type { Expense, Money } from "./types";

export interface PeriodExpenseLine {
  key: string;
  expense: Expense;
  month: string;
  day: string;
  amount: Money;
  source?: ReturnType<typeof expenseRegisterPayments>[number]["source"];
  grouped?: boolean;
}

const occurrenceKey = (expense: Expense, month: string) => (expense.seriesId ?? expense.id) + ":" + month;

/** Paid is a flow by payment date. Outstanding is the set of obligations due
 * in the selected months that still have no confirmed payment as of today. */
export function dashboardExpenses(expenses: Expense[], months: readonly string[], today = financialDateKey(new Date().toISOString())) {
  const selected = new Set(months);
  const register = paymentsByExpenseOccurrence(expenses);
  const paid: PeriodExpenseLine[] = [], outstanding: PeriodExpenseLine[] = [];
  let cash = 0;
  for (const expense of expenses) {
    for (const payment of expenseRegisterPayments(expense)) {
      if (!payment.day || payment.day > today || !selected.has(payment.day.slice(0, 7))) continue;
      const key = occurrenceKey(expense, payment.month);
      paid.push({ key: payment.settlement?.id ?? key, expense, month: payment.month, day: payment.day,
        amount: payment.amount, source: payment.source, grouped: Boolean(payment.settlement?.splitLeg) });
      if (payment.source === "cash") cash += payment.amount;
    }
  }
  for (const month of selected) {
    for (const { expense, status, dueDate, amount } of expenseOccurrencesForMonth(expenses, month, today, register)) {
      if (status !== "paid") outstanding.push({ key: occurrenceKey(expense, month), expense, month, day: dueDate, amount });
    }
  }
  paid.sort((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key));
  outstanding.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
  const total = (lines: PeriodExpenseLine[]) => lines.reduce((sum, line) => sum + line.amount, 0);
  return { paid: { lines: paid, total: total(paid), cash }, outstanding: { lines: outstanding, total: total(outstanding) } };
}
