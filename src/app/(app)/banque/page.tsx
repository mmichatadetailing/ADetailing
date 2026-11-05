"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Banknote, Link2, LoaderCircle, RefreshCw, Settings2, Unplug, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { bankCandidateMatches, canReconcile, type BankCandidate, type BankTransaction } from "@/lib/domain/banking";
import { formatDate, formatMoney } from "@/lib/utils";
import { HistoricalGroupForm } from "@/components/banking/historical-group-form";

interface BankPayload {
  connection: null | { organization_name: string; accounts: Array<{ name: string; last4: string }>; import_since: string; enabled: boolean; auto_reconcile: boolean; auto_intake: boolean; auto_intake_from: string; connected: boolean; last_synced_at?: string; last_error?: string; window_to?: string };
  configured: boolean; cronConfigured: boolean; transactions: BankTransaction[]; candidates: BankCandidate[];
  total: number; counts: Record<string, number>;
}
async function bankRequest(input: Record<string, unknown>) {
  const response = await fetch("/api/integrations/qonto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json() as { error?: string; pending?: boolean; busy?: boolean; imported?: number; reconciled?: number; drafts?: number };
  if (!response.ok) throw new Error(payload.error ?? "L’opération bancaire a échoué.");
  return payload;
}

function ConnectForm({ onConnected, onCancel }: { onConnected: () => Promise<void>; onCancel: () => void }) {
  const [login, setLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [since, setSince] = useState(`${new Date().getFullYear()}-01-01`);
  const [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await bankRequest({ action: "connect", login, secret, importSince: since, autoReconcile: automatic });
      setSecret("");
      toast.success("Qonto connecté");
      await onConnected();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Connexion impossible."); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="grid gap-4"><p className="rounded-xl bg-sky-50 p-4 text-xs leading-6 text-sky-900">Récupérez ces identifiants dans Qonto → Paramètres → Intégrations et Avantages → Clé API. Il ne s’agit pas de votre adresse e-mail ni de votre mot de passe. Le logiciel ne déclenchera aucun virement.</p><Field label="Identifiant API Qonto"><Input required autoComplete="off" value={login} onChange={(event) => setLogin(event.target.value)} /></Field><Field label="Clé secrète API Qonto"><Input required type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} /></Field><Field label="Importer les transactions depuis" hint="Les anciens paiements et charges seront proposés au rapprochement, sans être recréés."><Input required type="date" value={since} onChange={(event) => setSince(event.target.value)} /></Field><label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 text-xs leading-5"><input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} className="mt-1 accent-brand-500" /><span>Rapprocher automatiquement les correspondances certaines : montant exact, nom ou référence explicite, dates proches et une seule cible possible. Aucun nouveau paiement client ne sera créé automatiquement.</span></label><div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Annuler</Button><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />} {busy ? "Vérification…" : "Connecter Qonto"}</Button></div></form>;
}

function ReconcileForm({ transaction, candidates, onDone, onCancel }: { transaction: BankTransaction; candidates: BankCandidate[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const compatible = candidates.filter((candidate) => transaction.side === "debit" ? candidate.kind === "expense" && candidate.amount === transaction.amount_cents : candidate.kind !== "expense" && (candidate.kind === "payment" || candidate.kind === "maintenance" ? candidate.amount === transaction.amount_cents : candidate.amount >= transaction.amount_cents));
  const suggested = bankCandidateMatches(transaction, compatible);
  const [choice, setChoice] = useState(suggested.length === 1 ? suggested[0]!.key : "");
  const [description, setDescription] = useState(transaction.label || transaction.counterparty);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const target = compatible.find((candidate) => candidate.key === choice);
    if ((!target && choice !== "new_expense") || busy) return;
    setBusy(true);
    try {
      await bankRequest({ action: "reconcile", transactionId: transaction.id, kind: target?.kind ?? "new_expense", targetId: target?.id, month: target?.month, description, category });
      toast.success(target?.kind === "payment" ? "Paiement rapproché, sans nouvel encaissement" : "Rapprochement enregistré");
      await onDone();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Rapprochement impossible."); }
    finally { setBusy(false); }
  };
  return <form className="grid gap-4" onSubmit={submit}><div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"><strong>{formatMoney(transaction.amount_cents)}</strong> · {transaction.counterparty || transaction.label}<p className="mt-1 text-xs">Opération terminée le {formatDate(transaction.settled_at ?? transaction.emitted_at, { day: "numeric", month: "long", year: "numeric" })}</p></div><Field label="À quoi correspond cette opération ?"><Select required value={choice} onChange={(event) => setChoice(event.target.value)}><option value="">Choisir un enregistrement…</option>{compatible.map((candidate) => <option key={candidate.key} value={candidate.key}>{suggested.some((item) => item.key === candidate.key) ? "Suggestion · " : ""}{candidate.label} · {formatMoney(candidate.amount)}</option>)}{transaction.side === "debit" && <option value="new_expense">Créer une nouvelle charge ponctuelle</option>}</Select></Field>{choice === "new_expense" ? <><p className="rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-900">Vérifiez qu’aucune charge ni échéance d’abonnement n’existe déjà. Cette action crée une dépense ponctuelle et son règlement, jamais une règle mensuelle. La TVA restera à vérifier.</p><Field label="Libellé de la charge"><Input required minLength={2} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="Catégorie de la charge"><Input required minLength={2} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Produits, assurance, matériel…" /></Field></> : <p className="text-xs leading-6 text-zinc-500">Un « paiement existant » est seulement pointé à la banque. Une prestation, facture ou échéance non payée crée son encaissement au montant et à la date bancaires. Une charge récurrente est réglée uniquement pour le mois choisi.</p>}{compatible.length === 0 && transaction.side === "credit" && <p className="text-xs text-orange-800">Aucun dossier avec un solde compatible. Vérifiez les prestations et échéances d’entretien, ou classez l’opération hors exploitation si elle ne constitue pas du chiffre d’affaires. Les paiements groupés ne sont pas ventilés automatiquement.</p>}<div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Annuler</Button><Button type="submit" disabled={busy || !choice}>{busy ? "Enregistrement…" : "Valider le rapprochement"}</Button></div></form>;
}

export default function BankPage() {
  const { mode, workspace } = useWorkspace();
  return <BankWorkspacePage key={workspace?.organizationId ?? mode} />;
}

function BankWorkspacePage() {
  const { mode, workspace, refresh } = useWorkspace();
  const allowed = mode === "supabase" && Boolean(workspace?.canManageBusiness);
  const [data, setData] = useState<BankPayload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("unmatched");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<BankTransaction[]>([]);
  const [grouping, setGrouping] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [confirmation, setConfirmation] = useState<{ transaction?: BankTransaction; action: "undo" | "ignore" | "disconnect" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    if (!allowed) return;
    const version = ++requestVersion.current;
    try {
      const response = await fetch(`/api/integrations/qonto?filter=${filter}&page=${page}&q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const payload = await response.json() as BankPayload & { error?: string };
      if (version !== requestVersion.current) return;
      if (!response.ok) throw new Error(payload.error ?? "Chargement impossible.");
      setData(payload); setError("");
    } catch (cause) { if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
  }, [allowed, filter, page, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => { window.clearTimeout(timer); requestVersion.current += 1; }; }, [load]);
  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await bankRequest({ action: "sync" });
      toast.success(result.busy ? "Une synchronisation est déjà en cours" : result.pending ? "Import en cours : une partie de l’historique reste à récupérer" : "Synchronisation terminée", { description: result.busy ? undefined : `${result.drafts ?? 0} nouvelle(s) proposition(s) à valider · ${result.reconciled ?? 0} rapprochement(s). Aucun chiffre d’affaires ajouté depuis un brouillon non validé.` });
      setSelection([]);
      await Promise.all([load(), refresh()]);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Synchronisation impossible."); await load(); }
    finally { setBusy(false); }
  };
  const settings = async (enabled: boolean, autoReconcile: boolean, autoIntake?: boolean) => {
    setBusy(true);
    try { await bankRequest({ action: "settings", enabled, autoReconcile, autoIntake }); await load(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!confirmation || busy) return;
    setBusy(true);
    try {
      await bankRequest(confirmation.action === "disconnect" ? { action: "disconnect" } : { action: "reconcile", transactionId: confirmation.transaction!.id, kind: confirmation.action, reason });
      setConfirmation(null); setReason("");
      setSelection([]);
      setPage(0);
      if (confirmation.transaction?.reconciliation_group_id) { setQuery(""); setFilter("unmatched"); }
      await Promise.all([load(), refresh()]);
      toast.success("Traitement enregistré");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Traitement impossible."); }
    finally { setBusy(false); }
  };
  const connection = data?.connection;
  const toggleSelection = (transaction: BankTransaction) => {
    setSelection((current) => current.some((entry) => entry.id === transaction.id) ? current.filter((entry) => entry.id !== transaction.id) : current.length >= 50 ? current : [...current, transaction]);
  };
  const selectionTotal = selection.reduce((sum, transaction) => sum + transaction.amount_cents, 0);
  return <div className="space-y-6"><PageHeader eyebrow="Connexion bancaire en lecture seule" title="Banque & rapprochement" description="Qonto importe les mouvements. Leur rapprochement évite de recréer les paiements et charges déjà enregistrés." actions={allowed ? <Button disabled={busy || !connection?.enabled || !connection.connected} onClick={() => void sync()}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Synchronisation…" : "Synchroniser maintenant"}</Button> : undefined} />
    {!allowed ? <Card><CardContent className="p-6"><p className="font-bold">{mode === "demo" ? "La connexion bancaire nécessite le mode connecté" : "Accès réservé aux associés et administrateurs"}</p><p className="mt-2 text-sm text-zinc-500">Aucune connexion Qonto n’est effectuée en démonstration.</p></CardContent></Card> : <>
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<Button className="ml-3" variant="secondary" size="sm" onClick={() => void load()}>Réessayer</Button></div>}
      {!data && !error && <p role="status" className="flex gap-2 text-sm text-zinc-500"><LoaderCircle className="size-4 animate-spin" /> Chargement de la connexion bancaire…</p>}
      <Card><CardHeader><div className="flex items-center gap-3"><Banknote className="size-5 text-emerald-600" /><div><h2 className="font-bold">{connection?.organization_name ?? "Connecter Qonto"}</h2><p className="mt-1 text-xs text-zinc-500">{connection?.connected ? `${connection.accounts.map((account) => `${account.name} · ••••${account.last4}`).join(" · ")}` : "Tous les comptes Qonto en euros de cette entreprise."}</p></div></div><Badge variant={connection?.enabled && connection.connected ? "green" : "neutral"}>{connection?.connected ? connection.enabled ? "Connecté" : "En pause" : "Non connecté"}</Badge></CardHeader><CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !data?.configured} onClick={() => setConnecting(true)}><Link2 className="size-4" /> {connection?.connected ? "Actualiser les identifiants" : "Connecter Qonto"}</Button>{connection?.connected && <><Button variant="secondary" disabled={busy} onClick={() => void settings(!connection.enabled, connection.auto_reconcile)}>{connection.enabled ? "Mettre en pause" : "Reprendre la synchronisation"}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmation({ action: "disconnect" })}><Unplug className="size-4" /> Déconnecter</Button></>}</div>
        {data && !data.configured && <p className="text-xs text-orange-800">La clé de chiffrement serveur doit être configurée avant de saisir vos identifiants Qonto.</p>}
        {connection?.connected && <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4"><label className="flex items-start gap-3 text-sm leading-6 text-sky-950"><input type="checkbox" className="mt-1.5 accent-brand-500" checked={connection.auto_intake} disabled={busy} onChange={(event) => void settings(connection.enabled, connection.auto_reconcile, event.target.checked)} /><span><strong>Préparer automatiquement les nouvelles prestations et charges</strong><span className="mt-1 block text-xs">Actif pour les règlements bancaires à partir du {formatDate(connection.auto_intake_from, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Les anciens mouvements ne sont pas recréés. Les propositions restent hors statistiques jusqu’à votre validation.</span></span></label><div className="flex flex-wrap gap-3 text-xs font-semibold text-brand-600"><Link className="focus-ring rounded-lg px-2 py-1" href="/prestations">Voir les prestations à valider →</Link><Link className="focus-ring rounded-lg px-2 py-1" href="/finances">Voir les charges à valider →</Link></div></div>}
        {connection?.last_error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-800">Dernière synchronisation interrompue : {connection.last_error}. Les données déjà importées sont conservées.</p>}
        {connection?.connected && <><p className="text-xs leading-6 text-zinc-500">Dernière synchronisation : {connection.last_synced_at ? formatDate(connection.last_synced_at, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "pas encore effectuée"}. Import depuis le {formatDate(connection.import_since, { day: "numeric", month: "long", year: "numeric" })}. {connection.window_to && <strong className="text-orange-800">Historique incomplet : cliquez de nouveau sur Synchroniser pour poursuivre.</strong>}</p><label className="flex items-start gap-3 rounded-xl bg-zinc-50 p-3 text-xs leading-6"><input className="mt-1.5 accent-brand-500" type="checkbox" disabled={busy} checked={connection.auto_reconcile} onChange={(event) => void settings(connection.enabled, event.target.checked)} /><span>Rapprocher automatiquement les paiements existants et les échéances de charges lorsque la correspondance est certaine et unique. Les autres opérations restent à valider.</span></label></>}
        <p className="flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-xs leading-6 text-sky-900"><Settings2 className="mt-1 size-4 shrink-0" /><span>Synchronisation automatique quotidienne après déploiement et configuration du secret CRON_SECRET dans Vercel. {data && !data.cronConfigured && <strong>Le secret de planification n’est pas encore configuré.</strong>} Une connexion active n’est pas une preuve que la tâche planifiée s’est exécutée : vérifiez sa date et les journaux Vercel.</span></p>
      </CardContent></Card>
      {(data?.counts.review ?? 0) > 0 && <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><TriangleAlert className="size-5 shrink-0" /><span>Une opération rapprochée a été annulée ou modifiée dans Qonto. Vérifiez-la puis annulez son rapprochement si nécessaire. L’écriture du logiciel n’a pas été supprimée automatiquement.</span></div>}
      <Card><CardHeader><div><h2 className="font-bold">Transactions bancaires</h2><p className="mt-1 text-xs text-zinc-500">Un mouvement importé seul ne crée ni chiffre d’affaires ni charge supplémentaire.</p></div><Select aria-label="État des transactions" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }} className="w-auto">{[["unmatched", "À traiter"], ["matched", "Rapprochées"], ["review", "À vérifier"], ["ignored", "Hors exploitation"], ["all", "Toutes"]].map(([value, label]) => <option key={value} value={value}>{label}{data?.counts[value!] !== undefined ? ` (${data.counts[value!]})` : ""}</option>)}</Select></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><Input className="min-w-0 flex-1" aria-label="Rechercher une transaction bancaire" placeholder="Fournisseur, client, libellé ou référence…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />{query && <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setPage(0); }}>Effacer la recherche</Button>}</div>
        <p className="text-xs leading-6 text-zinc-500">Vous aviez regroupé plusieurs anciennes opérations en une seule saisie ? Cochez-les, puis rapprochez leur total de votre écriture historique. La sélection reste conservée entre les pages et les recherches.</p>
        {selection.length > 0 && <div role="region" aria-label="Sélection pour regroupement" className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm"><div className="text-sm text-sky-950"><strong>{selection.length} opération(s) sélectionnée(s)</strong><p className="mt-1">Total : {formatMoney(selectionTotal)} · {selection[0]?.side === "debit" ? "Dépenses" : "Encaissements"}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelection([])}>Vider la sélection</Button><Button size="sm" disabled={busy || selection.length < 2} onClick={() => setGrouping(true)}>Rapprocher le regroupement</Button></div></div>}
        {data?.transactions.length === 0 && <p className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">Aucune transaction dans cette vue. {connection?.connected ? "Synchronisez ou choisissez un autre filtre." : "Connectez Qonto pour importer les mouvements."}</p>}
        {data?.transactions.map((tx) => {
          const checked = selection.some((entry) => entry.id === tx.id);
          return <div key={tx.id} className={`grid gap-3 rounded-2xl border p-4 lg:grid-cols-[135px_minmax(0,1fr)_130px_auto] lg:items-center ${checked ? "border-sky-300 bg-sky-50/50" : "border-zinc-200 bg-white"}`}>
            <div className="flex items-center gap-3">
              {canReconcile(tx) && <input type="checkbox" aria-label={`Sélectionner ${tx.counterparty || tx.label} du ${tx.settled_at?.slice(0, 10)} · ${formatMoney(tx.amount_cents)}`} checked={checked} disabled={busy || (!checked && (selection.length >= 50 || (selection.length > 0 && selection[0]!.side !== tx.side)))} onChange={() => toggleSelection(tx)} className="size-4 shrink-0 accent-brand-500" />}
              <div className="text-xs text-zinc-500">{formatDate(tx.settled_at ?? tx.emitted_at, { day: "numeric", month: "short", year: "numeric" })}<span className="mt-1 block">{tx.account_name}</span></div>
            </div>
            <div className="min-w-0"><p className="truncate text-sm font-bold">{tx.counterparty || tx.label || "Opération bancaire"}</p><p className="mt-1 truncate text-xs text-zinc-500">{tx.label} {tx.reference}</p><p className="mt-1 text-xs text-zinc-500">{tx.reconciliation === "review" ? "À vérifier : la banque a modifié cette opération" : tx.reconciliation === "matched" ? "Rapprochée" : tx.reconciliation === "ignored" ? `Classée : ${tx.ignored_reason}` : tx.status === "completed" ? tx.operation_type === "internal_transfer" ? "Virement interne : à classer hors exploitation" : "À rapprocher" : `Statut Qonto : ${tx.status}`}</p>
              {tx.reconciliation_group_id && <><button type="button" className="focus-ring mt-2 rounded-lg bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100" onClick={() => { setQuery(tx.reconciliation_group_id!); setFilter("all"); setPage(0); }}>Regroupement historique · {tx.group_size} opérations</button>{tx.group_note && <p className="mt-1 text-xs break-words text-zinc-500">{tx.group_note}</p>}</>}
            </div>
            <p className={`font-bold ${tx.side === "credit" ? "text-emerald-700" : "text-red-700"}`}>{tx.side === "credit" ? "+" : "−"}{formatMoney(tx.amount_cents)}</p>
            <div className="flex flex-wrap gap-2">{canReconcile(tx) && <Button size="sm" disabled={busy || selection.length > 0} onClick={() => setSelected(tx)}>Rapprocher</Button>}{tx.reconciliation === "unmatched" ? <Button size="sm" variant="ghost" disabled={busy || selection.length > 0} onClick={() => setConfirmation({ action: "ignore", transaction: tx })}>Hors exploitation</Button> : <Button size="sm" variant="ghost" disabled={busy || selection.length > 0} onClick={() => setConfirmation({ action: "undo", transaction: tx })}>{tx.reconciliation_group_id ? "Annuler le regroupement" : "Annuler le traitement"}</Button>}{tx.payment_id && <Link href="/prestations" className="focus-ring rounded-lg px-2 py-1 text-xs font-semibold text-brand-600">Voir les prestations</Link>}</div>
          </div>;
        })}
        {data && data.total > 50 && <div className="flex items-center justify-between gap-3 pt-3 text-xs"><Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Précédent</Button><span>Page {page + 1} / {Math.ceil(data.total / 50)}</span><Button size="sm" variant="secondary" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage((value) => value + 1)}>Suivant</Button></div>}
      </CardContent></Card>
    </>}
    <Modal open={connecting} onClose={() => setConnecting(false)} title="Connexion Qonto" description="Identifiants chiffrés et conservés uniquement côté serveur.">{connecting && <ConnectForm onCancel={() => setConnecting(false)} onConnected={async () => { setConnecting(false); await load(); await sync(); }} />}</Modal>
    <Modal open={grouping} onClose={() => setGrouping(false)} title="Rapprocher un regroupement historique" className="sm:max-w-3xl">{grouping && <HistoricalGroupForm transactions={selection} candidates={data?.candidates ?? []} onCancel={() => setGrouping(false)} onDone={async () => { setGrouping(false); setSelection([]); setPage(0); await Promise.all([load(), refresh()]); }} />}</Modal>
    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Rapprocher cette transaction" className="sm:max-w-3xl">{selected && <ReconcileForm key={selected.id} transaction={selected} candidates={data?.candidates ?? []} onCancel={() => setSelected(null)} onDone={async () => { setSelected(null); await Promise.all([load(), refresh()]); }} />}</Modal>
    <Modal open={Boolean(confirmation)} onClose={() => { if (!busy) setConfirmation(null); }} title={confirmation?.action === "disconnect" ? "Déconnecter Qonto ?" : confirmation?.action === "ignore" ? "Classer hors exploitation" : confirmation?.transaction?.reconciliation_group_id ? "Annuler tout le regroupement ?" : "Annuler le traitement bancaire ?"}>
      <div className="space-y-4"><p className="text-sm leading-6 text-zinc-600">{confirmation?.action === "disconnect" ? "Les identifiants seront effacés et la synchronisation arrêtée. Les transactions et rapprochements seront conservés." : confirmation?.action === "ignore" ? "Pour un virement entre comptes, un apport, un prêt ou toute opération qui ne doit pas créer du chiffre d’affaires ou une charge d’exploitation." : confirmation?.transaction?.reconciliation_group_id ? `Les ${confirmation.transaction.group_size} opérations du regroupement redeviendront à traiter. Votre charge ou paiement historique sera conservé, avec son montant, sa date et son statut payé. Aucun membre ne sera annulé isolément.` : confirmation?.transaction?.created_entry && confirmation.transaction.payment_id ? "L’encaissement créé par ce rapprochement sera supprimé et le dossier redeviendra à payer. Un paiement qui existait avant le rapprochement est toujours conservé." : "Le lien bancaire sera retiré. Les paiements déjà saisis sont conservés. Le règlement bancaire d’une charge est annulé ; sa règle de dépense et ses prévisions restent conservées."}</p>
        {confirmation?.action === "ignore" && <Field label="Motif"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Virement interne, apport, prêt…" /></Field>}
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>Annuler</Button><Button variant="danger" disabled={busy || confirmation?.action === "ignore" && reason.trim().length < 3} onClick={() => void confirm()}>{busy ? "Enregistrement…" : "Confirmer"}</Button></div>
      </div>
    </Modal>
  </div>;
}
