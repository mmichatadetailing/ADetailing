import { normalizeText } from "@/lib/utils";
import { bankDate, type BankTransaction } from "./banking";
import type { Expense, Payment } from "./types";

export function namedPayer(tx: BankTransaction) {
  const name = normalizeText(tx.counterparty);
  return name.length >= 3 && !/^(?:(?:virement|sepa|instantane|recu|carte|paiement|inconnu|client|qonto|transfer|payment)\s*)+$/.test(name);
}

export function bankFlow(tx: BankTransaction) {
  const text = normalizeText([tx.operation_type, tx.label, tx.reference, tx.counterparty].join(" "));
  if (tx.operation_type === "internal_transfer" || /\b(virement interne|virement de compte a compte|transfert entre (nos|mes) comptes)\b/.test(normalizeText(tx.reference + " " + tx.label))) return "internal";
  if (tx.operation_type === "account_remuneration" || /\b(apport|capital social|augmentation de capital|emprunt|pret|loan|dividendes?|retrait|withdrawal|compte courant (d |des )?associes?)\b/.test(text)) return "financing";
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
  let receipts = 0, expenses = 0, other = 0;
  const bookedRefunds = { customer: 0, supplier: 0 };
  for (const tx of transactions) {
    if (!tx.settled_at || tx.status !== "completed" || tx.currency !== "EUR" || tx.amount_cents <= 0
      || Date.parse(tx.settled_at) > now || !bankDate(tx.settled_at).startsWith(period)) continue;
    const flow = bankFlow(tx);
    if (flow === "internal" || flow === "financing" || tx.expense_family === "personal" || tx.expense_family === "investment") continue;
    // A previous explicit exclusion stands. A verified link to a sale/expense
    // is stronger evidence than a generic or aggregated counterparty name.
    if (tx.reconciliation === "ignored" && !tx.automated_at) continue;
    if (flow === "refund") {
      if (tx.side === "credit") expenses -= tx.amount_cents;
      else receipts -= tx.amount_cents;
      // Older manual history may have been entered net of refunds. Only carry
      // explicitly posted automatic refunds into the all-methods ledger result.
      if (tx.posting_kind === "ignored" && tx.automated_at)
        bookedRefunds[tx.side === "credit" ? "supplier" : "customer"] += tx.amount_cents;
    } else if (tx.side === "debit") expenses += tx.amount_cents;
    else if (tx.payment_id || (flow === "receipt" && namedPayer(tx))) receipts += tx.amount_cents;
    else other += tx.amount_cents;
  }
  return { receipts, expenses, result: receipts - expenses, unallocatedCredits: other, bookedRefunds };
}

/** Recorded cash basis, all payment methods. Never add bank totals to ledger
 * totals. A scheduled debit without evidence belongs in forecasts only. */
export function recordedActivity(payments: Pick<Payment,"paidAt"|"amount">[], expenses: Pick<Expense,"family"|"date"|"paidAt"|"paid"|"recurrence"|"settlements"|"amountIncludingTax">[],
  period: string, refunds = { customer: 0, supplier: 0 }, now = new Date()) {
  const today = bankDate(now.toISOString());
  const inPeriod = (day: string) => day.startsWith(period) && day <= today;
  let received = 0 - refunds.customer, spent = 0 - refunds.supplier;
  for (const p of payments) if (Date.parse(p.paidAt) <= now.getTime() && inPeriod(bankDate(p.paidAt))) received += p.amount;
  for (const e of expenses) {
    if (e.family !== "fixed" && e.family !== "variable") continue;
    if (e.settlements?.length) {
      for (const s of e.settlements) if (inPeriod(bankDate(s.paidAt))) spent += s.amount;
    } else if (e.recurrence === "one_off" && e.paid && inPeriod(bankDate(e.paidAt ?? e.date))) {
      spent += e.amountIncludingTax;
    }
  }
  return { received, spent, result: received - spent };
}
