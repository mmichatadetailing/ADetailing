"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Expense } from "@/lib/domain/types";
import type { NewAppointmentInput, NewClientInput, NewLeadInput } from "@/lib/demo/store";
import { useDemoStore } from "@/lib/demo/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { BootstrapPayload, TeamInvitation, WorkspaceIdentity } from "@/lib/supabase/data";
import { registerWorkspaceMutationHandler } from "@/lib/supabase/sync";
import { toast } from "sonner";

export type QuickCreateInput =
  | ({ kind: "lead" } & NewLeadInput)
  | ({ kind: "client"; clientKind: NewClientInput["kind"] } & Omit<NewClientInput, "kind">)
  | ({ kind: "appointment" } & NewAppointmentInput)
  | { kind: "expense"; date: string; family: Expense["family"]; category: string; supplier: string; description: string; amountIncludingTax: number; vatRateBasisPoints: number; paid: boolean };

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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceIdentity | null>(null);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(isSupabaseConfigured ? "loading" : "ready");
  const [error, setError] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured) return;
    if (!silent) setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/bootstrap", { cache: "no-store" });
      const payload = await response.json() as BootstrapPayload & { error?: string };
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
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      if (!silent) setStatus("error");
    }
  }, []);

  const refresh = useCallback(async () => { await load(true); }, [load]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const initialTimer = window.setTimeout(() => { void load(); }, 0);
    const pollingTimer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30_000);
    const onFocus = () => { void load(true); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return registerWorkspaceMutationHandler(async (mutation) => {
      try {
        const response = await fetch("/api/workspace/mutations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mutation) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Enregistrement impossible.");
        await load(true);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "La modification n’a pas été enregistrée.");
        await load(true);
        throw cause;
      }
    });
  }, [load]);

  const createRecord = useCallback(async (input: QuickCreateInput) => {
    if (!isSupabaseConfigured) throw new Error("Cette action Supabase n’est pas disponible en mode démonstration.");
    const response = await fetch("/api/quick-create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) throw new Error(payload.error || "Enregistrement impossible.");
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
    if (!isSupabaseConfigured || organizationId === workspace?.organizationId) return;
    setStatus("loading");
    const response = await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setStatus("ready");
      throw new Error(payload.error || "Changement d’entreprise impossible.");
    }
    await load();
  }, [load, workspace?.organizationId]);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await createSupabaseBrowserClient().auth.signOut();
    location.assign("/connexion");
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => ({ mode: isSupabaseConfigured ? "supabase" : "demo", workspace, invitations, refresh, createRecord, sendMessage, switchOrganization, signOut }), [workspace, invitations, refresh, createRecord, sendMessage, switchOrganization, signOut]);

  if (status === "loading") return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-orange-400 text-lg font-black text-on-accent shadow-lg">AD</span><LoaderCircle className="mx-auto mt-6 size-6 animate-spin text-brand-500" /><p className="mt-3 text-sm font-semibold">Chargement de vos données…</p><p className="mt-1 text-xs text-zinc-500">Connexion sécurisée à Supabase</p></div></main>;
  if (status === "error") return <main className="grid min-h-screen place-items-center p-6"><div className="w-full max-w-md rounded-3xl border border-red-200 bg-white p-7 text-center shadow-xl"><h1 className="text-lg font-bold">Impossible de charger l’espace</h1><p className="mt-2 text-sm text-zinc-500">{error}</p><div className="mt-6 flex justify-center gap-2"><Button onClick={() => void refresh()}><RefreshCw className="size-4" /> Réessayer</Button><Button variant="ghost" onClick={() => void signOut()}>Se déconnecter</Button></div></div></main>;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace doit être utilisé dans WorkspaceProvider.");
  return value;
}
