"use client";

import { AlertCircle, CalendarCheck2, CalendarDays, LoaderCircle, RefreshCw, Save, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
}

interface GoogleConnection {
  id: string;
  email: string;
  selected: string[];
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  calendars: GoogleCalendar[];
  error?: string;
}

interface ConnectionsResponse {
  configured?: boolean;
  connections?: GoogleConnection[];
  error?: string;
}

const oauthMessages: Record<string, { kind: "success" | "error"; text: string }> = {
  connected: { kind: "success", text: "Google Calendar est connecté. Vérifiez le calendrier choisi ci-dessous." },
  "access-denied": { kind: "error", text: "L’autorisation Google a été annulée." },
  "missing-config": { kind: "error", text: "La configuration Google Calendar du serveur est incomplète." },
  "invalid-state": { kind: "error", text: "La demande Google a expiré. Relancez la connexion." },
  "token-error": { kind: "error", text: "Google n’a pas pu finaliser la connexion." },
  "no-refresh-token": { kind: "error", text: "Google n’a pas fourni l’accès hors ligne. Reconnectez le compte." },
  "no-organization": { kind: "error", text: "Aucune entreprise active n’est associée à cette session." },
  "account-error": { kind: "error", text: "Le compte Google n’a pas pu être identifié." },
  "save-error": { kind: "error", text: "La connexion Google n’a pas pu être enregistrée." },
};

function formatLastSync(value: string | null) {
  if (!value) return "Pas encore synchronisé";
  return `Dernière synchronisation : ${new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))}`;
}

