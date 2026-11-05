"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace-provider";
import { useDraftChanges } from "@/components/use-draft-changes";
import { useDemoStore } from "@/lib/demo/store";
import { bankDate, bankCandidateMatches, canReconcile, type BankCandidate } from "@/lib/domain/banking";
import type { BankDraft, BankDraftPayload } from "@/lib/domain/bank-drafts";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

async function draftRequest(input: object) {
  const response = await fetch("/api/integrations/qonto/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json() as { error?: string; interventionId?: string; expenseId?: string };
  if (!response.ok) throw new Error(data.error ?? "La proposition n’a pas pu être enregistrée.");
  return data;
}

export function BankDraftEditor({ draft, candidates, onDone, onCancel, onDirtyChange, onBusyChange }: {
  draft: BankDraft; candidates: BankCandidate[]; onDone: (result?: { interventionId?: string; expenseId?: string }) => Promise<void>; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const clients = useDemoStore((data) => data.clients);
  const team = useDemoStore((data) => data.team);
  const tx = draft.transaction;
  const compatible = candidates.filter((candidate) => tx.side === "debit" ? candidate.kind === "expense" && candidate.amount === tx.amount_cents : candidate.kind !== "expense" && ((candidate.kind === "payment" || candidate.kind === "maintenance") ? candidate.amount === tx.amount_cents : candidate.amount >= tx.amount_cents));
  const suggested = bankCandidateMatches(tx, compatible);
  const [targetKey, setTargetKey] = useState(draft.payload.targetKey === "new" || compatible.some((candidate) => candidate.key === draft.payload.targetKey) ? draft.payload.targetKey! : suggested.length === 1 ? suggested[0]!.key : "new");
  const [payload, setPayload] = useState<BankDraftPayload>(draft.payload);
  const [confirmNew, setConfirmNew] = useState(false);
  const [busy, setBusy] = useState(false);
  useDraftChanges({ payload }, onDirtyChange);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const patch = (input: Partial<BankDraftPayload>) => { setPayload((current) => ({ ...current, ...input })); setConfirmNew(false); };
  const target = compatible.find((candidate) => candidate.key === targetKey);
  const perform = async (validate: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await draftRequest({ action: validate ? "validate" : "save", draftId: draft.id, expectedUpdatedAt: draft.updated_at, payload,
        ...(validate ? { expectedAmount: tx.amount_cents, expectedSettledAt: tx.settled_at, targetKind: target?.kind ?? "new", targetId: target?.id, month: target?.month, confirmNew } : {}) });
      toast.success(validate ? "Opération validée et intégrée aux statistiques" : "Brouillon enregistré");
      await onDone(validate ? result : undefined);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void perform(true); };
  return <form onSubmit={submit} className="space-y-5">
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950"><strong>{formatMoney(tx.amount_cents)}</strong> · {tx.side === "credit" ? "Reçu" : "Débité"} le {bankDate(tx.settled_at ?? tx.emitted_at)}<p className="text-xs">{tx.counterparty || tx.label} · {tx.account_name}. Ce montant et cette date proviennent de la banque ; ils ne sont pas remplacés par les informations de la prestation.</p></div>
    {!canReconcile(tx) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Cette opération a changé ou n’est plus disponible. Actualisez la liste ; sa validation est bloquée.</p>}
    {suggested.length > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">Un enregistrement correspondant existe peut-être déjà. Vérifiez les propositions ci-dessous pour ne pas compter deux fois la même opération.</p>}
    <Field label="Que faut-il valider ?"><Select value={targetKey} disabled={busy} onChange={(event) => { setTargetKey(event.target.value); patch({ targetKey: event.target.value }); }}><option value="new">{tx.side === "credit" ? "Créer une nouvelle prestation et son paiement" : "Créer une nouvelle charge ponctuelle"}</option>{compatible.map((candidate) => <option key={candidate.key} value={candidate.key}>{suggested.some((entry) => entry.key === candidate.key) ? "Correspondance possible · " : ""}{candidate.label} · {formatMoney(candidate.amount)}</option>)}</Select></Field>
    {targetKey === "new" ? <>
      <Field label={tx.side === "credit" ? "Intitulé de la prestation" : "Libellé de la charge"}><Input required minLength={2} maxLength={160} disabled={busy} value={payload.title} onChange={(event) => patch({ title: event.target.value })} /></Field>
      {tx.side === "credit" ? <>
        <Field label="Client"><Select required disabled={busy} value={payload.clientId ?? ""} onChange={(event) => patch({ clientId: event.target.value || null })}><option value="">Sélectionner le client…</option>{clients.filter((client) => !client.archivedAt).map((client) => <option key={client.id} value={client.id}>{client.company || `${client.firstName} ${client.lastName}`}</option>)}</Select></Field>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => window.dispatchEvent(new CustomEvent("adetailing:open-add", { detail: "client" }))}>Créer un client, puis le sélectionner</Button>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Réalisation"><Select disabled={busy} value={payload.completed ? "completed" : "planned"} onChange={(event) => patch({ completed: event.target.value === "completed" })}><option value="completed">Prestation déjà effectuée</option><option value="planned">Prestation à réaliser / acompte</option></Select></Field><Field label={payload.completed ? "Date de réalisation" : "Date prévue (facultatif)"}><Input type="date" disabled={busy} required={payload.completed} max={payload.completed ? bankDate(new Date().toISOString()) : undefined} value={payload.performedOn} onChange={(event) => patch({ performedOn: event.target.value })} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Prix total de la prestation (€)" hint="Peut être supérieur au paiement reçu : le reste restera à encaisser."><Input type="number" required disabled={busy} step="0.01" min={tx.amount_cents / 100} value={payload.revenue / 100} onChange={(event) => patch({ revenue: Math.round(Number(event.target.value) * 100) })} /></Field><Field label="Durée (minutes)" hint="Laissez 0 si elle reste à renseigner."><Input type="number" required disabled={busy} min={0} max={1440} value={payload.durationMinutes} onChange={(event) => patch({ durationMinutes: Number(event.target.value) })} /></Field></div>
        <Field label="Collaborateur (facultatif)"><Select disabled={busy} value={payload.workerId ?? ""} onChange={(event) => patch({ workerId: event.target.value || null })}><option value="">À affecter</option>{team.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</Select></Field>
      </> : <>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Fournisseur"><Input disabled={busy} maxLength={300} value={payload.supplier} onChange={(event) => patch({ supplier: event.target.value })} /></Field><Field label="Catégorie"><Input required minLength={2} disabled={busy} maxLength={120} value={payload.category} onChange={(event) => patch({ category: event.target.value })} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Date de la charge"><Input type="date" required disabled={busy} value={payload.expenseDate} onChange={(event) => patch({ expenseDate: event.target.value })} /></Field><Field label="Famille"><Select disabled={busy} value={payload.family} onChange={(event) => patch({ family: event.target.value as BankDraftPayload["family"] })}><option value="variable">Variable</option><option value="fixed">Fixe</option><option value="investment">Investissement</option><option value="personal">Personnel</option></Select></Field></div>
        <Field label="TVA (%)" hint="À vérifier sur le justificatif : aucune TVA n’est devinée depuis le débit bancaire."><Input type="number" disabled={busy} min={0} max={100} step="0.01" value={payload.vatRateBasisPoints / 100} onChange={(event) => patch({ vatRateBasisPoints: Math.round(Number(event.target.value) * 100) })} /></Field>
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" disabled={busy || payload.family === "personal"} checked={payload.vatRecoverable && payload.family !== "personal"} onChange={(event) => patch({ vatRecoverable: event.target.checked })} className="mt-1.5 accent-brand-500" /><span>TVA récupérable, après vérification du justificatif.</span></label>
        <p className="text-xs leading-6 text-zinc-500">Pour un abonnement déjà prévu, sélectionnez son échéance existante au-dessus. Une nouvelle charge créée ici est ponctuelle.</p>
      </>}
      <Field label="Notes (facultatif)"><Input disabled={busy} maxLength={5000} value={payload.notes} onChange={(event) => patch({ notes: event.target.value })} /></Field>
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" required disabled={busy} className="mt-1.5 accent-brand-500" checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} /><span>J’ai vérifié qu’il s’agit d’une nouvelle saisie, pas d’une opération déjà comptabilisée.</span></label>
    </> : <p className="rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">Le règlement sera rattaché à l’enregistrement choisi. Un paiement déjà saisi ne sera pas recréé et aucune prestation supplémentaire ne sera ajoutée.</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Annuler</Button><Button variant="secondary" disabled={busy} onClick={() => void perform(false)}>Enregistrer le brouillon</Button><Button type="submit" disabled={busy || !canReconcile(tx) || (targetKey === "new" && !confirmNew)}><CheckCircle2 className="size-4" />{busy ? "Enregistrement…" : "Valider l’intégration"}</Button></div>
  </form>;
}

function DraftInbox({ side }: { side: "credit" | "debit" }) {
  const { refresh } = useWorkspace();
  const router = useRouter();
  const [drafts, setDrafts] = useState<BankDraft[]>([]);
  const [candidates, setCandidates] = useState<BankCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<BankDraft | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [deleting, setDeleting] = useState<BankDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const request = ++version.current;
    try {
      const response = await fetch(`/api/integrations/qonto/drafts?side=${side}&status=${status}&page=${page}`, { cache: "no-store" });
      const payload = await response.json() as { drafts: BankDraft[]; total: number; candidates: BankCandidate[]; error?: string };
      if (request !== version.current) return;
      if (!response.ok) throw new Error(payload.error ?? "Chargement des propositions impossible.");
      setDrafts(payload.drafts); setTotal(payload.total); setCandidates(payload.candidates); setError("");
    } catch (cause) { if (request === version.current) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
  }, [page, side, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { version.current += 1; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [load]);
  const removeOrRestore = async (draft: BankDraft, action: "dismiss" | "restore") => {
    if (busy) return;
    setBusy(true);
    try {
      await draftRequest({ action, draftId: draft.id, expectedUpdatedAt: draft.updated_at });
      setDeleting(null); await load();
      toast.success(action === "dismiss" ? "Proposition supprimée ; elle ne sera pas recréée automatiquement" : "Proposition restaurée");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Opération impossible."); }
    finally { setBusy(false); }
  };
  const closeEditor = () => { if (!editorBusy) { if (editorDirty) setDiscarding(true); else setSelected(null); } };
  return <Card>
    <CardHeader><div><h2 className="font-bold">{side === "credit" ? "Prestations Qonto à valider" : "Charges Qonto à valider"} {status === "pending" ? `(${total})` : "· supprimées"}</h2><p className="mt-1 text-xs leading-6 text-zinc-500">Préparées automatiquement à partir des nouveaux mouvements. Aucun effet sur les statistiques tant que vous ne validez pas.</p></div><div className="flex flex-wrap gap-2"><Select aria-label={`Afficher les propositions ${side === "credit" ? "de prestations" : "de charges"}`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} className="w-auto"><option value="pending">À valider</option><option value="dismissed">Supprimées</option></Select><Button size="sm" variant="ghost" aria-label="Actualiser les propositions Qonto" onClick={() => void load()}><RefreshCw className="size-4" /></Button></div></CardHeader>
    <CardContent className="space-y-3">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!error && drafts.length === 0 && <p className="text-sm text-zinc-500">{status === "pending" ? "Aucune proposition à valider pour le moment." : "Aucune proposition supprimée."}</p>}
      {drafts.map((draft) => <div key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50/40 p-4"><div className="min-w-0"><p className="font-semibold break-words">{draft.payload.title}</p><p className="mt-1 text-xs text-zinc-500">{draft.transaction.counterparty || draft.transaction.label} · {bankDate(draft.transaction.settled_at ?? draft.transaction.emitted_at)} · <strong>{formatMoney(draft.transaction.amount_cents)}</strong></p>{!canReconcile(draft.transaction) && <p className="mt-1 text-xs text-red-700">Opération bancaire modifiée ou indisponible : à vérifier.</p>}</div><div className="flex flex-wrap gap-2">{status === "pending" ? <><Button size="sm" variant="secondary" onClick={() => { setEditorDirty(false); setEditorBusy(false); setSelected(draft); }}><Pencil className="size-4" /> Vérifier / modifier</Button><Button size="sm" variant="ghost" aria-label={`Supprimer la proposition ${draft.payload.title}`} onClick={() => setDeleting(draft)}><Trash2 className="size-4 text-red-600" /></Button></> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => void removeOrRestore(draft, "restore")}><RotateCcw className="size-4" /> Restaurer</Button>}</div></div>)}
      {total > 20 && <div className="flex items-center justify-between gap-2 text-xs"><Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Précédent</Button><span>Page {page + 1} / {Math.ceil(total / 20)}</span><Button size="sm" variant="secondary" disabled={(page + 1) * 20 >= total} onClick={() => setPage((value) => value + 1)}>Suivant</Button></div>}
      <Link href="/banque" className="focus-ring inline-block rounded-lg py-1 text-xs font-semibold text-brand-600">Configurer ou synchroniser Qonto →</Link>
    </CardContent>
    <Modal open={Boolean(selected)} onClose={closeEditor} title={side === "credit" ? "Valider la prestation proposée" : "Valider la charge proposée"} className="sm:max-w-3xl">{selected && <BankDraftEditor key={selected.id} draft={selected} candidates={candidates} onCancel={closeEditor} onDirtyChange={setEditorDirty} onBusyChange={setEditorBusy} onDone={async (result) => { setSelected(null); setPage(0); await Promise.all([load(), refresh()]); if (result?.interventionId) { void fetch("/api/integrations/google/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined); router.push(`/prestations?intervention=${result.interventionId}&edit=1`); } }} />}</Modal>
    <Modal open={discarding} onClose={() => setDiscarding(false)} title="Quitter sans enregistrer ?"><p className="text-sm leading-6 text-zinc-600">Les modifications non enregistrées seront abandonnées. La proposition bancaire et son dernier brouillon sauvegardé seront conservés.</p><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDiscarding(false)}>Continuer la modification</Button><Button variant="danger" onClick={() => { setDiscarding(false); setSelected(null); }}>Abandonner les modifications</Button></div></Modal>
    <Modal open={Boolean(deleting)} onClose={() => { if (!busy) setDeleting(null); }} title="Supprimer cette proposition ?"><p className="text-sm leading-6 text-zinc-600">Aucune prestation, charge ou paiement ne sera créé. La transaction Qonto reste conservée, et cette proposition ne sera pas recréée à la prochaine synchronisation. Vous pourrez la restaurer depuis « Supprimées ».</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>Annuler</Button><Button variant="danger" disabled={busy} onClick={() => deleting && void removeOrRestore(deleting, "dismiss")}>Supprimer la proposition</Button></div></Modal>
  </Card>;
}

export function BankDraftInbox({ side }: { side: "credit" | "debit" }) {
  const { mode, workspace } = useWorkspace();
  if (mode !== "supabase" || !workspace?.canManageBusiness) return null;
  return <DraftInbox key={`${workspace.organizationId}:${side}`} side={side} />;
}
