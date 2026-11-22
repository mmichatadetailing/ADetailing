"use client";

import {
  ArrowRight,
  Banknote,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Gauge,
  MapPin,
  Phone,
  ReceiptText,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo } from "react";
import { ReportPeriodPicker, useReportPeriod } from "@/components/report-period";
import { periodPerformance } from "@/lib/domain/performance";
import { expenseRegisterHref } from "@/lib/domain/journal-links";
import { weeklyWorkload } from "@/lib/domain/team-workload";
import { Avatar } from "@/components/avatar";
import { DashboardCharts } from "@/components/dashboard-charts";
import { FinanceState } from "@/components/banking/finance-state";
import { BankResultCard } from "@/components/banking/bank-result-card";
import { DashboardExpensesCard } from "@/components/banking/dashboard-expenses-card";
import { QontoTreasuryCard } from "@/components/banking/qonto-treasury-card";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  collectedRevenue,
  paidExpenseAmountForMonth,
  projectedExpenseAmountForMonth,
  rankExpensesForMonths,
  remainingExpenseAmountForMonths,
} from "@/lib/domain/calculations";
import { interventionStatusLabels } from "@/lib/domain/labels";
import { isInternalLedgerHistory } from "@/lib/domain/ledger-history";
import { buildDashboardChartData } from "@/lib/domain/dashboard-charts";
import { getInterventionWorkflow } from "@/lib/domain/intervention-workflow";
import { maintenanceRenewalStatus } from "@/lib/domain/maintenance";
import { getCompanyStatsPeriod, getPreviousCompanyStatsPeriodKey, inReportingPeriod, previousReportDay } from "@/lib/domain/periods";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

function evolutionLabel(current: number, previous: number, previousLabel: string) {
  if (previous === 0) return current === 0 ? `Stable vs ${previousLabel}` : `Nouvelle activit\u00e9 vs ${previousLabel}`;
  const evolution = Math.round((current - previous) / Math.abs(previous) * 100);
  return `${evolution >= 0 ? "+" : "\u2212"}${Math.abs(evolution)} % vs ${previousLabel}`;
}

type DashboardKpi = { label: string; value: string; detail: string; comparison: string; icon: LucideIcon; tone: string; href: string };

function KpiCard({ kpi, span = "xl:col-span-3" }: { kpi: DashboardKpi; span?: string }) {
  return <Link href={kpi.href} className={`focus-ring group min-w-0 rounded-2xl ${span}`}>
    <Card data-tone={kpi.tone} className="brand-kpi h-full transition duration-200 group-hover:border-brand-400/30 group-hover:shadow-md motion-safe:group-hover:-translate-y-0.5">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold text-zinc-500">{kpi.label}</span><span className="tone-icon grid size-8 shrink-0 place-items-center rounded-full"><kpi.icon className="size-4" aria-hidden="true" /></span></div>
        <p className="kpi-value mt-3 text-zinc-900">{kpi.value}</p>
        <p className="mt-1 text-xs text-zinc-600">{kpi.detail}</p>
        <p className="mt-2 text-xs font-bold text-zinc-500">{kpi.comparison}</p>
      </CardContent>
    </Card>
  </Link>;
}

export default function DashboardPage() {
  return <Suspense fallback={<p role="status" className="p-5 text-sm">Chargement du dashboard…</p>}><DashboardContent /></Suspense>;
}

