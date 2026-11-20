import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { JournalLink } from "@/lib/domain/journal-links";
import { FinanceState } from "./finance-state";
import { journalState } from "@/lib/domain/finance-presentation";
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

export function BankJournalRow({ tx, postingFrom, destination }: { tx: BankTransaction; postingFrom?: string; destination?: JournalLink }) {
  const credit = tx.side === "credit";
  const Icon = credit ? ArrowDownLeft : ArrowUpRight;
  const title = tx.counterparty || tx.label || "Opération bancaire";
  const detail = [tx.label !== title && tx.label, tx.reference].filter(Boolean).join(" · ");
  const amount = tx.currency === "EUR" ? formatMoney(tx.amount_cents) : new Intl.NumberFormat("fr-FR", {style:"currency", currency:tx.currency}).format(tx.amount_cents / 100);
  return <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
    <span data-tone={credit ? "emerald" : "blue"} className="tone-icon grid size-9 place-items-center rounded-full"><Icon aria-hidden="true" className="size-4" /></span>
    <div className="min-w-0"><p className="text-xs text-zinc-500">{formatDate(tx.settled_at ?? tx.emitted_at)} · {tx.account_name}</p>
      <h3 className="mt-1 break-words text-sm font-bold">{title}</h3>{detail && <p className="break-words text-xs text-zinc-500">{detail}</p>}
    </div>
    <strong data-tone={credit ? "emerald" : "neutral"} className="col-start-2 self-start text-base tabular-nums text-[var(--tone-color)] sm:col-start-3"><span className="sr-only">{credit ? "Entrée" : "Sortie"} : </span>{credit ? "+" : "−"}{amount}</strong>
    <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2"><FinanceState {...journalState(tx, postingFrom)} /><p className="break-words text-xs leading-5 text-zinc-600">{journalNote(tx, postingFrom)}</p>
      {destination && <Link href={destination.href} className="focus-ring inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold underline decoration-dotted underline-offset-4 hover:decoration-solid sm:ml-auto">{destination.label}</Link>}
    </div>
  </article>;
}
