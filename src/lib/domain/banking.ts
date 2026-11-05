import { normalizeText } from "@/lib/utils";
import { financialDateKey } from "./periods";

export type BankTargetKind = "payment" | "expense" | "intervention" | "invoice" | "maintenance";
export interface BankCandidate {
  key: string;
  kind: BankTargetKind;
  id: string;
  month?: string;
  label: string;
  identities: string[];
  amount: number;
  date: string;
  historicalEligible?: boolean;
}
export interface BankTransaction {
  id: string;
  remote_id: string;
  account_name: string;
  label: string;
  counterparty: string;
  reference: string;
  amount_cents: number;
  currency: string;
  side: "credit" | "debit";
  status: string;
  settled_at: string | null;
  emitted_at: string;
  operation_type: string;
  reconciliation: "unmatched" | "matched" | "ignored" | "review";
  payment_id: string | null;
  expense_id: string | null;
  expense_month: string | null;
  created_entry: boolean;
  ignored_reason: string | null;
  reconciliation_group_id?: string | null;
  group_size?: number;
  group_note?: string;
}

export function historicalGroupCandidates(transactions: BankTransaction[], candidates: BankCandidate[]) {
  const amount = transactions.reduce((sum, transaction) => sum + transaction.amount_cents, 0);
  if (transactions.length < 2 || transactions.length > 50 || new Set(transactions.map((transaction) => transaction.id)).size !== transactions.length
    || !Number.isSafeInteger(amount) || transactions.some((transaction) => !canReconcile(transaction) || transaction.side !== transactions[0]!.side)) return [];
  return candidates.filter((candidate) => candidate.historicalEligible && candidate.amount === amount
    && candidate.kind === (transactions[0]!.side === "debit" ? "expense" : "payment"));
}

export function bankDate(value: string) {
  return financialDateKey(value);
}

export function canReconcile(transaction: BankTransaction) {
  return transaction.status === "completed" && transaction.currency === "EUR" && transaction.amount_cents > 0
    && Boolean(transaction.settled_at) && new Date(transaction.settled_at!).getTime() <= Date.now()
    && transaction.reconciliation === "unmatched" && !transaction.reconciliation_group_id && transaction.operation_type !== "internal_transfer";
}

export function bankCandidateMatches(transaction: BankTransaction, candidates: BankCandidate[]) {
  if (!canReconcile(transaction)) return [];
  const text = ` ${normalizeText(`${transaction.label} ${transaction.counterparty} ${transaction.reference}`)} `;
  const date = new Date(transaction.settled_at ?? transaction.emitted_at).getTime();
  return candidates.filter((candidate) => {
    if ((transaction.side === "debit") !== (candidate.kind === "expense")) return false;
    if (candidate.amount !== transaction.amount_cents) return false;
    const days = Math.abs(date - new Date(candidate.date).getTime()) / 86_400_000;
    return Number.isFinite(days) && days <= (candidate.kind === "expense" ? 10 : 7)
      && candidate.identities.some((identity) => {
        const needle = normalizeText(identity);
        return needle.length >= 5 && text.includes(` ${needle} `);
      });
  });
}

// Aucune création de paiement automatique : seulement les paiements déjà saisis
// et les échéances de charges connues, avec correspondance réciproque unique.
export function automaticBankMatches(transactions: BankTransaction[], candidates: BankCandidate[]) {
  const matches = transactions.map((transaction) => ({ transaction, candidates: bankCandidateMatches(transaction, candidates.filter((candidate) => candidate.kind === "payment" || candidate.kind === "expense")) }));
  return matches.flatMap((match) => match.candidates.length === 1
    && matches.filter((other) => other.candidates.some((candidate) => candidate.key === match.candidates[0]!.key)).length === 1
    ? [{ transaction: match.transaction, candidate: match.candidates[0]! }] : []);
}
