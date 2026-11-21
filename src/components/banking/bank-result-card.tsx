"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Scale, type LucideIcon } from "lucide-react";
import { FinanceState } from "./finance-state";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace-provider";
import { recordedActivity, type bankCashSummary } from "@/lib/domain/qonto-finance";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

type Report = { summary: ReturnType<typeof bankCashSummary> | null; syncedAt?: string; importSince?: string; incomplete?: boolean; paused?: boolean };
type DashboardLayout = { financesHref: string; objective: ReactNode; otherIndicators: ReactNode };
type ResultProps = { period: string; label: string; dashboard?: DashboardLayout };

function ActivityMetric({ label, value, detail, tone, icon: Icon, lead = false, href }: {
  label: string; value: number; detail: string; tone: string; icon: LucideIcon; lead?: boolean; href?: string;
}) {
  const metric = <dl data-tone={tone} className={`finance-metric h-full ${lead ? "finance-metric--lead" : ""} ${lead && !href ? "sm:col-span-2 lg:col-span-1" : ""}`}>
    <dt><Icon className="size-4 shrink-0" aria-hidden="true" />{label}</dt>
    <dd>{formatMoney(value)}<p className="font-normal tracking-normal">{detail}</p></dd>
  </dl>;
  return href ? <Link href={href} className="focus-ring block min-w-0 rounded-2xl transition hover:shadow-md motion-safe:hover:-translate-y-0.5 xl:col-span-3">{metric}</Link> : metric;
}

function PeriodResult({ period, label, demo, dashboard }: ResultProps & { demo: boolean }) {
  const payments = useDemoStore((state) => state.payments);
  const expenses = useDemoStore((state) => state.expenses);
  const [response, setResponse] = useState<{ period: string; report: Report | null; error: boolean } | null>(null);
  // Never show the previous month's refunds while loading the new period.
  // Keep period-independent dashboard cards (notably the bank balance) mounted.
  const report = response?.period === period ? response.report : null;
  const error = response?.period === period && response.error;
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
        if (!controller.signal.aborted) setResponse({ period, report: result, error: false });
      } catch {
        if (!controller.signal.aborted) setResponse((last) => ({ period, report: last?.period === period ? last.report : null, error: true }));
      }
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
  const received = <ActivityMetric label="Encaissements enregistrés" value={activity.received} detail="Tous moyens de paiement, espèces comprises" tone="teal" icon={ArrowDownLeft} href={dashboard?.financesHref} />;
  const result = <ActivityMetric label="Résultat enregistré" value={activity.result} detail="Encaissements moins charges réglées" tone={resultTone} icon={Scale} lead href={dashboard?.financesHref} />;
  const spent = <ActivityMetric label="Charges d’activité réglées" value={activity.spent} detail="Charges fixes et variables confirmées" tone="blue" icon={ArrowUpRight} href={dashboard?.financesHref} />;
  const content = <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold text-zinc-500">Activité enregistrée · TTC</p><h2 className="mt-1 text-lg font-bold">Résultat d’activité · {label}</h2></div>
      <div className="flex flex-wrap items-center gap-2">
        {demo ? <FinanceState tone="neutral" label="Démonstration" /> : (error || report?.incomplete || report?.paused) && <FinanceState tone="amber" label={error ? "Détail bancaire indisponible" : report?.paused ? "Synchronisation en pause" : "Historique bancaire partiel"} />}
        {!demo && <Link href="/banque" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:underline"><BookOpen className="size-4" />Journal Qonto</Link>}
      </div>
    </div>
    {dashboard ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
      {received}{dashboard.objective}{result}{spent}
      {dashboard.otherIndicators}
    </div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">{result}{received}{spent}</div>}
    <p className="text-xs leading-5 text-zinc-500">Les prévisions et les investissements sont exclus. Ce résultat de gestion TTC n’est pas un bénéfice comptable.</p>
    {summary ? <details className="rounded-xl border border-line px-3 text-sm"><summary className="focus-ring cursor-pointer rounded py-3 font-semibold">Détail de la part Qonto{report?.paused ? " · en pause" : report?.incomplete ? " · import partiel" : ""}</summary><p className="pb-2"><strong>Sur Qonto uniquement : {formatMoney(summary.result)}</strong> · {formatMoney(summary.receipts)} d’entrées d’activité − {formatMoney(summary.expenses)} de sorties, remboursements déduits. Ce montant n’est pas ajouté au résultat enregistré.</p>
    {summary.unallocatedCredits > 0 && <p className="text-xs text-zinc-600">{formatMoney(summary.unallocatedCredits)} de crédits sans vente identifiée, non inclus.</p>}
    {summary.splitCashDelta !== undefined && <p className="text-xs text-zinc-600">Écart entre les virements groupés et les échéances réglées : {formatMoney(summary.splitCashDelta)}. Cet écart concerne la trésorerie, pas le tarif des charges.</p>}
    <p className="py-2 text-xs text-zinc-500">{report?.paused ? "Connexion en pause. " : ""}{report?.incomplete ? "Import partiel. " : ""}{report?.importSince && report.importSince > start ? "Historique disponible depuis le " + formatDate(report.importSince) + ". " : ""}Dernière synchronisation : {formatDate(report!.syncedAt!)}.</p></details>
    : !demo && <p role="status" className="text-sm text-zinc-500">{error ? "Le détail bancaire est indisponible. Les derniers remboursements Qonto ne sont pas garantis dans le résultat affiché." : !report ? "Lecture des mouvements de la période…" : beforeImport ? "Cette période précède le début de l’import Qonto." : report.summary ? "En attente de la première synchronisation." : "Aucun compte Qonto connecté."}</p>}
  </>;
  return dashboard ? <section aria-label="Indicateurs de la période" className="space-y-4">{content}</section>
    : <Card aria-label="Résultat d’activité de la période"><CardContent className="space-y-4 p-4 sm:p-6">{content}</CardContent></Card>;
}

export function BankResultCard(props: ResultProps) {
  const { workspace, mode } = useWorkspace();
  if (mode !== "demo" && !workspace?.canManageBusiness) return null;
  return <PeriodResult key={mode + ":" + (workspace?.organizationId ?? "")} demo={mode === "demo"} {...props} />;
}
