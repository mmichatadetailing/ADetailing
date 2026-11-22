"use client";

import { BarChart3, Calculator, Pencil, Target, TrendingUp, UsersRound } from "lucide-react";
import { Suspense, useState } from "react";
import Link from "next/link";
import { ReportPeriodPicker, useReportPeriod } from "@/components/report-period";
import { periodPerformance } from "@/lib/domain/performance";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { BankResultCard } from "@/components/banking/bank-result-card";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { performanceByService } from "@/lib/domain/calculations";
import { useDemoStore } from "@/lib/demo/store";
import { formatMoney } from "@/lib/utils";

export default function PilotagePage() {
  return <Suspense fallback={<p role="status" className="p-5 text-sm">Chargement du pilotage…</p>}><PilotageContent /></Suspense>;
}
function PilotageContent() {
  const data = useDemoStore();
  const { mode, workspace } = useWorkspace();
  const canManage = mode === "demo" || Boolean(workspace?.canManageBusiness);
  const currentDate = new Date();
  const period = useReportPeriod("month");
  const currentMonth = period.month ?? String(period.year);
  const currentMonthLabel = period.label;
  const objective = data.objectives.find((item) => item.month === currentMonth);
  const objectiveTarget = data.objectives.reduce((sum, item) => sum + (period.monthKeys.includes(item.month) ? item.revenueTarget : 0), 0);
  const { completed, collected: revenue, margin, hourly: avgHourly, basket: averageBasket } = periodPerformance(data.interventions, data.payments, currentMonth, currentDate);
  const objectiveProgress = objectiveTarget > 0 ? revenue / objectiveTarget : 0;
  const [objectiveOpen, setObjectiveOpen] = useState(false);
  const [objectiveEuros, setObjectiveEuros] = useState((objective?.revenueTarget ?? 0) / 100);
  const [salaryCost, setSalaryCost] = useState(3200);
  const [safetyRate, setSafetyRate] = useState(20);
  const [marginPerJob, setMarginPerJob] = useState(220);
  const requiredMonthlyMargin = salaryCost * (1 + safetyRate / 100);
  const extraJobs = marginPerJob > 0 ? Math.ceil(requiredMonthlyMargin / marginPerJob) : null;

  const clientsById = new Map(data.clients.map(c => [c.id, c]));
  const sources = new Map<string, { clients: Set<string>; prestations: number }>();
  for (const job of completed) {
    const source = clientsById.get(job.clientId)?.source?.trim() || "Non renseignée";
    const entry = sources.get(source) ?? { clients: new Set<string>(), prestations: 0 };
    entry.clients.add(job.clientId);
    entry.prestations++;
    sources.set(source, entry);
  }
  const activityBySource = [...sources].map(([source, entry]) => ({ source, clients: entry.clients.size, prestations: entry.prestations }));

  const serviceStats = [...performanceByService(completed)].map(([id, stats]) => ({
    id: id ?? "hors-catalogue", name: id ? data.services.find(s => s.id === id)?.name ?? "Offre archivée" : "Hors catalogue", ...stats }))
    .sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Objectifs & analyses" title="Pilotage" description="Comparez le résultat enregistré et la marge des prestations réalisées. Les objectifs suivent les paiements reçus, pas les factures émises." actions={<div className="flex flex-wrap items-end gap-3"><ReportPeriodPicker period={period} />{canManage && (period.month ? <Button variant="secondary" onClick={() => { setObjectiveEuros((objective?.revenueTarget ?? 0) / 100); setObjectiveOpen(true); }}><Pencil className="size-4" /> Modifier l’objectif</Button> : <Link className="focus-ring rounded px-2 py-3 text-sm font-semibold underline" href={`/parametres?annee=${period.year}#objectifs-chiffre-affaires`}>Modifier les objectifs mensuels</Link>)}</div>} />
      {canManage && <BankResultCard period={currentMonth} label={currentMonthLabel} />}
      <h2 className="text-lg font-bold">Performance des prestations · {currentMonthLabel}</h2>
      <section aria-label="Indicateurs des prestations" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["CA encaissé", formatMoney(revenue), objectiveTarget > 0 ? `${Math.round(objectiveProgress * 100)} % de l’objectif` : "Objectif à définir"], ["Marge brute", formatMoney(margin), "valeur des prestations terminées moins coûts directs"], ["Marge horaire", avgHourly === null ? "—" : `${formatMoney(avgHourly)}/h`, `par heure-personne · objectif ${formatMoney(data.settings.hourlyMarginTarget)}/h`], ["Panier moyen", formatMoney(averageBasket), `${completed.length} prestation(s) terminée(s)`],
      ].map(([label, value, detail]) => <Card key={label}><CardContent className="p-5"><p className="text-xs font-semibold text-zinc-500">{label}</p><p className="mt-4 text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] text-zinc-600">{detail}</p></CardContent></Card>)}</section>
      <Card><CardContent className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid size-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-400"><Target className="size-5" /></span><div className="flex-1"><div className="flex items-center justify-between"><div><p className="text-sm font-bold capitalize">Objectif · {currentMonthLabel}</p><p className="mt-1 text-xs text-zinc-600">{objectiveTarget > 0 ? `${formatMoney(revenue)} réellement encaissé sur ${formatMoney(objectiveTarget)}` : "Aucun objectif défini pour cette période"}</p></div><p className="text-lg font-bold text-brand-300">{objectiveTarget > 0 ? `${Math.round(objectiveProgress * 100)} %` : "À définir"}</p></div><Progress value={objectiveProgress * 100} className="mt-3" /></div></div></CardContent></Card>
      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><Card><CardHeader><div><h2 className="font-bold">Activité par source client</h2><p className="mt-1 text-xs text-zinc-500">Clients servis et prestations terminées sur la période sélectionnée.</p></div><BarChart3 className="size-4 text-zinc-600" /></CardHeader><CardContent className="h-[300px]">{activityBySource.length === 0 ? <div className="grid h-full place-items-center rounded-2xl border border-dashed border-line text-center"><div><BarChart3 className="mx-auto size-7 text-zinc-400" /><p className="mt-2 text-sm font-bold">Aucune prestation réalisée</p><p className="mt-1 text-xs text-zinc-500">Le classement apparaîtra après une prestation terminée.</p></div></div> : <ResponsiveContainer width="100%" height="100%"><BarChart data={activityBySource} margin={{ top: 12, right: 8, left: -24, bottom: 16 }}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="source" tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 12px 35px rgba(22,25,20,.1)", fontSize: 12 }} /><Bar dataKey="clients" name="Clients" fill="var(--chart-blue)" radius={[6, 6, 0, 0]} /><Bar dataKey="prestations" name="Prestations terminées" fill="var(--chart-green)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>}</CardContent></Card><Card><CardHeader><div><h2 className="font-bold">Rentabilité par offre</h2><p className="mt-1 text-xs text-zinc-500">Six premières offres de la période. Les coûts sont répartis au prorata du prix, ou à parts égales pour une prestation gratuite.</p></div></CardHeader><CardContent className="grid gap-2">{!serviceStats.length && <p className="text-sm text-zinc-500">Aucune prestation réalisée sur cette période.</p>}{serviceStats.slice(0, 6).map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-xl p-3 hover:bg-brand-50/50"><div><p className="text-xs font-semibold">{item.name}</p><p className="mt-1 text-[10px] text-zinc-600">{item.sales} prestation(s)</p></div><p className="text-xs font-bold">{formatMoney(item.revenue)}</p><Badge variant={item.averageMargin > 0 ? "green" : "neutral"}>{formatMoney(item.averageMargin)} moy.</Badge></div>)}</CardContent></Card></section>
      <Card><CardHeader><div><h2 className="flex items-center gap-2 font-bold"><UsersRound className="size-4 text-violet-300" /> Simulation de recrutement</h2><p className="mt-1 text-xs text-zinc-500">Ce simulateur expose les hypothèses ; il ne recommande jamais automatiquement une embauche.</p></div></CardHeader><CardContent><div className="grid gap-5 lg:grid-cols-[1fr_1fr]"><div className="grid gap-4 sm:grid-cols-3"><Field label="Coût chargé / mois (€)"><Input min="0" type="number" value={salaryCost} onChange={(event) => setSalaryCost(Math.max(0, Number(event.target.value)))} /></Field><Field label="Marge de sécurité (%)"><Input min="0" type="number" value={safetyRate} onChange={(event) => setSafetyRate(Math.max(0, Number(event.target.value)))} /></Field><Field label="Marge par prestation (€)"><Input min="0" type="number" value={marginPerJob} onChange={(event) => setMarginPerJob(Math.max(0, Number(event.target.value)))} /></Field></div><div className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.045] p-5"><div className="flex items-center gap-3"><Calculator className="size-5 text-violet-300" /><div><p className="text-xs text-zinc-500">Marge mensuelle additionnelle nécessaire</p><p className="mt-1 text-xl font-bold">{new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(requiredMonthlyMargin)}</p></div></div><p className="mt-4 text-xs leading-5 text-zinc-500">{extraJobs === null ? "Renseignez une marge positive par prestation pour calculer le nombre nécessaire." : <>Cela représente <strong className="text-zinc-200">{extraJobs} prestations supplémentaires par mois</strong>.</>} À confronter au remplissage réel, à la trésorerie, à la récurrence de la demande et à la capacité des associés.</p></div></div></CardContent></Card>
      <Modal open={objectiveOpen} onClose={() => setObjectiveOpen(false)} title="Objectif mensuel" description={currentMonthLabel}><div className="grid gap-4"><Field label="CA objectif (€)"><Input autoFocus min="0" type="number" value={objectiveEuros} onChange={(event) => setObjectiveEuros(Math.max(0, Number(event.target.value)))} /></Field><Button onClick={() => { data.updateObjective(currentMonth, { revenueTarget: Math.round(objectiveEuros * 100) }); toast.success("Objectif mis à jour"); setObjectiveOpen(false); }}><TrendingUp className="size-4" /> Enregistrer l’objectif</Button></div></Modal>
    </div>
  );
}
