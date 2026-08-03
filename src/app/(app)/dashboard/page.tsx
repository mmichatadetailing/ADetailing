"use client";

import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  Gauge,
  MapPin,
  Phone,
  ReceiptText,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/avatar";
import { DashboardCharts } from "@/components/dashboard-charts";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  cashBalance,
  collectedRevenue,
  grossMargin,
  hourlyMargin,
  invoicedRevenue,
  objectiveProgress,
  occupancyRate,
  paymentStatusForInvoice,
  unpaidAmount,
} from "@/lib/domain/calculations";
import { interventionStatusLabels, paymentStatusLabels, quoteStatusLabels } from "@/lib/domain/labels";
import { buildDashboardChartData } from "@/lib/domain/dashboard-charts";
import { getPeriodRange, isDateInRange, monthKey, type DashboardPeriod } from "@/lib/domain/periods";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

const periods: DashboardPeriod[] = ["Aujourd’hui", "Cette semaine", "Ce mois", "Mois précédent"];

export default function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>("Ce mois");
  const data = useDemoStore();
  const { workspace } = useWorkspace();
  const todayLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const upcoming = useMemo(
    () => data.interventions.filter((item) => item.startAt && new Date(item.startAt) >= new Date() && item.status !== "cancelled").sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? "")).slice(0, 4),
    [data.interventions],
  );
  const periodPayments = data.payments.filter((item) => isDateInRange(item.paidAt, periodRange));
  const periodInvoices = data.invoices.filter((item) => isDateInRange(item.issuedAt, periodRange));
  const completed = data.interventions.filter((item) => item.status === "completed" && isDateInRange(item.startAt, periodRange));
  const averageHourly = completed.length
    ? Math.round(completed.reduce((sum, item) => sum + (hourlyMargin(item) ?? 0), 0) / completed.length)
    : 0;
  const collected = collectedRevenue(periodPayments);
  const invoiced = invoicedRevenue(periodInvoices);
  const cash = cashBalance(data.settings.initialCash, data.payments, data.expenses);
  const objectiveMonth = period === "Mois précédent" ? monthKey(periodRange.start) : monthKey(new Date());
  const objective = data.objectives.find((item) => item.month === objectiveMonth);
  const plannedMinutes = upcoming.reduce((sum, item) => sum + item.workers.reduce((workerSum, worker) => workerSum + worker.plannedMinutes, 0), 0);
  const fillRate = occupancyRate(plannedMinutes, data.team.length * data.settings.dailyAvailableMinutes * 5);
  const margin = completed.reduce((sum, item) => sum + grossMargin(item), 0);
  const unpaid = unpaidAmount(data.invoices, data.payments);
  const overdueCount = data.invoices.filter((invoice) => paymentStatusForInvoice(invoice, data.payments) === "overdue").length;
  const dashboardSummary = data.clients.length === 0 && data.leads.length === 0
    ? "Votre espace est prêt. Ajoutez votre premier client ou une nouvelle demande pour commencer."
    : `${upcoming.length} prestation(s) à venir, ${data.leads.filter((lead) => !["won", "lost"].includes(lead.stage)).length} demande(s) active(s) et ${overdueCount} facture(s) en retard.`;
  const todayActions = [
    ...data.invoices.filter((invoice) => paymentStatusForInvoice(invoice, data.payments) === "overdue").map((invoice) => ({ icon: AlertTriangle, title: `Relancer la facture ${invoice.number}`, detail: `${formatMoney(unpaidAmount([invoice], data.payments))} · échéance ${formatDate(invoice.dueAt)}`, color: "text-red-300", href: "/documents" })),
    ...data.leads.filter((lead) => !["won", "lost"].includes(lead.stage)).map((lead) => ({ icon: lead.stage === "quote_to_prepare" ? FileCheck2 : Phone, title: lead.nextAction || `Suivre ${lead.prospectName}`, detail: `${lead.prospectName} · ${formatMoney(lead.estimatedAmount)}`, color: lead.stage === "quote_to_prepare" ? "text-sky-300" : "text-orange-300", href: "/commercial" })),
    ...upcoming.filter((item) => item.status === "scheduled").map((item) => { const client = data.clients.find((entry) => entry.id === item.clientId); return { icon: Sparkles, title: `Confirmer ${client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || item.title}`, detail: `${formatDate(item.startAt, { weekday: "long", hour: "2-digit", minute: "2-digit" })} · ${item.workers.length} collaborateur(s)`, color: "text-violet-300", href: "/prestations" }; }),
  ].slice(0, 4);
  const receivedReviews = data.reviews.filter((review) => review.receivedAt && review.receivedAt.slice(0, 7) === monthKey(new Date())).length;
  const dashboardYear = data.settings.pilotYear || new Date().getFullYear();
  const dashboardCharts = useMemo(() => buildDashboardChartData({
    year: dashboardYear,
    objectives: data.objectives,
    invoices: data.invoices,
    payments: data.payments,
    expenses: data.expenses,
  }), [dashboardYear, data.expenses, data.invoices, data.objectives, data.payments]);
  const kpis = [
    { label: "CA encaissé", value: formatMoney(collected), detail: period, icon: Banknote, color: "text-emerald-300", tone: "from-emerald-50/90 to-ink-850", href: "/finances" },
    { label: "CA facturé", value: formatMoney(invoiced), detail: period, icon: ReceiptText, color: "text-sky-300", tone: "from-sky-50/90 to-ink-850", href: "/documents" },
    { label: "Marge brute", value: formatMoney(margin), detail: period, icon: TrendingUp, color: "text-violet-300", tone: "from-violet-50/90 to-ink-850", href: "/pilotage" },
    { label: "Trésorerie", value: formatMoney(cash), detail: `Sécurité ${formatMoney(data.settings.cashSafetyBuffer)}`, icon: WalletCards, color: "text-orange-300", tone: "from-orange-50/90 to-ink-850", href: "/finances" },
    { label: "Objectif mensuel", value: `${Math.round(objectiveProgress(invoiced, objective) * 100)} %`, detail: objective ? `sur ${formatMoney(objective.revenueTarget)}` : "Non défini", icon: Gauge, color: "text-amber-200", tone: "from-amber-50/90 to-ink-850", href: "/pilotage" },
    { label: "Remplissage", value: `${Math.round(fillRate * 100)} %`, detail: "5 prochains jours", icon: CalendarClock, color: "text-cyan-300", tone: "from-cyan-50/90 to-ink-850", href: "/planning" },
    { label: "Marge horaire", value: formatMoney(averageHourly), detail: `Objectif ${formatMoney(data.settings.hourlyMarginTarget)}`, icon: Clock3, color: "text-fuchsia-300", tone: "from-fuchsia-50/90 to-ink-850", href: "/pilotage" },
    { label: "Impayés", value: formatMoney(unpaid), detail: `${data.invoices.filter((invoice) => paymentStatusForInvoice(invoice, data.payments) !== "paid").length} facture(s)`, icon: AlertTriangle, color: "text-red-300", tone: "from-rose-50/90 to-ink-850", href: "/documents" },
  ];

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={`${data.settings.locationCity || "Votre activité"} · ${todayLabel}`} title={`Bonjour ${workspace?.firstName || "Melvyn"}, voici l’essentiel.`} description={dashboardSummary} actions={
        <select value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)} className="focus-ring min-h-10 rounded-xl border border-white/10 bg-ink-900 px-3 text-sm font-semibold text-zinc-300 shadow-sm">{periods.map((item) => <option key={item}>{item}</option>)}</select>
      } />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Link href={kpi.href} key={kpi.label} className="focus-ring group rounded-2xl">
            <Card className={`h-full bg-gradient-to-br ${kpi.tone} transition duration-200 group-hover:-translate-y-1 group-hover:border-brand-400/20 group-hover:shadow-[0_18px_48px_rgba(78,64,120,.12)]`}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between"><span className="text-xs font-semibold text-zinc-500">{kpi.label}</span><kpi.icon className={`size-[17px] ${kpi.color}`} /></div>
                <p className="mt-4 text-2xl font-bold tracking-[-0.035em] text-white">{kpi.value}</p>
                <p className="mt-1 text-[11px] text-zinc-600">{kpi.detail}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <DashboardCharts year={dashboardYear} revenue={dashboardCharts.revenue} cashFlow={dashboardCharts.cashFlow} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,.75fr)]">
        <Card>
          <CardHeader><div><h2 className="font-bold">Prestations à venir</h2><p className="mt-1 text-xs text-zinc-500">Les prochains rendez-vous confirmés ou planifiés.</p></div><Button variant="ghost" size="sm" onClick={() => location.assign('/planning')}>Tout voir <ArrowRight className="size-3.5" /></Button></CardHeader>
          <CardContent className="px-0 pb-1">
            <div className="divide-y divide-white/[0.055]">
              {upcoming.map((item) => {
                const client = data.clients.find((entry) => entry.id === item.clientId);
                const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
                const member = data.team.find((entry) => entry.id === item.workers[0]?.memberId);
                return (
                  <div key={item.id} className="group grid gap-3 px-5 py-4 transition hover:bg-white/[0.022] sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center">
                    <div><p className="text-sm font-bold text-white">{formatDate(item.startAt, { weekday: "short", day: "2-digit", month: "short" })}</p><p className="mt-1 text-xs text-zinc-500">{formatDate(item.startAt, { hour: "2-digit", minute: "2-digit" })} · {Math.round(item.plannedDurationMinutes / 60 * 10) / 10} h</p></div>
                    <div className="flex min-w-0 items-center gap-3"><Avatar label={member?.initials ?? "?"} color={member?.color} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{client?.company || `${client?.firstName} ${client?.lastName}`}</p><p className="truncate text-xs text-zinc-500">{vehicle ? `${vehicle.make} ${vehicle.model}` : item.vehicleFormat || "Véhicule non renseigné"} · {item.title.split("—")[0]}</p></div></div>
                    <div className="flex items-center gap-2"><StatusBadge status={item.status}>{interventionStatusLabels[item.status]}</StatusBadge><a href={`tel:${client?.phone}`} className="focus-ring hidden size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-white sm:grid" aria-label="Appeler"><Phone className="size-3.5" /></a><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`} target="_blank" className="focus-ring hidden size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-white sm:grid" aria-label="Itinéraire"><MapPin className="size-3.5" /></a></div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><h2 className="font-bold">À faire aujourd’hui</h2><p className="mt-1 text-xs text-zinc-500">Calculé depuis vos données actives.</p></div><Badge variant="orange">{todayActions.length} action(s)</Badge></CardHeader>
          <CardContent className="grid gap-2">
            {todayActions.length === 0 ? <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto size-6 text-emerald-600" /><p className="mt-2 text-sm font-bold text-emerald-800">Tout est à jour</p><p className="mt-1 text-xs text-emerald-700">Aucune action prioritaire détectée.</p></div> : todayActions.map((task) => <Link href={task.href} key={`${task.href}-${task.title}`} className="focus-ring flex items-start gap-3 rounded-xl border border-transparent p-3 text-left transition hover:border-white/[0.07] hover:bg-white/[0.025]"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.04]"><task.icon className={`size-4 ${task.color}`} /></span><span className="min-w-0"><span className="block text-xs font-semibold text-zinc-200">{task.title}</span><span className="mt-1 block text-[11px] text-zinc-600">{task.detail}</span></span><ChevronRight className="ml-auto mt-2 size-3.5 text-zinc-700" /></Link>)}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><div><h2 className="font-bold">Devis récents</h2><p className="mt-1 text-xs text-zinc-500">Les devis à suivre dans Henrri.</p></div><Link href="/documents" className="text-xs font-semibold text-brand-400 hover:text-brand-300">Ouvrir les documents</Link></CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-1">
            <table className="w-full min-w-[560px] text-left text-xs"><thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr><th className="px-5 py-3 font-semibold">Devis</th><th className="px-3 py-3 font-semibold">Client</th><th className="px-3 py-3 font-semibold">Montant</th><th className="px-3 py-3 font-semibold">Statut</th><th className="px-5 py-3 font-semibold">Prochaine action</th></tr></thead><tbody className="divide-y divide-white/[0.055]">{data.quotes.slice().reverse().map((quote) => { const client = data.clients.find((entry) => entry.id === quote.clientId); return <tr key={quote.id} className="hover:bg-white/[0.02]"><td className="px-5 py-3 font-semibold text-zinc-200">{quote.number}</td><td className="px-3 py-3 text-zinc-400">{client?.company || `${client?.firstName} ${client?.lastName}`}</td><td className="px-3 py-3 font-semibold">{formatMoney(quote.totalIncludingTax)}</td><td className="px-3 py-3"><StatusBadge status={quote.status}>{quoteStatusLabels[quote.status]}</StatusBadge></td><td className="px-5 py-3 text-zinc-500">{quote.nextFollowUpAt ? formatDate(quote.nextFollowUpAt) : "—"}</td></tr>; })}</tbody></table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><h2 className="font-bold">Factures récentes</h2><p className="mt-1 text-xs text-zinc-500">Émission et paiement restent bien séparés.</p></div><Link href="/documents" className="text-xs font-semibold text-brand-400 hover:text-brand-300">Rapprocher</Link></CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-1">
            <table className="w-full min-w-[520px] text-left text-xs"><thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr><th className="px-5 py-3 font-semibold">Facture</th><th className="px-3 py-3 font-semibold">Client</th><th className="px-3 py-3 font-semibold">Montant</th><th className="px-3 py-3 font-semibold">Échéance</th><th className="px-5 py-3 font-semibold">Paiement</th></tr></thead><tbody className="divide-y divide-white/[0.055]">{data.invoices.slice().reverse().map((invoice) => { const client = data.clients.find((entry) => entry.id === invoice.clientId); const paymentStatus = paymentStatusForInvoice(invoice, data.payments); return <tr key={invoice.id} className="hover:bg-white/[0.02]"><td className="px-5 py-3 font-semibold text-zinc-200">{invoice.number}</td><td className="px-3 py-3 text-zinc-400">{client?.company || `${client?.firstName} ${client?.lastName}`}</td><td className="px-3 py-3 font-semibold">{formatMoney(invoice.totalIncludingTax)}</td><td className="px-3 py-3 text-zinc-500">{formatDate(invoice.dueAt)}</td><td className="px-5 py-3"><StatusBadge status={paymentStatus}>{paymentStatusLabels[paymentStatus]}</StatusBadge></td></tr>; })}</tbody></table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader><div><h2 className="font-bold">Alertes décisionnelles</h2><p className="mt-1 text-xs text-zinc-500">Des signaux, pas des décisions automatiques.</p></div></CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.055] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><CalendarClock className="size-4" /> Planning sous-rempli</div><p className="mt-2 text-xs leading-5 text-zinc-500">Le taux de remplissage des 5 prochains jours est de {Math.round(fillRate * 100)} %. Relancer les demandes chaudes avant d’ouvrir des créneaux supplémentaires.</p><Progress value={fillRate * 100} className="mt-3" /></div>
            <div className="rounded-xl border border-sky-400/15 bg-sky-400/[0.045] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-sky-200"><CheckCircle2 className="size-4" /> Avis à consolider</div><p className="mt-2 text-xs leading-5 text-zinc-500">{receivedReviews} avis reçu(s) ce mois sur un objectif de {data.settings.monthlyReviewTarget}. Les prestations terminées sans avis peuvent encore être sollicitées.</p></div>
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