function DashboardContent() {
  const statisticsPeriod = useReportPeriod("year");
  const data = useDemoStore();
  const { workspace, mode } = useWorkspace();
  const showTreasury = mode === "demo" || Boolean(workspace?.canManageBusiness);
  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(now);
  const token = statisticsPeriod.month ?? String(statisticsPeriod.year);
  const pilotageUrl = "/pilotage?periode=" + token;
  const financesUrl = statisticsPeriod.month ? `/finances?mois=${statisticsPeriod.month}` : pilotageUrl;
  const previousStatisticsPeriod = useMemo(
    () => getCompanyStatsPeriod(getPreviousCompanyStatsPeriodKey(statisticsPeriod)),
    [statisticsPeriod],
  );
  const previousDay = previousReportDay(statisticsPeriod, now);
  const previousPeriodReference = new Date(previousDay + "T12:00:00Z");
  const periodReference = now;
  const futureInterventions = data.interventions
    .filter((item) => item.startAt && new Date(item.startAt) >= now && ["scheduled", "confirmed", "in_progress"].includes(item.status))
    .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
  const upcoming = futureInterventions.slice(0, 4);
  const { periodPayments, completed, collected, margin, hourly: averageHourly, basket: averageBasket } = periodPerformance(data.interventions, data.payments, token, now);
  const { periodPayments: previousPayments, completed: previousCompleted, collected: previousCollected, margin: previousMargin, basket: previousAverageBasket } =
    periodPerformance(data.interventions, data.payments, previousStatisticsPeriod.month ?? String(previousStatisticsPeriod.year), now, previousDay);
  const objective = data.objectives.filter((item) => statisticsPeriod.monthKeys.includes(item.month)).reduce((sum, item) => sum + item.revenueTarget, 0);
  const plannedByMember = weeklyWorkload(data.interventions, now);
  const plannedMinutes = data.team.filter(member => member.active).reduce((sum, member) => sum + (plannedByMember.get(member.id) ?? 0), 0);
  const availableMinutes = data.team
    .filter((member) => member.active)
    .reduce((sum, member) => sum + member.weeklyCapacityMinutes, 0);
  const fillRate = availableMinutes > 0 ? plannedMinutes / availableMinutes : null;
  const interventionWorkflows = data.interventions.map((intervention) => {
    const invoice = data.invoices.find((item) => item.id === intervention.invoiceId);
    return { intervention, workflow: getInterventionWorkflow(intervention, invoice, data.payments) };
  });
  const toCollect = interventionWorkflows.filter(({ intervention, workflow }) => intervention.status === "completed" && !workflow.isComplete && workflow.outstanding > 0);
  const recentInterventionPayments = periodPayments
    .filter((payment) => isInternalLedgerHistory(payment.paidAt) || payment.maintenanceContractId || payment.maintenanceBillingPeriodId || payment.interventionId || Boolean(payment.invoiceId && data.interventions.some((intervention) => intervention.invoiceId === payment.invoiceId)))
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    .slice(0, 8);
  const todayActions = [
    ...toCollect.map(({ intervention, workflow }) => { const client = data.clients.find((entry) => entry.id === intervention.clientId); return { icon: Banknote, title: `Suivre le règlement · ${client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || intervention.title}`, detail: `${intervention.title} · ${formatMoney(workflow.outstanding)} restant`, color: "text-emerald-600", href: `/prestations?intervention=${intervention.id}` }; }),
    ...upcoming.filter((item) => item.status === "scheduled").map((item) => { const client = data.clients.find((entry) => entry.id === item.clientId); return { icon: Sparkles, title: `Confirmer ${client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || item.title}`, detail: `${formatDate(item.startAt, { weekday: "long", hour: "2-digit", minute: "2-digit" })} · ${item.workers.length} collaborateur(s)`, color: "text-violet-300", href: `/prestations?intervention=${item.id}` }; }),
  ].slice(0, 4);
  const activeInterventionIds = new Set(data.interventions.map((intervention) => intervention.id));
  const receivedReviews = data.reviews.filter((review) => activeInterventionIds.has(review.interventionId) && inReportingPeriod(review.receivedAt, token, now)).length;
  const reviewTarget = data.settings.monthlyReviewTarget * (statisticsPeriod.kind === "year" ? statisticsPeriod.monthKeys.length : 1);
  const dashboardYear = statisticsPeriod.year;
  const dashboardCharts = useMemo(() => buildDashboardChartData({
    year: dashboardYear,
    objectives: data.objectives,
    interventions: data.interventions,
    payments: data.payments,
    expenses: data.expenses,
  }), [dashboardYear, data.expenses, data.interventions, data.objectives, data.payments]);
  const previousLabel = previousStatisticsPeriod.label;
  const expenseRanking = rankExpensesForMonths(data.expenses, statisticsPeriod.monthKeys, periodReference).slice(0, 8);
  const largestExpense = expenseRanking[0]?.total ?? 0;
  const recurrenceLabels = { monthly: "Mensuelle", annual: "Annuelle", one_off: "Ponctuelle" } as const;
  const currentMaintenanceContracts = data.maintenanceContracts.filter((contract) => !contract.archivedAt);
  const visibleMaintenanceContracts = workspace?.canManageBusiness || !workspace
    ? currentMaintenanceContracts
    : currentMaintenanceContracts.filter((contract) => contract.assignedMemberIds.includes(workspace.userId));
  const maintenanceRenewals = visibleMaintenanceContracts.filter((contract) => {
    const renewal = maintenanceRenewalStatus(contract, now);
    return renewal.state === "due" || renewal.state === "expired";
  });
  const objectiveKpi = { label: statisticsPeriod.kind === "year" ? "Objectif annuel" : "Objectif du mois", value: objective > 0 ? `${Math.round(collected / objective * 100)} %` : "À définir", detail: objective > 0 ? `${formatMoney(Math.max(objective - collected, 0))} restant sur ${formatMoney(objective)}` : "Renseignez vos objectifs dans Paramètres", comparison: evolutionLabel(collected, previousCollected, previousLabel), icon: Target, tone: "blue", href: `/parametres?annee=${statisticsPeriod.year}#objectifs-chiffre-affaires` };
  const operationalKpis = [
    { label: "Prestations réalisées", value: String(completed.length), detail: statisticsPeriod.label, comparison: evolutionLabel(completed.length, previousCompleted.length, previousLabel), icon: Sparkles, tone: "amber", href: `/prestations?realisees=${token}` },
    { label: "Panier moyen", value: formatMoney(averageBasket), detail: `${completed.length} prestation(s) terminée(s)`, comparison: evolutionLabel(averageBasket, previousAverageBasket, previousLabel), icon: Gauge, tone: "violet", href: pilotageUrl },
    { label: "Marge brute", value: formatMoney(margin), detail: averageHourly === null ? "Durées non renseignées" : `${formatMoney(averageHourly)}/heure-personne`, comparison: evolutionLabel(margin, previousMargin, previousLabel), icon: TrendingUp, tone: margin >= 0 ? "teal" : "rose", href: pilotageUrl },
  ];

  // Accounts without business-management access keep their existing view, without requesting a bank report.
  function indicatorsWithoutBankAccess(): DashboardKpi[] {
    const cashReceipts = collectedRevenue(periodPayments);
    const paidExpenses = statisticsPeriod.monthKeys.reduce((sum, month) => sum + paidExpenseAmountForMonth(data.expenses, month, periodReference), 0);
    const cashFlow = cashReceipts - paidExpenses;
    const previousCashFlow = collectedRevenue(previousPayments) - previousStatisticsPeriod.monthKeys.reduce((sum, month) => sum + paidExpenseAmountForMonth(data.expenses, month, previousPeriodReference), 0);
    const projectedExpenses = statisticsPeriod.monthKeys.reduce((sum, month) => sum + projectedExpenseAmountForMonth(data.expenses, month), 0);
    const previousProjectedExpenses = previousStatisticsPeriod.monthKeys.reduce((sum, month) => sum + projectedExpenseAmountForMonth(data.expenses, month), 0);
    const remainingExpenses = remainingExpenseAmountForMonths(data.expenses, statisticsPeriod.monthKeys, periodReference);
    return [
      { label: "CA encaissé", value: formatMoney(collected), detail: `Prestations et entretiens · ${statisticsPeriod.label}`, comparison: evolutionLabel(collected, previousCollected, previousLabel), icon: Banknote, tone: "emerald", href: financesUrl },
      objectiveKpi,
      { label: "Flux de trésorerie estimé", value: formatMoney(cashFlow), detail: `${formatMoney(cashReceipts)} reçu − ${formatMoney(paidExpenses)} déduit, prélèvements échus inclus`, comparison: evolutionLabel(cashFlow, previousCashFlow, previousLabel), icon: WalletCards, tone: cashFlow >= 0 ? "emerald" : "rose", href: financesUrl },
      { label: "Charges prévues", value: formatMoney(projectedExpenses), detail: `${formatMoney(projectedExpenses - remainingExpenses)} réglés · ${formatMoney(remainingExpenses)} restant sur ces échéances`, comparison: evolutionLabel(projectedExpenses, previousProjectedExpenses, previousLabel), icon: TrendingDown, tone: "amber", href: financesUrl },
    ];
  }

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={`${data.settings.locationCity || "Votre activité"} · ${todayLabel}`} title={`Bonjour ${workspace?.firstName || "Melvyn"}, voici l’essentiel.`} actions={
        <ReportPeriodPicker period={statisticsPeriod} />
      } />

      {showTreasury ? <BankResultCard period={statisticsPeriod.month ?? String(statisticsPeriod.year)} label={statisticsPeriod.label}
        dashboard={{ activityHref: pilotageUrl, objective: <KpiCard kpi={objectiveKpi} />,
          expenses: <DashboardExpensesCard key={statisticsPeriod.key} expenses={data.expenses} months={statisticsPeriod.monthKeys} label={statisticsPeriod.label} />,
          otherIndicators: <>{operationalKpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}<QontoTreasuryCard /></> }} />
      : <section aria-label="Indicateurs de la période" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
        {indicatorsWithoutBankAccess().map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
        {operationalKpis.map((kpi, index) => <KpiCard key={kpi.label} kpi={kpi} span={index === operationalKpis.length - 1 ? "sm:col-span-2 xl:col-span-4" : "xl:col-span-4"} />)}
      </section>}

      <DashboardCharts year={dashboardYear} revenue={dashboardCharts.revenue} cashFlow={dashboardCharts.cashFlow} focusMonth={statisticsPeriod.month} periodLabel={statisticsPeriod.label} />

      <Card className="overflow-hidden" data-tone="amber">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full tone-icon"><ReceiptText className="size-5" /></span>
            <div>
              <h2 className="font-bold text-zinc-900">Plus grosses dépenses · {statisticsPeriod.label}</h2>
              <p className="mt-1 text-xs text-zinc-500">Cumul des échéances ponctuelles, mensuelles et annuelles prévues sur la période.</p>
            </div>
          </div>
          <Link href={statisticsPeriod.month ? financesUrl : "/finances?registre=charges"} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700">{statisticsPeriod.month ? "Voir les échéances" : "Ouvrir le registre"} <ArrowRight className="size-3.5" /></Link>
        </CardHeader>
        <CardContent className="grid gap-2">
          {expenseRanking.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-contrast/15 bg-surface/75 px-5 py-9 text-center">
              <ReceiptText className="mx-auto size-6 text-zinc-400" />
              <p className="mt-2 text-sm font-bold text-zinc-800">Aucune dépense sur cette période</p>
              <p className="mt-1 text-xs text-zinc-500">Les charges enregistrées ou planifiées dans Finances apparaîtront ici.</p>
            </div>
          ) : expenseRanking.map((entry, index) => (
            <Link href={expenseRegisterHref(entry.expense.id, entry.lastMonth)} key={entry.expense.id} className="focus-ring group grid gap-3 rounded-2xl border border-line bg-surface/90 p-3.5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md sm:grid-cols-[40px_minmax(0,1fr)_minmax(150px,.55fr)_120px] sm:items-center">
              <span className={`grid size-9 place-items-center rounded-xl text-sm font-extrabold ${index < 3 ? "tone-icon" : "bg-zinc-100 text-zinc-600"}`}>#{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-zinc-900">{entry.expense.description || entry.expense.supplier || "Dépense sans libellé"}</span>
                <span className="mt-1 block truncate text-[11px] text-zinc-500">{entry.expense.category || "Sans catégorie"} · {recurrenceLabels[entry.expense.recurrence]} · {entry.occurrenceCount} échéance(s)</span>
              </span>
              <span className="min-w-0">
                <Progress value={largestExpense > 0 ? entry.total / largestExpense * 100 : 0} />
                <span className="mt-1.5 block text-[10px] text-zinc-500">{formatMoney(entry.paid)} réglés · {formatMoney(entry.remaining)} restant</span>
              </span>
              <span className="text-left sm:text-right"><span className="block text-base font-extrabold text-zinc-900">{formatMoney(entry.total)}</span><span className="mt-0.5 block text-[10px] font-semibold text-zinc-400">sur la période</span></span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,.75fr)]">
        <Card>
          <CardHeader><div><h2 className="font-bold">Prestations à venir</h2><p className="mt-1 text-xs text-zinc-500">Les prochains rendez-vous confirmés ou planifiés.</p></div><Link href="/planning" className="focus-ring inline-flex min-h-8 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-zinc-500 transition hover:bg-brand-50 hover:text-brand-600">Tout voir <ArrowRight className="size-3.5" /></Link></CardHeader>
          <CardContent className="px-0 pb-1">
            <div className="divide-y divide-white/[0.055]">
              {upcoming.length === 0 && <div className="px-5 py-8 text-center"><CalendarClock className="mx-auto size-6 text-zinc-500" /><p className="mt-2 text-sm font-semibold">Aucun rendez-vous à venir</p><Link href="/planning" className="focus-ring mt-2 inline-flex rounded-lg px-3 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50">Ouvrir le planning</Link></div>}
              {upcoming.map((item) => {
                const client = data.clients.find((entry) => entry.id === item.clientId);
                const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
                const member = data.team.find((entry) => entry.id === item.workers[0]?.memberId);
                return (
                  <div key={item.id} className="group grid gap-3 px-5 py-4 transition hover:bg-surface/[0.022] sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center">
                    <div><p className="text-sm font-bold text-zinc-200">{formatDate(item.startAt, { weekday: "short", day: "2-digit", month: "short" })}</p><p className="mt-1 text-xs text-zinc-500">{formatDate(item.startAt, { hour: "2-digit", minute: "2-digit" })} · {Math.round(item.plannedDurationMinutes / 60 * 10) / 10} h</p></div>
                    <div className="flex min-w-0 items-center gap-3"><Avatar label={member?.initials ?? "?"} color={member?.color} /><div className="min-w-0"><Link href={`/prestations?intervention=${item.id}`} className="focus-ring block truncate rounded-md text-sm font-semibold hover:text-brand-600" aria-label={`Ouvrir ${item.title}`}>{client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || item.title}</Link><p className="truncate text-xs text-zinc-500">{vehicle ? `${vehicle.make} ${vehicle.model}` : item.vehicleFormat || "Véhicule non renseigné"} · {item.title.split("—")[0]}</p></div></div>
                    <div className="flex items-center gap-2"><StatusBadge status={item.status}>{interventionStatusLabels[item.status]}</StatusBadge>{client?.phone && <a href={`tel:${client.phone}`} className="focus-ring hidden size-8 place-items-center rounded-lg text-zinc-600 hover:bg-brand-50 hover:text-brand-600 sm:grid" aria-label={`Appeler ${client.company || `${client.firstName} ${client.lastName}`}`}><Phone className="size-3.5" /></a>}{item.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`} target="_blank" rel="noreferrer" className="focus-ring hidden size-8 place-items-center rounded-lg text-zinc-600 hover:bg-brand-50 hover:text-brand-600 sm:grid" aria-label="Itinéraire"><MapPin className="size-3.5" /></a>}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><h2 className="font-bold">À faire aujourd’hui</h2><p className="mt-1 text-xs text-zinc-500">Calculé depuis vos données actives.</p></div><Badge variant="orange">{todayActions.length} action(s)</Badge></CardHeader>
          <CardContent className="grid gap-2">
            {todayActions.length === 0 ? <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto size-6 text-emerald-600" /><p className="mt-2 text-sm font-bold text-emerald-800">Tout est à jour</p><p className="mt-1 text-xs text-emerald-700">Aucune action prioritaire détectée.</p></div> : todayActions.map((task) => <Link href={task.href} key={`${task.href}-${task.title}`} className="focus-ring flex items-start gap-3 rounded-xl border border-transparent p-3 text-left transition hover:border-white/[0.07] hover:bg-surface/[0.025]"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface/[0.04]"><task.icon className={`size-4 ${task.color}`} /></span><span className="min-w-0"><span className="block text-xs font-semibold text-zinc-200">{task.title}</span><span className="mt-1 block text-[11px] text-zinc-600">{task.detail}</span></span><ChevronRight className="ml-auto mt-2 size-3.5 text-zinc-700" /></Link>)}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-wrap"><div><h2 className="font-bold">Encaissements récents · {statisticsPeriod.label}</h2><p className="mt-1 text-xs text-zinc-500">Règlements du logiciel, classés par date de réception.</p></div><Link href="/prestations" className="text-xs font-semibold text-brand-600 hover:text-brand-700">Ouvrir les prestations</Link></CardHeader>
        <CardContent><ul aria-label="Derniers encaissements enregistrés" className="divide-y divide-line">
          {recentInterventionPayments.map((payment) => {
            const job = data.interventions.find((i) => i.id === payment.interventionId || (payment.invoiceId && i.invoiceId === payment.invoiceId));
            const due = payment.maintenanceBillingPeriodId ? data.maintenanceBillingPeriods.find((p) => p.id === payment.maintenanceBillingPeriodId) : undefined;
            const contract = data.maintenanceContracts.find((c) => c.id === (payment.maintenanceContractId ?? due?.contractId));
            const client = data.clients.find((c) => c.id === (job?.clientId ?? contract?.clientId));
            const title = contract?.title ?? job?.title ?? payment.reference ?? "Encaissement du registre interne";
            const href = contract && !contract.archivedAt && visibleMaintenanceContracts.some((c) => c.id === contract.id) ? "/entretiens" + (due ? "#echeance-" + encodeURIComponent(due.id) : "#contrat-" + encodeURIComponent(contract.id)) : job ? "/prestations?intervention=" + encodeURIComponent(job.id) : null;
            return <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="break-words text-sm font-semibold">{href ? <Link href={href} className="focus-ring rounded underline decoration-dotted underline-offset-4 hover:decoration-solid">{title}</Link> : title}</p>
                <p className="mt-1 break-words text-xs text-zinc-600">{[client?.company || [client?.firstName,client?.lastName].filter(Boolean).join(" "),formatDate(payment.paidAt),payment.method].filter(Boolean).join(" · ")}</p></div>
              <div className="flex flex-wrap items-center gap-2"><FinanceState tone={payment.bankLinked ? "teal" : "neutral"} label={payment.bankLinked ? "Qonto" : "Hors synchronisation"} /><strong className="tabular-nums">{formatMoney(payment.amount)}</strong></div>
            </li>;
          })}
        </ul>{!recentInterventionPayments.length && <p className="py-4 text-center text-sm text-zinc-500">Aucun encaissement enregistré sur cette période.</p>}
        </CardContent>
      </Card>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader><div><h2 className="font-bold">Alertes décisionnelles</h2><p className="mt-1 text-xs text-zinc-500">Des signaux, pas des décisions automatiques.</p></div></CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.055] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><CalendarClock className="size-4" /> Charge de l’équipe · semaine en cours</div><p className="mt-2 text-xs leading-5 text-zinc-500">{fillRate === null ? "Aucune capacité hebdomadaire renseignée." : `${Math.round(fillRate * 100)} % de la capacité affectée aux prestations de lundi à dimanche, réalisations comprises.`}</p>{fillRate !== null && <Progress value={fillRate * 100} className="mt-3" />}</div>
            <div className="rounded-xl border border-sky-400/15 bg-sky-400/[0.045] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-sky-800"><CheckCircle2 className="size-4" /> Suivi des avis</div><p className="mt-2 text-xs leading-5 text-zinc-500">{receivedReviews} avis reçu(s) sur {statisticsPeriod.label.toLocaleLowerCase("fr-FR")} pour un objectif de {reviewTarget}. Les prestations terminées sans avis peuvent encore être sollicitées.</p></div>
            <Link href="/entretiens" className={`focus-ring rounded-xl border p-4 transition hover:-translate-y-0.5 ${maintenanceRenewals.length ? "border-amber-300 bg-amber-50 hover:bg-amber-100/70" : "border-emerald-200 bg-emerald-50/70"}`}><div className={`flex items-center gap-2 text-sm font-semibold ${maintenanceRenewals.length ? "text-amber-800" : "text-emerald-800"}`}><BellRing className="size-4" /> Renouvellements d’entretien</div><p className="mt-2 text-xs leading-5 text-zinc-600">{maintenanceRenewals.length ? `${maintenanceRenewals.length} client(s) sont à relancer pour prolonger leur forfait de 6 mois ou 1 an.` : "Aucun forfait d’entretien n’arrive prochainement à échéance."}</p></Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><h2 className="font-bold">Activité récente</h2><p className="mt-1 text-xs text-zinc-500">Traçabilité des actions clés.</p></div></CardHeader>
          <CardContent className="grid gap-1">
            {data.activities.slice(0, 6).map((item) => { const member = data.team.find((entry) => entry.id === item.actorId); return <div key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-3"><Avatar label={member?.initials ?? "AD"} color={member?.color} size="sm" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-zinc-200">{item.title}</p><p className="mt-0.5 truncate text-[11px] text-zinc-600">{item.description}</p></div><span className="ml-auto shrink-0 text-[10px] text-zinc-700">{formatDate(item.occurredAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>; })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
