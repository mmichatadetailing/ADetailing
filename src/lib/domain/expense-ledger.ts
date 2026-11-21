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

interface RegisterPayment {
  day: string;
  month: string; // Month of the obligation, which may differ from the payment date.
  amount: number;
  source: "cash" | "linked" | "unlinked";
  settlement?: NonNullable<Expense["settlements"]>[number];
}

/** One entry per confirmed register payment, never one per raw bank movement. */
export function expenseRegisterPayments(expense: LedgerExpense): RegisterPayment[] {
  const manual = manualExpensePayment(expense);
  const dueMonth = expense.date.slice(0, 7);
  const cash = isCashExpenseMethod(expense.paymentMethod);
  if (manual) {
    const settlement = expense.settlements?.[0];
    return [{ ...manual, month: dueMonth, source: cash ? "cash" : settlement ? "linked" : "unlinked", settlement }];
  }
  const payments: RegisterPayment[] = [];
  const legacy = historicalRecurringPayment(expense);
  if (legacy) payments.push({ ...legacy, source: cash ? "cash" : "unlinked" });
  for (const settlement of expense.settlements ?? []) {
    payments.push({ day: financialDateKey(settlement.paidAt), amount: settlement.amount,
      month: expense.recurrence === "one_off" ? dueMonth : settlement.month, source: "linked", settlement });
  }
  return payments;
}

/** Confirmed payments in the internal register, by payment date (not due date).
 * An imported settlement is already a ledger entry. Never add the bank feed,
 * a scheduled estimate or a grouped transfer's cash difference to this total. */
export function recordedExpenses(expenses: LedgerExpense[], period: string, now = new Date()) {
  const today = financialDateKey(now.toISOString());
  let linked = 0, cash = 0, unlinked = 0, cashWithBankLink = 0;
  for (const expense of expenses) {
    if (expense.family !== "fixed" && expense.family !== "variable") continue;
    for (const payment of expenseRegisterPayments(expense)) {
      if (!payment.day.startsWith(period) || payment.day > today) continue;
      if (payment.source === "cash") {
        cash += payment.amount;
        if (payment.settlement) cashWithBankLink += payment.amount;
      } else if (payment.source === "linked") linked += payment.amount;
      else unlinked += payment.amount;
    }
  }
  return { total: linked + cash + unlinked, linked, cash, unlinked, ...(cashWithBankLink ? { cashWithBankLink } : {}) };
}
