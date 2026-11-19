"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Scale } from "lucide-react";
import { FinanceState } from "./finance-state";
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
  const resultTone = activity.result > 0 ? "emerald" : activity.result < 0 ? "rose" : "neutral";
  return <Card aria-label="Résultat d’activité de la période"><CardContent className="space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold text-zinc-500">Activité enregistrée · TTC</p><h2 className="mt-1 text-lg font-bold">Résultat d’activité · {label}</h2></div>
      <div className="flex flex-wrap items-center gap-2">
        {demo ? <FinanceState tone="neutral" label="Démonstration" /> : (error || report?.incomplete || report?.paused) && <FinanceState tone="amber" label={error ? "Détail bancaire indisponible" : report?.paused ? "Synchronisation en pause" : "Historique bancaire partiel"} />}
        {!demo && <Link href="/banque" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:underline"><BookOpen className="size-4" />Journal Qonto</Link>}
      </div>
    </div>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">
      <div data-tone={resultTone} className="finance-metric finance-metric--lead sm:col-span-2 lg:col-span-1"><dt><Scale className="size-4" />Résultat enregistré</dt><dd>{formatMoney(activity.result)}</dd><p>Encaissements moins charges réglées</p></div>
      <div data-tone="teal" className="finance-metric"><dt><ArrowDownLeft className="size-4" />Encaissements enregistrés</dt><dd>{formatMoney(activity.received)}</dd><p>Tous moyens de paiement, espèces comprises</p></div>
      <div data-tone="blue" className="finance-metric"><dt><ArrowUpRight className="size-4" />Charges d’activité réglées</dt><dd>{formatMoney(activity.spent)}</dd><p>Charges fixes et variables confirmées</p></div>
    </dl>
    <p className="text-xs leading-5 text-zinc-500">Les prévisions et les investissements sont exclus. Ce résultat de gestion TTC n’est pas un bénéfice comptable.</p>
    {summary ? <details className="rounded-xl border border-line px-3 text-sm"><summary className="focus-ring cursor-pointer rounded py-3 font-semibold">Détail de la part Qonto{report?.paused ? " · en pause" : report?.incomplete ? " · import partiel" : ""}</summary><p className="pb-2"><strong>Sur Qonto uniquement : {formatMoney(summary.result)}</strong> · {formatMoney(summary.receipts)} d’entrées d’activité − {formatMoney(summary.expenses)} de sorties, remboursements déduits. Ce montant n’est pas ajouté au résultat enregistré.</p>
    {summary.unallocatedCredits > 0 && <p className="text-xs text-zinc-600">{formatMoney(summary.unallocatedCredits)} de crédits sans vente identifiée, non inclus.</p>}
    <p className="py-2 text-xs text-zinc-500">{report?.paused ? "Connexion en pause. " : ""}{report?.incomplete ? "Import partiel. " : ""}{report?.importSince && report.importSince > start ? "Historique disponible depuis le " + formatDate(report.importSince) + ". " : ""}Dernière synchronisation : {formatDate(report!.syncedAt!)}.</p></details>
    : !demo && <p role="status" className="text-sm text-zinc-500">{error ? "Le détail bancaire est indisponible. Les derniers remboursements Qonto ne sont pas garantis dans le résultat affiché." : !report ? "Lecture des mouvements de la période…" : beforeImport ? "Cette période précède le début de l’import Qonto." : report.summary ? "En attente de la première synchronisation." : "Aucun compte Qonto connecté."}</p>}
  </CardContent></Card>;
}

export function BankResultCard(props: { period: string; label: string }) {
  const { workspace, mode } = useWorkspace();
  if (mode !== "demo" && !workspace?.canManageBusiness) return null;
  return <PeriodResult key={(workspace?.organizationId ?? mode) + ":" + props.period} demo={mode === "demo"} {...props} />;
}
