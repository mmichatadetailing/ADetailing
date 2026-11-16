import { normalizeText } from "@/lib/utils";
import { bankCandidateMatches, canReconcile, type BankCandidate, type BankTransaction } from "./banking";

export interface AutomationClient { id: string; names: string[] }
export interface AutomationBlocker { side: "credit" | "debit"; identities: string[] }
export type QontoDecision =
  | { action: "match"; kind: BankCandidate["kind"]; id: string; month?: string }
  | { action: "expense"; category: string }
  | { action: "service"; clientId?: string; clientName: string }
  | { action: "review"; reason: string }
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
  if (transaction.operation_type === "internal_transfer") return { action: "ignore", reason: "Virement entre comptes Qonto de l’entreprise" };
  if (!canReconcile(transaction)) return { action: "review", reason: "Opération bancaire non éligible." };
  if (transaction.side === "credit" && !["transfer", "income"].includes(transaction.operation_type)) {
    return { action: "review", reason: "Ce crédit n’est pas un virement client ordinaire (remboursement ou rémunération possible)." };
  }
  const text = normalizeText(`${transaction.operation_type} ${transaction.counterparty} ${transaction.label} ${transaction.reference}`);
  if (/\b(remboursement|refund|cashback|apport|capital|emprunt|pret|loan|dividende|salaire|salary|retrait|withdrawal|stripe|sumup|paypal|adyen)\b/.test(text)) {
    return { action: "review", reason: "Nature du mouvement à confirmer : financement, remboursement, rémunération ou versement agrégé possible." };
  }
  const matches = bankCandidateMatches(transaction, context.candidates);
  if (matches.length === 1) {
    const match = matches[0]!;
    const competitors = context.transactions.filter((other) => bankCandidateMatches(other, [match]).length > 0);
    if (competitors.length === 1) return { action: "match", kind: match.kind, id: match.id, ...(match.month ? { month: match.month } : {}) };
  }
  if (matches.length || context.candidates.some((candidate) => (candidate.kind === "expense") === (transaction.side === "debit")
    && Math.abs(new Date(candidate.date).getTime() - new Date(transaction.settled_at!).getTime()) <= 45 * 86_400_000
    && mentions(transaction, candidate.identities))
    || context.blockers.some((blocker) => blocker.side === transaction.side && mentions(transaction, blocker.identities))) {
    return { action: "review", reason: "Une écriture existante peut correspondre : montant, date ou affectation à vérifier pour éviter un doublon." };
  }
  if (transaction.side === "debit") return { action: "expense", category: "Achats Qonto" };
  const clients = context.clients.filter((client) => mentions(transaction, client.names));
  if (clients.length > 1) return { action: "review", reason: "Plusieurs clients correspondent au nom bancaire." };
  if (clients.length === 1) return { action: "service", clientId: clients[0]!.id, clientName: clients[0]!.names[0]! };
  const name = transaction.counterparty.trim();
  if (normalizeText(name).length < 3 || /^(virement|carte|paiement|inconnu|client|qonto|transfer|payment)$/i.test(name)) {
    return { action: "review", reason: "Le nom du client n’est pas identifiable dans ce paiement." };
  }
  return { action: "service", clientName: name };
}
