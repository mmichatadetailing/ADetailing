"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Scale, type LucideIcon } from "lucide-react";
import { FinanceState } from "./finance-state";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace-provider";
import { recordedActivity, type bankCashSummary } from "@/lib/domain/qonto-finance";
import { isInternalLedgerHistory } from "@/lib/domain/ledger-history";
import type { recordedExpenses } from "@/lib/domain/expense-ledger";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

type Report = { summary: ReturnType<typeof bankCashSummary> | null; syncedAt?: string; importSince?: string; incomplete?: boolean; paused?: boolean };
type DashboardLayout = { financesHref: string; objective: ReactNode; expenses: ReactNode; otherIndicators: ReactNode };
type ResultProps = { period: string; label: string; dashboard?: DashboardLayout };

export function ExpenseCheck({ charges, bank, partial }: {
  charges: ReturnType<typeof recordedExpenses>; bank: NonNullable<Report["summary"]>; partial: boolean;
}) {
  // Compare the linked portions only. The cash difference of a split belongs
  // to the bank transfer, not to either expense in the register.
  const splitDelta = bank.splitCashDelta ?? 0;
  const comparable = bank.expenseDebits.linked - splitDelta;
  const difference = comparable - charges.linked;
  return <div className="space-y-1.5 pb-3 text-sm">
    <p><strong>Charges rapprochées du logiciel : {formatMoney(charges.linked)}</strong> · Débits Qonto rattachés : {formatMoney(bank.expenseDebits.linked)}.</p>
    {splitDelta !== 0 && <p>Écart des virements groupés : {formatMoney(splitDelta)}. Hors cet écart, le montant bancaire comparable est de {formatMoney(comparable)}.</p>}
    <p className="font-semibold">{partial ? "Contrôle indicatif : l’historique bancaire est partiel ou la synchronisation est en pause." :
      !charges.linked && !bank.expenseDebits.linked ? "Aucun montant rapproché à comparer sur cette période." :
      difference === 0 ? "Les totaux rapprochés concordent au dernier import." :
      `Écart sur les totaux rapprochés (Qonto − logiciel) : ${formatMoney(difference)}. Vérifiez aussi les dates de débit et de règlement.`}</p>
    <p>Espèces enregistrées : {formatMoney(charges.cash)} · Autres règlements du logiciel sans rapprochement : {formatMoney(charges.unlinked)}. Ces montants restent inclus dans les charges, hors comparaison.</p>
    {charges.cashWithBankLink && <p>À vérifier : un ancien lien bancaire existe pour {formatMoney(charges.cashWithBankLink)} déclarés en espèces. Le registre les compte une seule fois, en espèces.</p>}
    {bank.expenseDebits.unlinked > 0 && <p>Débits d’activité Qonto sans rapprochement : {formatMoney(bank.expenseDebits.unlinked)}. Ils ne sont pas ajoutés au total du logiciel par ce contrôle.</p>}
    {bank.expenseDebits.supplierRefunds > 0 && <p>Remboursements fournisseurs sur Qonto : {formatMoney(bank.expenseDebits.supplierRefunds)}. Ils ne diminuent pas les charges du registre.</p>}
  </div>;
}

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
  const customerRefunds = report?.summary?.customerRefunds ?? 0;
  const activity = useMemo(() => recordedActivity(payments, expenses, period, customerRefunds), [payments, expenses, period, customerRefunds]);
  const resultTone = activity.result > 0 ? "emerald" : activity.result < 0 ? "rose" : "neutral";
  const received = <ActivityMetric label="Encaissements enregistrés" value={activity.received} detail="Tous moyens de paiement, espèces comprises" tone="teal" icon={ArrowDownLeft} href={dashboard?.financesHref} />;
  const result = <ActivityMetric label="Résultat enregistré" value={activity.result} detail="Encaissements moins charges fixes et variables réglées" tone={resultTone} icon={Scale} lead href={dashboard?.financesHref} />;
  const spent = <ActivityMetric label="Charges d’activité réglées" value={activity.spent} detail={activity.charges.cash ? `Registre interne · dont ${formatMoney(activity.charges.cash)} en espèces` : "Registre interne · tous moyens de paiement"} tone="blue" icon={ArrowUpRight} />;
  const content = <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold text-zinc-500">Activité enregistrée · TTC</p><h2 className="mt-1 text-lg font-bold">Résultat d’activité · {label}</h2></div>
      <div className="flex flex-wrap items-center gap-2">
        {demo ? <FinanceState tone="neutral" label="Démonstration" /> : (error || report?.incomplete || report?.paused) && <FinanceState tone="amber" label={error ? "Détail bancaire indisponible" : report?.paused ? "Synchronisation en pause" : "Historique bancaire partiel"} />}
        {!demo && <Link href="/banque" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:underline"><BookOpen className="size-4" />Journal Qonto</Link>}
      </div>
    </div>
    {dashboard ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
      {received}{dashboard.objective}{result}{dashboard.expenses}
      {dashboard.otherIndicators}
    </div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">{result}{received}{spent}</div>}
    <p className="text-xs leading-5 text-zinc-500">Le résultat d’activité exclut les dépenses non réglées, les investissements et les dépenses personnelles. Ce résultat de gestion TTC n’est pas un bénéfice comptable.</p>
    {isInternalLedgerHistory(start) && <p className="text-xs leading-5 text-zinc-600">Jusqu’au 23 juin 2026 inclus, les chiffres proviennent des encaissements et charges réglées du registre interne, espèces comprises, même sans prestation ou mouvement Qonto lié.</p>}
    {summary ? <details className="rounded-xl border border-line px-3 text-sm"><summary className="focus-ring cursor-pointer rounded py-3 font-semibold">Vérifier les montants avec Qonto{report?.paused ? " · en pause" : report?.incomplete ? " · import partiel" : ""}</summary>
    <ExpenseCheck charges={activity.charges} bank={summary} partial={Boolean(report?.paused || report?.incomplete || (report?.importSince && report.importSince > start))} />
    <p className="border-t border-line py-2"><strong>Sur Qonto uniquement : {formatMoney(summary.result)}</strong> · {formatMoney(summary.receipts)} d’entrées d’activité − {formatMoney(summary.expenses)} de sorties, remboursements déduits. Ce montant n’est pas ajouté au résultat enregistré.</p>
    {summary.unallocatedCredits > 0 && <p className="text-xs text-zinc-600">{formatMoney(summary.unallocatedCredits)} de crédits sans vente identifiée, non inclus.</p>}
    <p className="py-2 text-xs text-zinc-500">{report?.paused ? "Connexion en pause. " : ""}{report?.incomplete ? "Import partiel. " : ""}{report?.importSince && report.importSince > start ? "Historique disponible depuis le " + formatDate(report.importSince) + ". " : ""}Dernière synchronisation : {formatDate(report!.syncedAt!)}.</p></details>
    : !demo && <p role="status" className="text-sm text-zinc-500">{error ? "Vérification Qonto indisponible. Les charges du registre restent affichées ; les derniers remboursements clients ne sont pas vérifiés." : !report ? "Lecture des mouvements bancaires pour vérification…" : beforeImport ? "Cette période précède le début de l’import Qonto." : report.summary ? "En attente de la première synchronisation." : "Aucun compte Qonto connecté."}</p>}
  </>;
  return dashboard ? <section aria-label="Indicateurs de la période" className="space-y-4">{content}</section>
    : <Card aria-label="Résultat d’activité de la période"><CardContent className="space-y-4 p-4 sm:p-6">{content}</CardContent></Card>;
}

export function BankResultCard(props: ResultProps) {
  const { workspace, mode } = useWorkspace();
  if (mode !== "demo" && !workspace?.canManageBusiness) return null;
  return <PeriodResult key={mode + ":" + (workspace?.organizationId ?? "")} demo={mode === "demo"} {...props} />;
}
