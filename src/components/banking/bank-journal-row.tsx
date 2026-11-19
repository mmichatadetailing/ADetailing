import type { BankTransaction } from "@/lib/domain/banking";
import { formatDate, formatMoney } from "@/lib/utils";

function journalNote(tx: BankTransaction, postingFrom?: string) {
  if (tx.status === "pending") return "En attente du règlement bancaire";
  if (tx.status === "reversed") return "Annulée par Qonto";
  if (tx.status === "declined") return "Refusée par Qonto";
  if (tx.reconciliation === "review") return tx.posting_kind && !tx.reconciliation_group_id
    ? "Correction bancaire en cours de synchronisation" : "Mouvement bancaire modifié ; écriture historique conservée";
  if (tx.reconciliation_group_id) return "Regroupement historique conservé";
  if (tx.automation_note && (tx.posting_kind || tx.automated_at || tx.automation_note.startsWith("Archive"))) return tx.automation_note;
  if (tx.reconciliation === "matched") return "Rattaché à une écriture existante";
  if (tx.reconciliation === "ignored") return tx.ignored_reason || "Hors activité";
  if (postingFrom && tx.settled_at && Date.parse(tx.settled_at) < Date.parse(postingFrom)) return "Historique importé sans nouvelle écriture";
  return "Enregistré au journal bancaire";
}

export function BankJournalRow({ tx, postingFrom }: { tx: BankTransaction; postingFrom?: string }) {
  return <article className="grid gap-2 rounded-xl border border-line p-4 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
    <p className="text-xs text-zinc-500">{formatDate(tx.settled_at ?? tx.emitted_at)}<span className="mt-1 block">{tx.account_name}</span></p>
    <div className="min-w-0">
      <h3 className="break-words text-sm font-bold">{tx.counterparty || tx.label || "Opération bancaire"}</h3>
      <p className="text-xs text-zinc-500">{[tx.label, tx.reference].filter(Boolean).join(" · ")}</p>
      <p className="mt-2 text-xs text-zinc-600">{journalNote(tx,postingFrom)}</p>
    </div>
    <strong className={tx.side === "credit" ? "text-emerald-700" : "text-zinc-800"}>{tx.side === "credit" ? "+" : "−"}{formatMoney(tx.amount_cents)}</strong>
  </article>;
}
