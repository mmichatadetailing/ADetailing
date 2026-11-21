import { normalizeText } from "@/lib/utils";
import { bankDate, type BankTransaction } from "./banking";
import { recordedExpenses } from "./expense-ledger";
import type { Payment } from "./types";

export function namedPayer(tx: BankTransaction) {
  const name = normalizeText(tx.counterparty);
  return name.length >= 3 && !/^(?:(?:virement|sepa|instantane|recu|carte|paiement|inconnu|client|qonto|transfer|payment)\s*)+$/.test(name);
}

export function bankFlow(tx: BankTransaction) {
  const text = normalizeText([tx.operation_type, tx.label, tx.reference, tx.counterparty].join(" "));
  if (tx.operation_type === "internal_transfer" || /\b(virement interne|virement de compte a compte|transfert entre (nos|mes) comptes)\b/.test(normalizeText(tx.reference + " " + tx.label))) return "internal";
  if (["account_remuneration", "atm", "withdrawal"].includes(tx.operation_type) || /\b(apport|capital social|augmentation de capital|emprunt|pret|loan|dividendes?|retrait|withdrawal|compte courant (d |des )?associes?)\b/.test(text)) return "financing";
  if (tx.side === "debit" && /\b(notes? de frais|indemnites? kilometriques?)\b/.test(text)) return "expense";
  if (/\b(remboursements?|refund|cashback|avoir fournisseur|avoir client)\b/.test(text) || (tx.side === "credit" && tx.operation_type === "card")) return "refund";
  if (tx.side === "debit") return "expense";
  if (!["transfer", "income"].includes(tx.operation_type) || /\b(stripe|sumup|paypal|adyen|salaire|salary)\b/.test(text)) return "unallocated";
  return "receipt";
}

export function expenseCategory(tx: BankTransaction) {
  const text = normalizeText([tx.operation_type, tx.label, tx.reference, tx.counterparty].join(" "));
  if (tx.operation_type === "qonto_fee" || /\b(frais bancaires|commission bancaire|abonnement qonto)\b/.test(text)) return "Frais bancaires";
  if (/\b(urssaf|cotisations? sociales?|salaires?|paie)\b/.test(text)) return "Personnel & cotisations";
  if (/\b(assurance|assurances)\b/.test(text)) return "Assurances";
  return "Achats Qonto";
}

export function bankCashSummary(transactions: BankTransaction[], period: string, now = Date.now()) {
  let receipts = 0, expenses = 0, other = 0, splitCashDelta = 0;
  let customerRefunds = 0;
  const expenseDebits = { linked: 0, unlinked: 0, supplierRefunds: 0 };
  for (const tx of transactions) {
    if (!tx.settled_at || tx.status !== "completed" || tx.currency !== "EUR" || tx.amount_cents <= 0
      || Date.parse(tx.settled_at) > now || !bankDate(tx.settled_at).startsWith(period)) continue;
    const flow = bankFlow(tx);
    if (tx.monthly_split_rule_id && tx.reconciliation === "matched" && tx.side === "debit" && tx.operation_type === "transfer") {
      // The confirmed allocation is stronger evidence than a generic bank memo.
      expenses += tx.amount_cents;
      expenseDebits.linked += tx.amount_cents;
      splitCashDelta += tx.split_cash_delta_cents ?? 0;
      continue;
    }
    if (flow === "internal" || flow === "financing" || tx.expense_family === "personal" || tx.expense_family === "investment") continue;
    // A previous explicit exclusion stands. A verified link to a sale/expense
    // is stronger evidence than a generic or aggregated counterparty name.
    if (tx.reconciliation === "ignored" && !tx.automated_at) continue;
    if (flow === "refund") {
      if (tx.side === "credit") {
        expenses -= tx.amount_cents;
        expenseDebits.supplierRefunds += tx.amount_cents;
      } else {
        receipts -= tx.amount_cents;
        // Keep the existing treatment of posted customer refunds on receipts.
        if (tx.posting_kind === "ignored" && tx.automated_at) customerRefunds += tx.amount_cents;
      }
    } else if (tx.side === "debit") {
      expenses += tx.amount_cents;
      const linked = tx.reconciliation === "matched" && (tx.expense_id || tx.reconciliation_group_id);
      expenseDebits[linked ? "linked" : "unlinked"] += tx.amount_cents;
    } else if (tx.payment_id || (flow === "receipt" && namedPayer(tx))) receipts += tx.amount_cents;
    else other += tx.amount_cents;
  }
  return { receipts, expenses, result: receipts - expenses, unallocatedCredits: other, customerRefunds, expenseDebits, ...(splitCashDelta ? { splitCashDelta } : {}) };
}

export function recordedActivity(payments: Pick<Payment,"paidAt"|"amount">[], expenses: Parameters<typeof recordedExpenses>[0],
  period: string, customerRefunds = 0, now = new Date()) {
  const today = bankDate(now.toISOString());
  const inPeriod = (day: string) => day.startsWith(period) && day <= today;
  let received = 0 - customerRefunds;
  for (const p of payments) if (Date.parse(p.paidAt) <= now.getTime() && inPeriod(bankDate(p.paidAt))) received += p.amount;
  const charges = recordedExpenses(expenses, period, now);
  return { received, spent: charges.total, result: received - charges.total, charges };
}
