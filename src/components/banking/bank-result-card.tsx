"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace-provider";
import { recordedActivity, type bankCashSummary } from "@/lib/domain/qonto-finance";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

type Report = { summary: ReturnType<typeof bankCashSummary> | null; syncedAt?: string; importSince?: string; incomplete?: boolean; paused?: boolean };

function PeriodResult({ period, label, demo }: { period: string; label: string; demo: boolean }) {
  const payments = useDemoStore((state) => state.payments);
  const expenses = useDemoStore((state) => state.expenses);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    let reading = false;
    const read = async () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const res = await fetch("/api/integrations/qonto?period=" + encodeURIComponent(period), { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error();
        const result: Report = await res.json();
        if (!controller.signal.aborted) { setReport(result); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { reading = false; }
    };
    void read();
    window.addEventListener("focus", read);
    const timer = window.setInterval(read, 120_000);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", read); };
  }, [period, demo]);
  const start = period.length === 4 ? period + "-01-01" : period + "-01";
  const beforeImport = report?.importSince && period < report.importSince.slice(0,period.length);
  const summary = !error && !beforeImport && report?.syncedAt ? report.summary : null;
  const activity = useMemo(() => recordedActivity(payments, expenses, period, report?.summary?.bookedRefunds), [payments, expenses, period, report]);
  return <Card aria-label="Résultat d’activité de la période"><CardContent className="space-y-3 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Résultat d’activité · {label}</h2>
      {!demo && <Link href="/banque" className="focus-ring rounded text-xs font-semibold text-brand-600 hover:underline">Voir le journal Qonto →</Link>}</div>
    <dl className="flex flex-wrap gap-x-10 gap-y-2">
      {([["Encaissements enregistrés",activity.received],["Charges d’activité réglées",activity.spent],["Résultat enregistré",activity.result]] as const).map(([title,value]) => <div key={title}><dt className="text-xs text-zinc-500">{title}</dt><dd className="text-xl font-bold tabular-nums">{formatMoney(value)}</dd></div>)}
    </dl><p className="text-xs leading-5 text-zinc-500">Tous moyens de paiement, espèces comprises. Charges fixes et variables réglées, hors prévisions et investissements. Ce résultat de gestion TTC n’est pas un bénéfice comptable.</p>
    {summary ? <><p className="border-t border-line pt-3 text-sm"><strong>Sur Qonto uniquement : {formatMoney(summary.result)}</strong> · {formatMoney(summary.receipts)} d’entrées d’activité − {formatMoney(summary.expenses)} de sorties, remboursements déduits. Ce montant n’est pas ajouté au résultat enregistré.</p>
    {summary.unallocatedCredits > 0 && <p className="text-xs text-zinc-600">{formatMoney(summary.unallocatedCredits)} de crédits sans vente identifiée, non inclus.</p>}
    <p className="text-xs text-zinc-500">{report?.paused ? "Connexion en pause. " : ""}{report?.incomplete ? "Import partiel. " : ""}{report?.importSince && report.importSince > start ? "Historique disponible depuis le " + formatDate(report.importSince) + ". " : ""}Dernière synchronisation : {formatDate(report!.syncedAt!)}.</p></>
    : !demo && <p role="status" className="text-sm text-zinc-500">{error ? "Le détail bancaire est indisponible. Les derniers remboursements Qonto ne sont pas garantis dans le résultat affiché." : !report ? "Lecture des mouvements de la période…" : beforeImport ? "Cette période précède le début de l’import Qonto." : report.summary ? "En attente de la première synchronisation." : "Aucun compte Qonto connecté."}</p>}
  </CardContent></Card>;
}

export function BankResultCard(props: { period: string; label: string }) {
  const { workspace, mode } = useWorkspace();
  if (mode !== "demo" && !workspace?.canManageBusiness) return null;
  return <PeriodResult key={(workspace?.organizationId ?? mode) + ":" + props.period} demo={mode === "demo"} {...props} />;
}
