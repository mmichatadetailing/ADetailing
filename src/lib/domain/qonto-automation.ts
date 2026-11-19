import { normalizeText } from "@/lib/utils";
import { bankCandidateMatches, canReconcile, type BankCandidate, type BankTransaction } from "./banking";
import { bankFlow, expenseCategory, namedPayer } from "./qonto-finance";

export interface AutomationClient { id: string; names: string[] }
export interface AutomationBlocker { side: "credit" | "debit"; identities: string[] }
export type QontoDecision =
  | { action: "match"; kind: BankCandidate["kind"]; id: string; month?: string; variableDebit?: true }
  | { action: "expense"; category: string }
  | { action: "service"; clientId?: string; clientName: string }
  | { action: "defer"; reason: string }
  | { action: "ignore"; reason: string };

function mentions(transaction: BankTransaction, identities: string[]) {
  const text = ` ${normalizeText(`${transaction.counterparty} ${transaction.label} ${transaction.reference}`)} `;
  return identities.some((identity) => {
    const name = normalizeText(identity);
    return name.length >= 3 && text.includes(` ${name} `);
  });
}

/** Only ordinary business operations are created; uncertainty never becomes revenue. */
export function qontoAutomationDecision(transaction: BankTransaction, context: {
  transactions: BankTransaction[]; candidates: BankCandidate[];
  clients: AutomationClient[]; blockers: AutomationBlocker[];
}): QontoDecision {
  const flow = bankFlow(transaction);
  if (flow === "internal") return { action: "ignore", reason: "Virement entre comptes de l’entreprise." };
  if (!canReconcile(transaction)) return { action: "defer", reason: "Opération non définitive." };
  if (flow === "financing") return { action: "ignore", reason: "Mouvement de financement ou de trésorerie, hors activité." };
  if (flow === "refund") return { action: "ignore", reason: "Remboursement déduit de son flux d’origine dans le résultat bancaire, sans nouvelle prestation ni charge." };
  const available = flow === "unallocated" ? context.candidates.filter((c) => c.kind === "payment" && c.documentReference && mentions(transaction,[c.documentReference])) : context.candidates;
  const matches = bankCandidateMatches(transaction, available);
  if (matches.length === 1) {
    const match = matches[0]!;
    const competitors = context.transactions.filter((other) => bankCandidateMatches(other, [match]).length > 0);
    if (competitors.length === 1) return { action: "match", kind: match.kind, id: match.id, ...(match.month ? { month: match.month } : {}) };
  }
  if (flow === "unallocated") return { action: "defer", reason: "Crédit non identifié comme une vente individuelle. Aucun chiffre d’affaires ajouté au logiciel." };
  // Some suppliers vary their direct debit. Never absorb a card purchase or
  // guess between two subscriptions/debits from the same supplier.
  const recurringMatch = (tx: BankTransaction, c: BankCandidate) => canReconcile(tx) && tx.side === "debit"
    && (["direct_debit", "direct_debit_hold", "sepa_direct_debit"].includes(tx.operation_type) || /\b(prlv|prelevement)\b/.test(normalizeText(tx.label)))
    && c.kind === "expense" && c.recurringSupplier && normalizeText(c.recurringSupplier).length >= 3
    && normalizeText(c.recurringSupplier) === normalizeText(tx.counterparty)
    && Math.abs(Date.parse(c.date) - Date.parse(tx.settled_at!)) <= 7 * 86_400_000;
  if (!matches.length && flow === "expense") {
    const choices = context.candidates.filter((c) => recurringMatch(transaction, c));
    const c = choices[0];
    if (choices.length === 1 && c && context.transactions.filter((other) => recurringMatch(other, c) || bankCandidateMatches(other, [c]).length).length === 1)
      return { action: "match", kind: "expense", id: c.id, month: c.month, variableDebit: true };
  }
  // An explicit invoice number also settles an identifiable late invoice or
  // a deposit. Do not apply a partial payment to maintenance or by name alone.
  if (!matches.length && flow === "receipt") {
    const possible = (tx: BankTransaction, c: BankCandidate) => canReconcile(tx) && tx.side === "credit" && c.kind === "invoice" && c.documentReference
      && normalizeText(c.documentReference).length >= 4 && mentions(tx, [c.documentReference]) && tx.amount_cents <= c.amount;
    const choices = context.candidates.filter((c) => possible(transaction,c));
    const c = choices[0];
    if (c && choices.length === 1 && context.transactions.filter((other) => possible(other,c) || bankCandidateMatches(other,[c]).length).length === 1
      && !context.candidates.some((p) => p.kind === "payment" && p.amount === transaction.amount_cents && mentions(transaction,p.identities) && Math.abs(Date.parse(p.date)-Date.parse(transaction.settled_at!)) <= 45*86_400_000))
      return { action: "match", kind: "invoice", id: c.id };
  }
  if (matches.length || context.candidates.some((candidate) => (candidate.kind === "expense") === (transaction.side === "debit")
    && Math.abs(new Date(candidate.date).getTime() - new Date(transaction.settled_at!).getTime()) <= (candidate.recurringSupplier ? 10 : 45) * 86_400_000
    && mentions(transaction, candidate.identities))
    || context.blockers.some((blocker) => blocker.side === transaction.side && mentions(transaction, blocker.identities))) {
    return { action: "defer", reason: "Plusieurs affectations sont possibles. Mouvement conservé en banque, sans créer de doublon. Rattachement réévalué automatiquement." };
  }
  if (transaction.side === "debit") return { action: "expense", category: expenseCategory(transaction) };
  const clients = context.clients.filter((client) => mentions(transaction, client.names));
  if (clients.length > 1) return { action: "defer", reason: "Homonymes : aucune prestation attribuée arbitrairement. Rattachement réévalué automatiquement." };
  if (clients.length === 1) return { action: "service", clientId: clients[0]!.id, clientName: clients[0]!.names[0]! };
  const name = transaction.counterparty.trim();
  if (!namedPayer(transaction)) {
    return { action: "defer", reason: "Payeur non identifié : aucune fiche client fictive créée." };
  }
  return { action: "service", clientName: name };
}
