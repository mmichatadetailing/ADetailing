"use client";

import Link from "next/link";
import { Landmark, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { Card, CardContent } from "@/components/ui/card";
import type { QontoBalanceFeed } from "@/lib/domain/qonto-balance";
import { formatMoney } from "@/lib/utils";

const refreshDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

export function QontoTreasuryDisplay({ feed, loading, error, demo, onRefresh }: {
  feed: QontoBalanceFeed | null; loading: boolean; error: string; demo: boolean; onRefresh: () => void;
}) {
  const ready = feed?.state === "ready" ? feed : null;
  const message = demo ? "Disponible en mode connecté" : feed?.state === "paused" ? "Connexion Qonto en pause"
    : feed?.state === "not_connected" ? "Connectez Qonto pour afficher le solde" : feed?.state === "no_accounts" ? "Aucun compte Qonto actif en euros"
      : loading ? "Lecture du solde Qonto…" : "Solde indisponible";
  return <Card role="region" aria-label="Trésorerie actuelle" aria-busy={loading} data-tone={ready && ready.balance.balanceCents < 0 ? "rose" : "emerald"} className="brand-kpi h-full xl:col-span-3">
    <CardContent className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-zinc-500">Trésorerie actuelle</span><span className="tone-icon grid size-8 shrink-0 place-items-center rounded-full"><Landmark aria-hidden="true" className="size-4" /></span></div>
      <p className="kpi-value mt-3 text-zinc-900 tabular-nums">{ready ? formatMoney(ready.balance.balanceCents) : "—"}</p>
      {ready ? <>
        <p className="mt-1 text-[11px] text-zinc-600">Solde comptabilisé · {ready.balance.accountCount} compte{ready.balance.accountCount > 1 ? "s" : ""} Qonto EUR</p>
        {ready.balance.availableCents !== null && <p className="mt-1 text-[11px] text-zinc-600">Disponible : {formatMoney(ready.balance.availableCents)}</p>}
        <p className="mt-2 text-[10px] font-semibold text-zinc-500">{error ? "Dernier solde connu" : "Actualisé"} le {refreshDate.format(new Date(ready.fetchedAt))}</p>
      </> : <p className="mt-1 text-[11px] leading-5 text-zinc-600" role={loading ? "status" : undefined}>{message}</p>}
      {error && <p role="alert" className="mt-2 text-[11px] leading-5 text-amber-800">{error}{ready ? " Le montant affiché peut avoir changé." : ""}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
        <span className="text-[10px] text-zinc-500">Indépendant de la période</span>
        {!demo && <button type="button" disabled={loading} onClick={onRefresh} aria-label="Actualiser la trésorerie Qonto" className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-3 ${loading ? "animate-spin" : ""}`} /> Actualiser</button>}
      </div>
      {!demo && (feed?.state === "not_connected" || feed?.state === "paused") && <Link className="focus-ring mt-1 inline-block rounded-lg py-1 text-xs font-semibold text-emerald-800 hover:underline" href="/banque#connexion">{feed.state === "paused" ? "Réactiver Qonto" : "Connecter Qonto"}</Link>}
    </CardContent>
  </Card>;
}

function LiveTreasuryCard({ demo }: { demo: boolean }) {
  const [feed, setFeed] = useState<QontoBalanceFeed | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);
  const refresh = useCallback(async () => {
    if (demo || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    lastAttempt.current = Date.now();
    setLoading(true);
    try {
      const response = await fetch("/api/integrations/qonto/balance", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      const payload = await response.json().catch(() => null) as QontoBalanceFeed | { error: string } | null;
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) setFeed(null);
      if (!response.ok || !payload || "error" in payload) throw new Error(payload && "error" in payload ? payload.error : "Actualisation du solde impossible.");
      setFeed(payload); setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Qonto met trop de temps à répondre. Réessayez.");
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false); }
    }
  }, [demo]);
  useEffect(() => {
    if (demo) return;
    const whileVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastAttempt.current >= 30_000) void refresh(); };
    const initial = window.setTimeout(() => { if (document.visibilityState === "visible") void refresh(); }, 0);
    const interval = window.setInterval(whileVisible, 120_000);
    window.addEventListener("focus", whileVisible);
    document.addEventListener("visibilitychange", whileVisible);
    return () => {
      window.clearTimeout(initial); window.clearInterval(interval);
      window.removeEventListener("focus", whileVisible); document.removeEventListener("visibilitychange", whileVisible);
      activeRequest.current?.abort(); activeRequest.current = null;
    };
  }, [demo, refresh]);
  return <QontoTreasuryDisplay feed={feed} loading={loading} error={error} demo={demo} onRefresh={() => void refresh()} />;
}

export function QontoTreasuryCard() {
  const { mode, workspace } = useWorkspace();
  if (mode !== "demo" && !workspace?.canManageBusiness) return null;
  // Reset private data and cancel the old request when the active company changes.
  return <LiveTreasuryCard key={`${mode}:${workspace?.organizationId ?? "demo"}`} demo={mode === "demo"} />;
}