export function GoogleCalendarSettings({ enabled }: { enabled: boolean }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setConfigured(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/integrations/google/calendars", { cache: "no-store" });
      const payload = await response.json() as ConnectionsResponse;
      if (!response.ok) throw new Error(payload.error || "Chargement de Google Calendar impossible.");
      setConfigured(payload.configured ?? false);
      setConnections(payload.connections ?? []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Chargement de Google Calendar impossible.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("google");
    const message = status ? oauthMessages[status] : undefined;
    if (!message) return;
    if (message.kind === "success") toast.success(message.text);
    else toast.error(message.text);
    params.delete("google");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}#integrations`);
  }, []);

  const updateConnection = (connectionId: string, patch: Partial<GoogleConnection>) => {
    setConnections((current) => current.map((connection) => connection.id === connectionId ? { ...connection, ...patch } : connection));
  };

  const synchronize = async (connectionId: string, quiet = false) => {
    setSyncingId(connectionId);
    try {
      const response = await fetch("/api/integrations/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const payload = await response.json() as { created?: number; updated?: number; removed?: number; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Synchronisation impossible.");
      if (payload.errors?.length) throw new Error(payload.errors[0]);
      if (!quiet) {
        const changed = (payload.created ?? 0) + (payload.updated ?? 0) + (payload.removed ?? 0);
        toast.success(changed > 0 ? `${changed} événement${changed > 1 ? "s" : ""} Google mis à jour` : "Google Calendar est déjà à jour");
      }
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Synchronisation impossible.");
    } finally {
      setSyncingId(null);
    }
  };

  const save = async (connection: GoogleConnection) => {
    setSavingId(connection.id);
    try {
      const response = await fetch("/api/integrations/google/calendars", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: connection.id,
          calendarId: connection.selected[0] ?? null,
          syncEnabled: connection.syncEnabled,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Enregistrement impossible.");
      toast.success("Réglages Google Calendar enregistrés");
      if (connection.syncEnabled && connection.selected[0]) await synchronize(connection.id, true);
      else await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSavingId(null);
    }
  };

  const disconnect = async () => {
    if (!disconnectId) return;
    setDisconnecting(true);
    try {
      const response = await fetch("/api/integrations/google/calendars", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: disconnectId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Déconnexion impossible.");
      setDisconnectId(null);
      toast.success("Compte Google déconnecté");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Déconnexion impossible.");
    } finally {
      setDisconnecting(false);
    }
  };

  const startConnection = () => { window.location.assign("/api/integrations/google/start"); };

  return (
    <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-br from-white via-sky-50/40 to-violet-50/40 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-600">
          <CalendarDays className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-zinc-200">Google Calendar</p>
            {loading ? <Badge>Chargement…</Badge> : connections.length > 0 ? <Badge variant="green">Connecté</Badge> : <Badge variant="yellow">Non connecté</Badge>}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-600">Vos prestations assignées sont ajoutées à votre calendrier personnel sans exposer les identifiants Google dans le navigateur.</p>
        </div>
      </div>

      {loading && <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/80 p-3 text-xs text-zinc-500"><LoaderCircle className="size-4 animate-spin" /> Lecture de vos calendriers…</div>}

      {!loading && loadError && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-red-600"><AlertCircle className="size-4" /> {loadError}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void load()}><RefreshCw className="size-3.5" /> Réessayer</Button>
        </div>
      )}

      {!loading && !loadError && !enabled && <p className="mt-4 rounded-xl bg-white/80 p-3 text-xs text-zinc-600">Activez Supabase pour connecter un calendrier à un compte utilisateur.</p>}

      {!loading && !loadError && enabled && configured === false && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          Ajoutez les quatre variables Google dans Vercel et dans <code>.env.local</code>, puis relancez l’application.
        </div>
      )}

      {!loading && !loadError && connections.map((connection) => {
        const writableCalendars = connection.calendars.filter((calendar) => ["owner", "writer"].includes(calendar.accessRole ?? ""));
        return (
          <div key={connection.id} className="mt-4 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-zinc-200">{connection.email}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{formatLastSync(connection.lastSyncedAt)}</p>
              </div>
              {connection.error ? <Badge variant="red">À reconnecter</Badge> : <Badge variant="blue"><CalendarCheck2 className="mr-1 size-3" /> Autorisé</Badge>}
            </div>

            {connection.error ? (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-600">
                {connection.error}
                <Button size="sm" variant="secondary" className="mt-3" onClick={startConnection}><RefreshCw className="size-3.5" /> Reconnecter</Button>
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5 text-xs font-semibold text-zinc-400">
                  Calendrier de destination
                  <Select value={connection.selected[0] ?? ""} onChange={(event) => updateConnection(connection.id, { selected: event.target.value ? [event.target.value] : [] })}>
                    <option value="">Choisir un calendrier</option>
                    {writableCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " · principal" : ""}</option>)}
                  </Select>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/[0.07] bg-zinc-50 p-3 transition-colors hover:border-sky-200 hover:bg-sky-50/60">
                  <input type="checkbox" checked={connection.syncEnabled} onChange={(event) => updateConnection(connection.id, { syncEnabled: event.target.checked })} className="mt-0.5 size-4 accent-sky-500" />
                  <span><span className="block text-xs font-bold text-zinc-300">Synchronisation activée</span><span className="mt-1 block text-[11px] leading-4 text-zinc-500">Crée ou met à jour vos prestations planifiées dans le calendrier choisi.</span></span>
                </label>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {!connection.error && <Button size="sm" onClick={() => void save(connection)} disabled={savingId === connection.id || syncingId === connection.id}><Save className="size-3.5" /> {savingId === connection.id ? "Enregistrement…" : "Enregistrer"}</Button>}
              {!connection.error && <Button size="sm" variant="secondary" onClick={() => void synchronize(connection.id)} disabled={!connection.syncEnabled || !connection.selected[0] || syncingId === connection.id}><RefreshCw className={`size-3.5 ${syncingId === connection.id ? "animate-spin" : ""}`} /> Synchroniser maintenant</Button>}
              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDisconnectId(connection.id)}><Unplug className="size-3.5" /> Déconnecter</Button>
            </div>
          </div>
        );
      })}

      {!loading && !loadError && enabled && configured && (
        <Button size="sm" variant={connections.length > 0 ? "ghost" : "secondary"} className="mt-4" onClick={startConnection}>
          <CalendarDays className="size-3.5" /> {connections.length > 0 ? "Connecter un autre compte" : "Connecter mon Google Calendar"}
        </Button>
      )}

      <Modal open={Boolean(disconnectId)} onClose={() => !disconnecting && setDisconnectId(null)} title="Déconnecter Google Calendar ?" description="ADetailing ne pourra plus mettre à jour ce calendrier.">
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">Les événements déjà créés restent visibles dans Google Calendar. Vous pourrez les supprimer manuellement ou reconnecter le compte.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDisconnectId(null)} disabled={disconnecting}>Annuler</Button><Button variant="danger" onClick={() => void disconnect()} disabled={disconnecting}><Unplug className="size-4" /> {disconnecting ? "Déconnexion…" : "Déconnecter"}</Button></div>
      </Modal>
    </div>
  );
}
