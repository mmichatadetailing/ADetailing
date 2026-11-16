"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Expense } from "@/lib/domain/types";
import type { NewAppointmentInput, NewClientInput } from "@/lib/demo/store";
import { useDemoStore } from "@/lib/demo/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { BootstrapPayload, TeamInvitation, WorkspaceIdentity } from "@/lib/supabase/data";
import { hasPendingWorkspaceMutations, registerWorkspaceMutationHandler, subscribeWorkspaceMutations, waitForWorkspaceMutations } from "@/lib/supabase/sync";
import { toast } from "sonner";

export type QuickCreateInput =
  | ({ kind: "client"; clientKind: NewClientInput["kind"] } & Omit<NewClientInput, "kind">)
  | ({ kind: "appointment" } & NewAppointmentInput)
  | { kind: "expense"; date: string; recurrence: Expense["recurrence"]; family: Expense["family"]; category: string; supplier: string; description: string; amountIncludingTax: number; vatRateBasisPoints: number; paid: boolean };

interface WorkspaceContextValue {
  mode: "demo" | "supabase";
  workspace: WorkspaceIdentity | null;
  invitations: TeamInvitation[];
  refresh: () => Promise<void>;
  createRecord: (input: QuickCreateInput) => Promise<string>;
  sendMessage: (body: string, entityType?: "client" | "intervention" | "quote" | "invoice" | "expense" | "asset", entityId?: string) => Promise<string>;
  switchOrganization: (organizationId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const calendarMutationActions = new Set(["rescheduleIntervention", "setInterventionStatus", "updateIntervention", "completeIntervention", "removeIntervention"]);

function requestGoogleCalendarSync() {
  void fetch("/api/integrations/google/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceIdentity | null>(null);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(isSupabaseConfigured ? "loading" : "ready");
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const changingWorkspace = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured || hasPendingWorkspaceMutations()) return;
    const version = ++requestVersion.current;
    if (!silent) setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/bootstrap", { cache: "no-store" });
      const payload = await response.json() as BootstrapPayload & { error?: string };
      if (version !== requestVersion.current || hasPendingWorkspaceMutations()) return;
      if (response.status === 401) {
        location.assign("/connexion");
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Chargement impossible.");
      useDemoStore.getState().hydrateFromSupabase(payload.data);
      setWorkspace(payload.workspace);
      setInvitations(payload.invitations ?? []);
      setStatus("ready");
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      if (!silent) setStatus("error");
    }
  }, []);

  const refresh = useCallback(async () => { await load(status === "ready"); }, [load, status]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const unsubscribe = subscribeWorkspaceMutations(() => {
      requestVersion.current += 1;
      // Refresh once the whole batch is saved, never between two optimistic edits.
      if (!hasPendingWorkspaceMutations() && !changingWorkspace.current) void load(true);
    });
    const protect = (event: BeforeUnloadEvent) => { if (hasPendingWorkspaceMutations()) event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => { unsubscribe(); window.removeEventListener("beforeunload", protect); };
  }, [load]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const initialTimer = window.setTimeout(() => { void load(); }, 0);
    const pollingTimer = window.setInterval(() => { if (document.visibilityState === "visible" && !hasPendingWorkspaceMutations() && !changingWorkspace.current) void load(true); }, 30_000);
    const onFocus = () => { if (!hasPendingWorkspaceMutations() && !changingWorkspace.current) void load(true); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!isSupabaseConfigured || !workspace?.organizationId) return;
    return registerWorkspaceMutationHandler(async (mutation) => {
      try {
        // Invalide une lecture lancée avant cette modification optimiste.
        requestVersion.current += 1;
        const response = await fetch("/api/workspace/mutations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...mutation, expectedOrganizationId: workspace.organizationId }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Enregistrement impossible.");
        if (calendarMutationActions.has(mutation.action)) requestGoogleCalendarSync();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "La modification n’a pas été enregistrée.");
        throw cause;
      }
    });
  }, [workspace?.organizationId]);

  const createRecord = useCallback(async (input: QuickCreateInput) => {
    if (!isSupabaseConfigured) throw new Error("Cette action Supabase n’est pas disponible en mode démonstration.");
    const response = await fetch("/api/quick-create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) throw new Error(payload.error || "Enregistrement impossible.");
    if (input.kind === "appointment") requestGoogleCalendarSync();
    await refresh();
    return payload.id;
  }, [refresh]);

  const sendMessage = useCallback(async (body: string, entityType?: "client" | "intervention" | "quote" | "invoice" | "expense" | "asset", entityId?: string) => {
    if (!isSupabaseConfigured) return useDemoStore.getState().addMessage(body, entityType, entityId);
    const response = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, entityType, entityId }) });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) throw new Error(payload.error || "Envoi impossible.");
    await refresh();
    return payload.id;
  }, [refresh]);

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (!isSupabaseConfigured || organizationId === workspace?.organizationId || changingWorkspace.current) return;
    changingWorkspace.current = true;
    requestVersion.current += 1;
    setStatus("loading");
    try {
      await waitForWorkspaceMutations();
      const response = await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Changement d’entreprise impossible.");
      await load();
    } catch (cause) {
      setStatus("ready");
      throw cause;
    } finally { changingWorkspace.current = false; }
  }, [load, workspace?.organizationId]);

  const signOut = useCallback(async () => {
    if (changingWorkspace.current) return;
    changingWorkspace.current = true;
    requestVersion.current += 1;
    try {
      await waitForWorkspaceMutations();
      if (isSupabaseConfigured) {
        const { error } = await createSupabaseBrowserClient().auth.signOut();
        if (error) throw error;
      }
      location.assign("/connexion");
    } catch {
      toast.error("La déconnexion a échoué. Réessayez.");
    } finally { changingWorkspace.current = false; }
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => ({ mode: isSupabaseConfigured ? "supabase" : "demo", workspace, invitations, refresh, createRecord, sendMessage, switchOrganization, signOut }), [workspace, invitations, refresh, createRecord, sendMessage, switchOrganization, signOut]);

  if (status === "loading") return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-orange-400 text-lg font-black text-on-accent shadow-lg">AD</span><LoaderCircle className="mx-auto mt-6 size-6 animate-spin text-brand-500" /><p className="mt-3 text-sm font-semibold">Chargement de vos données…</p><p className="mt-1 text-xs text-zinc-500">Connexion sécurisée à Supabase</p></div></main>;
  if (status === "error") return <main className="grid min-h-screen place-items-center p-6"><div className="w-full max-w-md rounded-3xl border border-red-200 bg-white p-7 text-center shadow-xl"><h1 className="text-lg font-bold">Impossible de charger l’espace</h1><p className="mt-2 text-sm text-zinc-500">{error}</p><div className="mt-6 flex justify-center gap-2"><Button onClick={() => void refresh()}><RefreshCw className="size-4" /> Réessayer</Button><Button variant="ghost" onClick={() => void signOut()}>Se déconnecter</Button></div></div></main>;
  return <WorkspaceContext.Provider value={value}>{error && <div role="status" className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950"><span>Actualisation interrompue : les dernières données affichées peuvent être anciennes. {error}</span><Button size="sm" variant="secondary" onClick={() => void refresh()}>Réessayer</Button></div>}{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace doit être utilisé dans WorkspaceProvider.");
  return value;
}
