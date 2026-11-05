"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Field, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { bankDate, historicalGroupCandidates, type BankCandidate, type BankTransaction } from "@/lib/domain/banking";
import { formatMoney, normalizeText } from "@/lib/utils";

export function HistoricalGroupForm({ transactions, candidates, onDone, onCancel }: {
  transactions: BankTransaction[]; candidates: BankCandidate[]; onDone: () => Promise<void>; onCancel: () => void;
}) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const compatible = historicalGroupCandidates(transactions, candidates);
  const target = compatible.find((candidate) => candidate.key === choice);
  const total = transactions.reduce((sum, transaction) => sum + transaction.amount_cents, 0);
  const dates = transactions.map((transaction) => bankDate(transaction.settled_at ?? transaction.emitted_at)).sort();
  const differentNames = new Set(transactions.map((transaction) => normalizeText(transaction.counterparty || transaction.label))).size > 1;
  const spread = dates.length > 0 ? (new Date(dates.at(-1)!).getTime() - new Date(dates[0]!).getTime()) / 86_400_000 : 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !target || !confirmed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/qonto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reconcile_group", transactionIds: transactions.map((transaction) => transaction.id), kind: target.kind, targetId: target.id, month: target.month, note }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Regroupement impossible.");
      toast.success("Regroupement rapproché sans nouvelle écriture", { description: "Le montant et la date de votre saisie historique sont conservés." });
      await onDone();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Regroupement impossible."); }
    finally { setBusy(false); }
  };
  return <form className="space-y-5" onSubmit={submit}>
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">Pour les opérations passées que vous aviez déjà regroupées dans le logiciel. Ce rapprochement manuel ne crée ni charge ni encaissement supplémentaire et conserve la date de votre saisie.</div>
    <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-200 p-3" aria-label="Transactions du regroupement">
      {transactions.map((transaction) => <div key={transaction.id} className="flex items-start justify-between gap-3 rounded-lg bg-zinc-50 p-3 text-sm"><div className="min-w-0"><p className="font-semibold break-words">{transaction.counterparty || transaction.label}</p><p className="mt-1 text-xs text-zinc-500">{bankDate(transaction.settled_at ?? transaction.emitted_at)} · {transaction.account_name}</p></div><strong className="shrink-0">{formatMoney(transaction.amount_cents)}</strong></div>)}
    </div>
    <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-950"><span>{transactions.length} opérations · total à justifier</span><strong className="text-xl">{formatMoney(total)}</strong></div>
    {(differentNames || spread > 3) && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900">Les libellés diffèrent ou les dates sont espacées de plusieurs jours. Vérifiez qu’il s’agit bien des opérations que vous aviez regroupées. Aucun regroupement n’est décidé automatiquement.</p>}
    <Field label="Écriture historique déjà enregistrée" hint="Seuls les paiements existants ou charges déjà payées au montant total exact sont proposés."><Select required value={choice} disabled={busy} onChange={(event) => { setChoice(event.target.value); setConfirmed(false); }}><option value="">Choisir l’écriture commune…</option>{compatible.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label} · {formatMoney(candidate.amount)}</option>)}</Select></Field>
    {compatible.length === 0 && <p role="status" className="text-sm leading-6 text-orange-800">Aucune écriture disponible pour ce total. Vérifiez votre sélection et la saisie dans Finances. Une charge doit déjà être marquée payée ; une écriture déjà rapprochée ne peut pas être réutilisée.</p>}
    {target && <p className="rounded-xl bg-zinc-50 p-3 text-sm leading-6">Date conservée : <strong>{bankDate(target.date)}</strong>. Le montant restera <strong>{formatMoney(target.amount)}</strong>. Les dates bancaires individuelles restent consultables.</p>}
    <Field label="Note du regroupement (facultatif)"><Input value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Ex. deux achats du même fournisseur saisis ensemble" /></Field>
    <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" required disabled={busy || !target} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1.5 accent-brand-500" /><span>Je confirme que ces opérations sont déjà comptabilisées ensemble dans l’écriture choisie.</span></label>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Annuler</Button><Button type="submit" disabled={busy || !target || !confirmed}>{busy ? "Enregistrement…" : "Valider le regroupement historique"}</Button></div>
  </form>;
}
