"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Banknote, Link2, LoaderCircle, RefreshCw, Clock3, Unplug } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
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
  const payload = await response.json() as { error?: string; pending?: boolean; busy?: boolean; imported?: number; reconciled?: number };
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

function BankWorkspacePage() {
  const { mode, workspace, refresh } = useWorkspace();
  const allowed = mode === "supabase" && Boolean(workspace?.canManageBusiness);
  const [data, setData] = useState<BankPayload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
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
    <PageHeader eyebrow="Suivi financier automatique" title="Journal bancaire" description="Retrouvez les opérations Qonto et leur effet dans le logiciel. Aucun mouvement à valider."
      actions={allowed && connection?.connected && connection.enabled ? <Button disabled={busy} onClick={() => void sync()}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Synchroniser maintenant</Button> : undefined} />
    {!allowed ? <Card><CardContent className="p-6 text-sm">{mode === "demo" ? "Le journal bancaire est disponible en mode connecté." : "Accès réservé aux associés et administrateurs."}</CardContent></Card> : <>
      {error && <p role="alert" className="rounded-xl border border-line p-4 text-sm">{error} <Button variant="ghost" size="sm" onClick={() => void load()}>Réessayer</Button></p>}
      {!data && !error && <p role="status" className="text-sm text-zinc-500">Chargement du journal…</p>}
      {data && <Card><CardHeader><div className="flex items-center gap-3"><Banknote className="size-5 text-emerald-600" /><h2 className="font-bold">{connection?.organization_name || "Connexion Qonto"}</h2></div>
        <Badge variant={connection?.enabled ? "green" : "neutral"}>{connection?.connected ? connection.enabled ? "Automatique" : "En pause" : "Non connecté"}</Badge></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {connection?.connected && <p className="text-zinc-600">{connection.accounts.map((a) => a.name + " · ••••" + a.last4).join(" / ")}</p>}
          <p className="flex items-start gap-2 text-xs leading-5 text-zinc-500"><Clock3 className="mt-0.5 size-4 shrink-0" />{connection?.last_synced_at ? "Dernière synchronisation : " + formatDate(connection.last_synced_at, {day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}) + "." : "Aucune synchronisation terminée."} {(connection?.window_to || connection?.posting_pending) ? "Traitement partiel : il reprendra automatiquement." : "Synchronisation quotidienne lorsque la connexion est active."}</p>
          {!data.configured && <p role="alert">La clé de chiffrement serveur est nécessaire pour connecter Qonto.</p>}
          {!data.cronConfigured && <p role="alert">Le secret de la tâche planifiée Vercel n’est pas configuré. La synchronisation quotidienne est inactive.</p>}
          {connection?.last_error && <p role="alert" className="text-sm text-red-600">{connection.last_error}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !data.configured} onClick={() => setConnecting(true)}><Link2 className="size-4" />{connection?.connected ? "Actualiser les identifiants" : "Connecter Qonto"}</Button>
          {connection?.connected && <><Button variant="secondary" disabled={busy} onClick={() => void changeConnection({action:"settings",enabled:!connection.enabled})}>{connection.enabled ? "Mettre en pause" : "Reprendre"}</Button><Button variant="ghost" disabled={busy} onClick={() => setDisconnecting(true)}><Unplug className="size-4" /> Déconnecter</Button></>}</div>
        </CardContent></Card>}
      {data && <Card><CardHeader><h2 className="font-bold">Mouvements bancaires</h2><Badge>{data.total} mouvement(s)</Badge></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2"><Input className="min-w-44 flex-1" aria-label="Rechercher une transaction" placeholder="Fournisseur, client, référence…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          <Select className="w-auto" aria-label="Filtrer par sens" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="all">Tous les mouvements</option><option value="debit">Sorties</option><option value="credit">Entrées</option></Select></div>
        {data.transactions.length === 0 && <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-zinc-500">Aucun mouvement pour cette recherche.</p>}
        {data.transactions.map((tx) => <BankJournalRow key={tx.id} tx={tx} postingFrom={connection?.posting_from} />)}
        {data.total > 50 && <div className="flex items-center justify-between gap-2 text-xs"><Button size="sm" variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Précédent</Button>Page {page + 1} / {Math.ceil(data.total / 50)}<Button size="sm" variant="secondary" disabled={(page + 1)*50 >= data.total} onClick={() => setPage(page + 1)}>Suivant</Button></div>}
      </CardContent></Card>}
    </>}
    <Modal open={connecting} onClose={() => setConnecting(false)} title="Connexion Qonto" description="Vos identifiants sont chiffrés côté serveur.">{connecting && <ConnectForm onCancel={() => setConnecting(false)} onConnected={async () => { setConnecting(false); await load(); await sync(); }} />}</Modal>
    <Modal open={disconnecting} onClose={() => setDisconnecting(false)} title="Déconnecter Qonto ?"><p className="text-sm text-zinc-600">Les identifiants seront effacés. L’historique et les écritures seront conservés.</p><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setDisconnecting(false)}>Annuler</Button><Button variant="danger" disabled={busy} onClick={() => void changeConnection({action:"disconnect"})}>Déconnecter</Button></div></Modal>
  </div>;
}
