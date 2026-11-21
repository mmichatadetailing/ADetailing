"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ServiceCreditForm } from "@/components/banking/service-credit-form";
import { isInternalLedgerHistory } from "@/lib/domain/ledger-history";
import { FinanceState } from "@/components/banking/finance-state";
import { connectionState } from "@/lib/domain/finance-presentation";
import { journalLinks } from "@/lib/domain/journal-links";
import { useDemoStore } from "@/lib/demo/store";
import { Banknote, Settings2, Link2, LoaderCircle, RefreshCw, Clock3, Unplug } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { BankTransaction } from "@/lib/domain/banking";
import { formatDate } from "@/lib/utils";
import { BankJournalRow } from "@/components/banking/bank-journal-row";

interface BankPayload {
  connection: null | { organization_name: string; accounts: Array<{ name: string; last4: string }>; import_since: string; enabled: boolean; posting_from: string; posting_pending: boolean; connected: boolean; last_synced_at?: string; last_error?: string; window_to?: string };
  configured: boolean; cronConfigured: boolean; transactions: BankTransaction[];
  total: number;
}
async function bankRequest(input: Record<string, unknown>) {
  const response = await fetch("/api/integrations/qonto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json() as { error?: string; pending?: boolean; busy?: boolean; imported?: number; reconciled?: number; kind?: string; interventionId?: string | null };
  if (!response.ok) throw new Error(payload.error ?? "L’opération bancaire a échoué.");
  return payload;
}

function ConnectForm({ onConnected, onCancel }: { onConnected: () => Promise<void>; onCancel: () => void }) {
  const [login, setLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [since, setSince] = useState(`${new Date().getFullYear()}-01-01`);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await bankRequest({ action: "connect", login, secret, importSince: since });
      setSecret("");
      toast.success("Qonto connecté");
      await onConnected();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Connexion impossible."); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="grid gap-4"><p className="rounded-xl bg-sky-50 p-4 text-xs leading-6 text-sky-900">Récupérez ces identifiants dans Qonto → Paramètres → Intégrations et Avantages → Clé API. Il ne s’agit pas de votre adresse e-mail ni de votre mot de passe. Le logiciel ne déclenchera aucun virement.</p><Field label="Identifiant API Qonto"><Input required autoComplete="off" value={login} onChange={(event) => setLogin(event.target.value)} /></Field><Field label="Clé secrète API Qonto"><Input required type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} /></Field><Field label="Importer les transactions depuis" hint="L’historique est importé pour consultation. Les nouvelles opérations sont intégrées automatiquement."><Input required type="date" value={since} onChange={(event) => setSince(event.target.value)} /></Field><div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Annuler</Button><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />} {busy ? "Vérification…" : "Connecter Qonto"}</Button></div></form>;
}

export default function BankPage() {
  const { mode, workspace } = useWorkspace();
  return <BankWorkspacePage key={workspace?.organizationId ?? mode} />;
}

function JournalEntries({transactions, postingFrom, onDeclare}: {transactions: BankTransaction[]; postingFrom?: string; onDeclare: (tx: BankTransaction) => void}) {
  const expenses = useDemoStore(s => s.expenses), payments = useDemoStore(s => s.payments);
  const interventions = useDemoStore(s => s.interventions), maintenanceContracts = useDemoStore(s => s.maintenanceContracts);
  const maintenanceBillingPeriods = useDemoStore(s => s.maintenanceBillingPeriods);
  const link = useMemo(() => journalLinks({expenses,payments,interventions,maintenanceContracts,maintenanceBillingPeriods}), [expenses,payments,interventions,maintenanceContracts,maintenanceBillingPeriods]);
  return transactions.map(tx => <BankJournalRow key={tx.id} tx={tx} postingFrom={postingFrom} destination={link(tx)} onDeclare={onDeclare} />);
}

function BankWorkspacePage() {
  const { mode, workspace, refresh } = useWorkspace();
  const router = useRouter();
  const [credit, setCredit] = useState<BankTransaction | null>(null);
  const allowed = mode === "supabase" && Boolean(workspace?.canManageBusiness);
  const [data, setData] = useState<BankPayload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
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
  useEffect(() => {
    if (!allowed) return;
    const onHash = () => { if (window.location.hash === "#connexion") setShowSettings(true); };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    const reloadVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(reloadVisible, 120_000);
    document.addEventListener("visibilitychange", reloadVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", reloadVisible); };
  }, [allowed, load]);
  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await bankRequest({ action: "sync" });
      toast.success(result.busy ? "Synchronisation déjà en cours" : result.pending ? "Import en cours : reprise automatique au prochain passage" : "Journal et écritures à jour");
      await Promise.all([load(), refresh()]);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Synchronisation impossible."); await load(); }
    finally { setBusy(false); }
  };
  const changeConnection = async (input: { action: "settings"; enabled: boolean } | { action: "disconnect" }) => {
    if (busy) return;
    setBusy(true);
    try { await bankRequest(input); setDisconnecting(false); await load(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  };
  const connection = data?.connection;
  return <div className="space-y-6">
    <PageHeader eyebrow="Banque · Qonto" title="Journal bancaire" description="Suivez les entrées et les sorties. Un justificatif ou un payeur identifié permet de reconnaître une prestation ; vous pouvez aussi la déclarer depuis un crédit."
      actions={allowed && <Link href="/finances" className="focus-ring inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:underline">Voir les finances</Link>} />
    {!allowed ? <Card><CardContent className="flex items-start gap-4 p-5 sm:p-6">
      <span data-tone="teal" className="tone-icon grid size-10 shrink-0 place-items-center rounded-xl"><Banknote className="size-5" /></span>
      {mode === "demo" ? <div><h2 className="font-bold">Aucun compte bancaire en démonstration</h2><p className="mt-1 text-sm text-zinc-600">Le journal bancaire est disponible en mode connecté.</p><p className="mt-2 text-sm text-zinc-600">Une fois Qonto relié à l’entreprise, les mouvements importés indiquent la charge ou le paiement correspondant.</p>
        <Link href="/finances" className="focus-ring mt-2 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold hover:underline">Consulter les finances de démonstration</Link></div>
      : <div><h2 className="font-bold">Journal réservé à la gestion</h2><p className="mt-1 text-sm text-zinc-600">Accès réservé aux associés et administrateurs.</p></div>}
    </CardContent></Card> : <>
      {error && <p role="alert" className="rounded-xl border border-line p-4 text-sm">{error} <Button variant="ghost" size="sm" onClick={() => void load()}>Réessayer</Button></p>}
      {!data && !error && <p role="status" className="text-sm text-zinc-500">Chargement du journal…</p>}
      {data && <section id="connexion" aria-label="État de la connexion Qonto" className="scroll-mt-24"><Card>
        <CardContent className="space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><span data-tone="teal" className="tone-icon grid size-10 shrink-0 place-items-center rounded-xl"><Banknote className="size-5" /></span>
          <div><h2 className="break-words font-bold">{connection?.organization_name || "Connexion Qonto"}</h2><p className="text-xs text-zinc-500">{connection?.connected ? connection.accounts.map((a) => a.name + " · ••••" + a.last4).join(" / ") : "Aucun compte bancaire actif"}</p></div></div>
          <FinanceState {...connectionState(connection, data.configured, data.cronConfigured)} />
        </div>
        <p className="flex items-start gap-2 text-sm text-zinc-600"><Clock3 className="mt-0.5 size-4 shrink-0" />{connection?.last_synced_at ? "Dernière synchronisation : " + formatDate(connection.last_synced_at, {day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "Aucune synchronisation terminée."}</p>
        {!data.configured && <p role="alert" className="text-sm text-amber-700">La clé de chiffrement serveur est nécessaire pour connecter Qonto.</p>}
        {!data.cronConfigured && <p role="alert" className="text-sm text-amber-700">La tâche planifiée n’est pas configurée. La synchronisation quotidienne est inactive.</p>}
        {connection?.last_error && <p role="alert" className="break-words text-sm text-red-600">{connection.last_error}</p>}
        {!connection?.connected ? <Button disabled={busy || !data.configured} onClick={() => setConnecting(true)}><Link2 className="size-4" />Connecter Qonto</Button> :
          <><button type="button" aria-expanded={showSettings} aria-controls="qonto-settings" className="focus-ring flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-brand-700 hover:underline" onClick={() => setShowSettings(!showSettings)}><Settings2 className="size-4" />Réglages de connexion</button>
          <div id="qonto-settings" hidden={!showSettings}><div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {connection.enabled && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void sync()}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />Synchroniser maintenant</Button>}
            <Button size="sm" variant="secondary" disabled={busy || !data.configured} onClick={() => setConnecting(true)}><Link2 className="size-4" />Actualiser les identifiants</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void changeConnection({action:"settings",enabled:!connection.enabled})}>{connection.enabled ? "Mettre en pause" : "Reprendre"}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDisconnecting(true)}><Unplug className="size-4" />Déconnecter</Button>
          </div></div></>}
        </CardContent></Card></section>}
      {data && <Card><CardHeader className="flex-wrap"><div><h2 className="font-bold">Mouvements bancaires</h2><p className="mt-1 text-sm text-zinc-500">Chaque ligne indique si le mouvement a alimenté une charge, un encaissement ou seulement le journal.</p></div><Badge>{data.total} mouvement(s)</Badge></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label="Filtrer par sens" data-tone="teal" className="finance-nav">{([["all","Tous"],["credit","Entrées"],["debit","Sorties"]] as const).map(([id,label]) => <button key={id} type="button" className="focus-ring" aria-pressed={id === filter} onClick={() => { setFilter(id); setPage(0); }}>{label}</button>)}</div>
          <Input type="search" className="w-full sm:max-w-xs" aria-label="Rechercher une transaction" placeholder="Fournisseur, client, référence…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></div>
        {data.transactions.length === 0 && <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-zinc-500">{query || filter !== "all" ? <><p>Aucun mouvement ne correspond aux filtres.</p><Button variant="ghost" size="sm" onClick={() => { setQuery(""); setFilter("all"); setPage(0); }}>Effacer les filtres</Button></> : connection?.connected ? "Aucun mouvement importé sur la période d’historique." : "Les mouvements apparaîtront ici après la connexion et la première synchronisation."}</div>}
        {data.transactions.length > 0 && <JournalEntries transactions={data.transactions} postingFrom={connection?.posting_from} onDeclare={setCredit} />}
        {data.total > 50 && <div className="flex items-center justify-between gap-2 text-xs"><Button size="sm" variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Précédent</Button>Page {page + 1} / {Math.ceil(data.total / 50)}<Button size="sm" variant="secondary" disabled={(page + 1)*50 >= data.total} onClick={() => setPage(page + 1)}>Suivant</Button></div>}
      </CardContent></Card>}
    </>}
    {credit?.settled_at && <ServiceCreditForm key={credit.id} tx={credit} historical={isInternalLedgerHistory(credit.settled_at) || Boolean(connection && Date.parse(credit.settled_at) < Date.parse(connection.posting_from))} onClose={() => setCredit(null)}
      onSubmit={async details => {
        const result = await bankRequest({ action:"declare_service", transactionId:credit.id, expectedAmount:credit.amount_cents, expectedSettledAt:credit.settled_at, expectedVersion:credit.remote_updated_at, ...details });
        setCredit(null);
        toast.success(result.kind === "service" ? "Prestation créée et encaissée" : "Règlement rattaché, sans double encaissement");
        await Promise.all([load(), refresh()]);
        if (result.interventionId) router.push("/prestations?intervention=" + encodeURIComponent(result.interventionId));
      }} />}
    <Modal open={connecting} onClose={() => setConnecting(false)} title="Connexion Qonto" description="Vos identifiants sont chiffrés côté serveur.">{connecting && <ConnectForm onCancel={() => setConnecting(false)} onConnected={async () => { setConnecting(false); await load(); await sync(); }} />}</Modal>
    <Modal open={disconnecting} onClose={() => setDisconnecting(false)} title="Déconnecter Qonto ?"><p className="text-sm text-zinc-600">Les identifiants seront effacés. L’historique et les écritures seront conservés.</p><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setDisconnecting(false)}>Annuler</Button><Button variant="danger" disabled={busy} onClick={() => void changeConnection({action:"disconnect"})}>Déconnecter</Button></div></Modal>
  </div>;
}
