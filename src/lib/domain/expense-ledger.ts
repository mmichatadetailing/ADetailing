import { normalizeText } from "@/lib/utils";
import { financialDateKey } from "./periods";
import { isInternalLedgerHistory } from "./ledger-history";
import type { Expense } from "./types";

export const expensePaymentMethods = ["Espèces", "Carte", "Virement", "Prélèvement", "Chèque", "Autre"] as const;

export function isCashPaymentMethod(method?: string | null) {
  return /^(?:en )?(?:especes?|liquides?|cash)$/.test(normalizeText(method ?? ""));
}
export const isCashExpenseMethod = isCashPaymentMethod;

type LedgerExpense = Pick<Expense, "family" | "date" | "paidAt" | "paid" | "paymentMethod" | "recurrence" | "settlements" | "amountIncludingTax" | "legacyRow" | "legacyId">;

// A paid line from the historical register proves one occurrence, not every
// instalment. A normal schedule's automatic-debit flag is not proof of payment.
export function historicalRecurringPayment(expense: Omit<LedgerExpense, "family">) {
  if (!expense.paid || expense.recurrence === "one_off" || (expense.legacyRow == null && !expense.legacyId && !expense.paymentMethod)) return null;
  const day = financialDateKey(expense.paidAt ?? expense.date);
  const month = financialDateKey(expense.date).slice(0,7);
  return isInternalLedgerHistory(day) && !expense.settlements?.some(s => s.month === month)
    ? {day, month, amount:expense.amountIncludingTax} : null;
}

export function manualExpensePayment(expense: Omit<LedgerExpense, "family">) {
  if (expense.recurrence !== "one_off" || !expense.paid) return null;
  // Keep the explicitly entered date. Without one, a register settlement is
  // better evidence than the due date, unless the entry explicitly says cash.
  const settlementDate = !isCashExpenseMethod(expense.paymentMethod) ? expense.settlements?.[0]?.paidAt : undefined;
  return { day: financialDateKey(expense.paidAt ?? settlementDate ?? expense.date), amount: expense.amountIncludingTax };
}

/** Confirmed payments in the internal register, by payment date (not due date).
 * An imported settlement is already a ledger entry. Never add the bank feed,
 * a scheduled estimate or a grouped transfer's cash difference to this total. */
export function recordedExpenses(expenses: LedgerExpense[], period: string, now = new Date()) {
  const today = financialDateKey(now.toISOString());
  const inPeriod = (date: string) => {
    const day = financialDateKey(date);
    return day.startsWith(period) && day <= today;
  };
  let linked = 0, cash = 0, unlinked = 0, cashWithBankLink = 0;
  for (const expense of expenses) {
    if (expense.family !== "fixed" && expense.family !== "variable") continue;
    const manual = manualExpensePayment(expense);
    if (manual) {
      if (!inPeriod(manual.day)) continue;
      if (isCashExpenseMethod(expense.paymentMethod)) {
        cash += manual.amount;
        if (expense.settlements?.length) cashWithBankLink += manual.amount;
      } else if (expense.settlements?.length) linked += manual.amount;
      else unlinked += manual.amount;
    } else {
      const legacy = historicalRecurringPayment(expense);
      if (legacy && inPeriod(legacy.day)) {
        if (isCashPaymentMethod(expense.paymentMethod)) cash += legacy.amount;
        else unlinked += legacy.amount;
      }
      for (const entry of expense.settlements ?? []) if (inPeriod(entry.paidAt)) linked += entry.amount;
    }
  }
  return { total: linked + cash + unlinked, linked, cash, unlinked, ...(cashWithBankLink ? { cashWithBankLink } : {}) };
}
