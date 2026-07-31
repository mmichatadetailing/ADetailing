"use client";

import { BarChart3, Calculator, Pencil, Target, TrendingUp, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { conversionRate, grossMargin, hourlyMargin, invoicedRevenue } from "@/lib/domain/calculations";
import { monthKey } from "@/lib/domain/periods";
import { useDemoStore } from "@/lib/demo/store";
import { formatMoney } from "@/lib/utils";

export default function PilotagePage() {
  const data = useDemoStore();
  const currentDate = new Date();
  const currentMonth = monthKey(currentDate);
  const currentMonthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(currentDate);
  const objective = data.objectives.find((item) => item.month === currentMonth);
  const revenue = invoicedRevenue(data.invoices);
  const completed = data.interventions.filter((item) => item.status === "completed");
  const margin = completed.reduce((sum, item) => sum + grossMargin(item), 0);
  const avgHourly = completed.length ? completed.reduce((sum, item) => sum + (hourlyMargin(item) ?? 0), 0) / completed.length : 0;
  const [objectiveOpen, setObjectiveOpen] = useState(false);
  const [objectiveEuros, setObjectiveEuros] = useState((objective?.revenueTarget ?? 0) / 100);
  const [salaryCost, setSalaryCost] = useState(3200);
  const [safetyRate, setSafetyRate] = useState(20);
  const [marginPerJob, setMarginPerJob] = useState(220);
  const requiredMonthlyMargin = salaryCost * (1 + safetyRate / 100);
  const extraJobs = marginPerJob > 0 ? Math.ceil(requiredMonthlyMargin / marginPerJob) : 0;

  const revenueBySource = useMemo(() => data.settings.leadSources.map((source) => {
    const sourceLeads = data.leads.filter((lead) => lead.source === source);
    return { source: source.replace("Bouche-à-oreille", "Bouche-à-o."), demandes: sourceLeads.length, gagnées: sourceLeads.filter((lead) => lead.stage === "won").length };
  }).filter((item) => item.demandes > 0), [data.leads, data.settings.leadSources]);

  const serviceStats = data.services.filter((service) => service.active).map((service) => {
    const related = data.interventions.flatMap((item) => item.items.filter((line) => line.serviceId === service.id).map(() => item));
    const revenue = related.reduce((sum, item) => sum + item.items.filter((line) => line.serviceId === service.id).reduce((lineSum, line) => lineSum + line.revenueAllocated, 0), 0);
    const avgMargin = related.length ? related.reduce((sum, item) => sum + grossMargin(item), 0) / related.length : 0;
    return { service, sales: related.length, revenue, avgMargin };
  }).sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Objectifs & analyses" title="Pilotage" description="Comprendre les moteurs de rentabilité, la capacité réelle et les conditions d’une éventuelle embauche." actions={<Button variant="secondary" onClick={() => setObjectiveOpen(true)}><Pencil className="size-4" /> Modifier l’objectif</Button>} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["CA facturé", formatMoney(revenue), `${Math.round(revenue / Math.max(objective?.revenueTarget ?? 1, 1) * 100)} % de l’objectif`], ["Marge brute", formatMoney(margin), "prestations terminées"], ["Marge horaire", `${formatMoney(avgHourly)}/h`, `objectif ${formatMoney(data.settings.hourlyMarginTarget)}/h`], ["Conversion", `${Math.round(conversionRate(data.leads) * 100)} %`, `objectif ${data.settings.conversionTargetBasisPoints / 100} %`],
      ].map(([label, value, detail]) => <Card key={label}><CardContent className="p-5"><p className="text-xs font-semibold text-zinc-500">{label}</p><p className="mt-4 text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] text-zinc-600">{detail}</p></CardContent></Card>)}</section>
      <Card><CardContent className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid size-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-400"><Target className="size-5" /></span><div className="flex-1"><div className="flex items-center justify-between"><div><p className="text-sm font-bold capitalize">Objectif de {currentMonthLabel}</p><p className="mt-1 text-xs text-zinc-600">{formatMoney(revenue)} facturé sur {formatMoney(objective?.revenueTarget ?? 0)}</p></div><p className="text-lg font-bold text-brand-300">{Math.round(revenue / Math.max(objective?.revenueTarget ?? 1, 1) * 100)} %</p></div><Progress value={revenue / Math.max(objective?.revenueTarget ?? 1, 1) * 100} className="mt-3" /></div></div></CardContent></Card>
      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><Card><CardHeader><div><h2 className="font-bold">Acquisition & conversion</h2><p className="mt-1 text-xs text-zinc-500">Demandes et ventes par source.</p></div><BarChart3 className="size-4 text-zinc-600" /></CardHeader><CardContent className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={revenueBySource} margin={{ top: 12, right: 8, left: -24, bottom: 16 }}><CartesianGrid stroke="rgba(41,50,71,.09)" vertical={false} /><XAxis dataKey="source" tick={{ fill: "#687386", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "#687386", fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#ffffff", color: "#172033", border: "1px solid rgba(41,50,71,.1)", borderRadius: 12, boxShadow: "0 12px 35px rgba(78,64,120,.12)", fontSize: 12 }} /><Bar dataKey="demandes" fill="#a78bfa" radius={[6, 6, 0, 0]} /><Bar dataKey="gagnées" fill="#f9734f" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><div><h2 className="font-bold">Rentabilité par offre</h2><p className="mt-1 text-xs text-zinc-500">Données réalisées uniquement.</p></div></CardHeader><CardContent className="grid gap-2">{serviceStats.slice(0, 6).map((item) => <div key={item.service.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-xl p-3 hover:bg-white/[0.025]"><div><p className="text-xs font-semibold">{item.service.name}</p><p className="mt-1 text-[10px] text-zinc-600">{item.sales} vente(s)</p></div><p className="text-xs font-bold">{formatMoney(item.revenue)}</p><Badge variant={item.avgMargin > 0 ? "green" : "neutral"}>{formatMoney(item.avgMargin)} moy.</Badge></div>)}</CardContent></Card></section>
      <Card><CardHeader><div><h2 className="flex items-center gap-2 font-bold"><UsersRound className="size-4 text-violet-300" /> Simulation de recrutement</h2><p className="mt-1 text-xs text-zinc-500">Ce simulateur expose les hypothèses ; il ne recommande jamais automatiquement une embauche.</p></div></CardHeader><CardContent><div className="grid gap-5 lg:grid-cols-[1fr_1fr]"><div className="grid gap-4 sm:grid-cols-3"><Field label="Coût chargé / mois (€)"><Input min="0" type="number" value={salaryCost} onChange={(event) => setSalaryCost(Math.max(0, Number(event.target.value)))} /></Field><Field label="Marge de sécurité (%)"><Input min="0" type="number" value={safetyRate} onChange={(event) => setSafetyRate(Math.max(0, Number(event.target.value)))} /></Field><Field label="Marge par prestation (€)"><Input min="0" type="number" value={marginPerJob} onChange={(event) => setMarginPerJob(Math.max(0, Number(event.target.value)))} /></Field></div><div className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.045] p-5"><div className="flex items-center gap-3"><Calculator className="size-5 text-violet-300" /><div><p className="text-xs text-zinc-500">Marge mensuelle additionnelle nécessaire</p><p className="mt-1 text-xl font-bold">{new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(requiredMonthlyMargin)}</p></div></div><p className="mt-4 text-xs leading-5 text-zinc-500">Cela représente environ <strong className="text-zinc-200">{extraJobs} prestations supplémentaires par mois</strong>. À confronter au remplissage réel, à la trésorerie, à la récurrence de la demande et à la capacité des associés.</p></div></div></CardContent></Card>
      <Modal open={objectiveOpen} onClose={() => setObjectiveOpen(false)} title="Objectif mensuel" description={currentMonthLabel}><div className="grid gap-4"><Field label="CA objectif (€)"><Input autoFocus min="0" type="number" value={objectiveEuros} onChange={(event) => setObjectiveEuros(Math.max(0, Number(event.target.value)))} /></Field><Button onClick={() => { data.updateObjective(currentMonth, { revenueTarget: Math.round(objectiveEuros * 100) }); toast.success("Objectif mis à jour"); setObjectiveOpen(false); }}><TrendingUp className="size-4" /> Enregistrer l’objectif</Button></div></Modal>
    </div>
  );
}
