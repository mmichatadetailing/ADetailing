import type { BankTransaction } from "./banking";
import type { ExpenseOccurrence } from "./calculations";
import { bankFlow } from "./qonto-finance";
import { financialDateKey } from "./periods";
import type { Expense, Payment } from "./types";

export type FinanceTone = "emerald" | "amber" | "blue" | "violet" | "neutral" | "rose" | "teal";
export type FinanceState = { label: string; tone: FinanceTone };

type Connection = { connected: boolean; enabled: boolean; last_error?: string | null; last_synced_at?: string | null; posting_pending?: boolean; window_to?: string | null };
export function connectionState(connection: Connection | null | undefined, configured: boolean, scheduled: boolean, now = Date.now()): FinanceState {
  if (!connection?.connected) return { label: "Non connecté", tone: "neutral" };
  if (!connection.enabled) return { label: "En pause", tone: "neutral" };
  if (!configured || !scheduled) return { label: "Configuration incomplète", tone: "amber" };
  if (connection.last_error) return { label: "Erreur de synchronisation", tone: "rose" };
  if (connection.window_to || connection.posting_pending) return { label: "Import partiel", tone: "amber" };
  if (!connection.last_synced_at) return { label: "Première synchronisation attendue", tone: "blue" };
  if (now - Date.parse(connection.last_synced_at) > 48 * 60 * 60 * 1000) return { label: "Dernière synchro il y a plus de 2 jours", tone: "amber" };
  return { label: "Synchronisation automatique", tone: "emerald" };
}

export function paymentSource(payments: Pick<Payment, "bankLinked">[]) {
  if (!payments.length) return null;
  const bank = payments.filter((p) => p.bankLinked).length;
  return bank === 0 ? "recorded" : bank === payments.length ? "qonto" : "mixed";
}

export function expenseAccess(expense: Pick<Expense, "endsAt" | "recurrence" | "settlements">) {
  const linked = Boolean(expense.settlements?.length);
  return { edit: !expense.endsAt && !(linked && expense.recurrence === "one_off"), remove: !expense.endsAt && !linked };
}

export function isEstimatedDebit({ expense, month, status }: ExpenseOccurrence<Expense>) {
  return status === "paid" && expense.recurrence !== "one_off" && !expense.settlements?.some((s) => s.month === month);
}

export function registerState(expense: Expense, month: string, today = financialDateKey(new Date().toISOString())): FinanceState {
  const settlement = expense.settlements?.find((s) => expense.recurrence === "one_off" || s.month === month);
  if (settlement && financialDateKey(settlement.paidAt) <= today) return {label:"Réglée · Qonto", tone:"emerald"};
  if (expense.recurrence !== "one_off") return {label:expense.paid ? "Prélèvement prévu" : "Selon échéance",tone:"blue"};
  if (financialDateKey(expense.paidAt ?? expense.date) > today) return {label:"À venir",tone:"blue"};
  return expense.paid ? {label:"Règlement enregistré",tone:"emerald"} : {label:"Non réglée",tone:"amber"};
}

export function occurrenceState({ expense, month, status }: ExpenseOccurrence<Expense>): FinanceState {
  if (status === "upcoming") return { label: "À venir", tone: "blue" };
  if (status === "due") return { label: "Échue · non réglée", tone: "amber" };
  if (expense.settlements?.some((s) => s.month === month)) return { label: "Réglée · Qonto", tone: "emerald" };
  if (expense.recurrence === "one_off") return { label: "Règlement enregistré", tone: "emerald" };
  return { label: "Prélèvement estimé", tone: "amber" };
}

export function journalState(tx: BankTransaction, postingFrom?: string): FinanceState {
  if (tx.status === "reversed" || tx.status === "declined") return { label: tx.status === "reversed" ? "Annulée" : "Refusée", tone: "neutral" };
  if (tx.status === "pending") return { label: "En attente bancaire", tone: "amber" };
  if (tx.reconciliation === "review" || tx.posting_kind === "repost") return { label: "Correction bancaire", tone: "amber" };
  if (tx.reconciliation_group_id) return { label: "Historique regroupé", tone: "violet" };
  if (tx.posting_kind === "service") return { label: "Prestation encaissée", tone: "emerald" };
  if (tx.posting_kind === "expense") return { label: "Charge réglée", tone: "teal" };
  if (tx.reconciliation === "matched" || tx.posting_kind === "matched") {
    return tx.expense_id ? { label: "Charge rattachée", tone: "teal" } : tx.payment_id ? { label: "Paiement rattaché", tone: "emerald" } : { label: "Écriture rattachée", tone: "emerald" };
  }
  if (tx.posting_kind === "ignored" && tx.automated_at && tx.status === "completed" && tx.currency === "EUR" && bankFlow(tx) === "refund")
    return { label: tx.side === "credit" ? "Remboursement fournisseur" : "Remboursement client", tone: "teal" };
  if (tx.posting_kind === "bank_only" || tx.posting_kind === "ignored" || tx.reconciliation === "ignored") return { label: "Journal uniquement", tone: "neutral" };
  if (postingFrom && tx.settled_at && Date.parse(tx.settled_at) < Date.parse(postingFrom)) return { label: "Historique importé", tone: "violet" };
  return { label: "Au journal", tone: "blue" };
}
