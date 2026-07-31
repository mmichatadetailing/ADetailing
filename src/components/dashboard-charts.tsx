"use client";

import { ArrowDownRight, ArrowUpRight, Target, WalletCards } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CashFlowChartPoint, RevenueChartPoint } from "@/lib/domain/dashboard-charts";
import { formatMoney } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";

const tooltipStyle = {
  background: "rgba(255,255,255,.97)",
  border: "1px solid rgba(41,50,71,.1)",
  borderRadius: 14,
  boxShadow: "0 16px 42px rgba(78,64,120,.14)",
  color: "#172033",
  fontSize: 12,
};

function formatAxisMoney(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

function tooltipMoney(value: unknown) {
  return formatMoney(Number(value ?? 0));
}

export function DashboardCharts({
  year,
  revenue,
  cashFlow,
}: {
  year: number;
  revenue: RevenueChartPoint[];
  cashFlow: CashFlowChartPoint[];
}) {
  const annualRealized = revenue.reduce((sum, item) => sum + item.realized, 0);
  const annualObjective = revenue.reduce((sum, item) => sum + (item.objective ?? 0), 0);
  const annualCashFlow = cashFlow.reduce((sum, item) => sum + item.cashFlow, 0);
  const positiveMonths = cashFlow.filter((item) => item.cashFlow > 0).length;
  const negativeMonths = cashFlow.filter((item) => item.cashFlow < 0).length;

  return (
    <section className="grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
      <Card className="overflow-hidden bg-[linear-gradient(145deg,rgba(255,247,237,.78),rgba(255,255,255,.96)_45%,rgba(245,243,255,.72))]">
        <CardHeader className="flex-col gap-4 sm:flex-row">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-orange-100 text-brand-600 shadow-sm"><Target className="size-[18px]" /></span>
            <div>
              <h2 className="font-bold">Objectif & chiffre d’affaires</h2>
              <p className="mt-1 text-xs text-zinc-500">CA facturé comparé aux objectifs mensuels renseignés.</p>
            </div>
          </div>
          <Badge variant="orange">Exercice {year}</Badge>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="mb-5 grid gap-3 rounded-2xl border border-white/8 bg-ink-900/70 p-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold tracking-[.12em] text-zinc-600 uppercase">CA facturé</p>
              <p className="mt-1 text-xl font-extrabold tracking-tight text-brand-600">{formatMoney(annualRealized)}</p>
            </div>
            <div className="sm:border-l sm:border-white/8 sm:pl-4">
              <p className="text-[10px] font-bold tracking-[.12em] text-zinc-600 uppercase">Objectifs renseignés</p>
              <p className="mt-1 text-xl font-extrabold tracking-tight">{formatMoney(annualObjective)}</p>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-zinc-500">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-gradient-to-b from-brand-400 to-brand-600" /> CA réalisé</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded-full bg-violet-500" /> Objectif</span>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="h-[285px] min-w-[620px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revenue} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardRevenueBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff9d5c" />
                      <stop offset="100%" stopColor="#f9734f" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(41,50,71,.085)" strokeDasharray="4 5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#687386", fontSize: 10, fontWeight: 600 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8b94a3", fontSize: 10 }} tickFormatter={formatAxisMoney} width={42} />
                  <Tooltip
                    cursor={{ fill: "rgba(249,115,79,.045)" }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#172033", fontWeight: 800, marginBottom: 6 }}
                    formatter={(value, name) => [tooltipMoney(value), name === "realized" ? "CA réalisé" : "Objectif"]}
                  />
                  <Bar dataKey="realized" name="CA réalisé" fill="url(#dashboardRevenueBar)" radius={[7, 7, 3, 3]} maxBarSize={30} animationDuration={700} />
                  <Line dataKey="objective" name="Objectif" type="monotone" stroke="#7653c6" strokeWidth={2.5} strokeDasharray="6 5" connectNulls={false} dot={{ r: 4, fill: "#ffffff", stroke: "#7653c6", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#7653c6", stroke: "#ffffff", strokeWidth: 3 }} animationDuration={700} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden bg-[linear-gradient(145deg,rgba(240,253,250,.76),rgba(255,255,255,.97)_48%,rgba(255,241,242,.62))]">
        <CardHeader className="flex-col gap-4 sm:flex-row">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-sm"><WalletCards className="size-[18px]" /></span>
            <div>
              <h2 className="font-bold">Cash-flow mensuel</h2>
              <p className="mt-1 text-xs text-zinc-500">Encaissements diminués des dépenses réellement payées.</p>
            </div>
          </div>
          <Badge variant={annualCashFlow >= 0 ? "green" : "red"}>{annualCashFlow >= 0 ? "Positif" : "Négatif"}</Badge>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="mb-5 rounded-2xl border border-white/8 bg-ink-900/70 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold tracking-[.12em] text-zinc-600 uppercase">Solde net de l’exercice</p>
                <p className={`mt-1 flex items-center gap-1.5 text-xl font-extrabold tracking-tight ${annualCashFlow >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {annualCashFlow >= 0 ? <ArrowUpRight className="size-5" /> : <ArrowDownRight className="size-5" />}
                  {formatMoney(annualCashFlow)}
                </p>
              </div>
              <p className="text-[11px] font-semibold text-zinc-500"><span className="text-emerald-700">{positiveMonths} positif(s)</span> · <span className="text-red-600">{negativeMonths} négatif(s)</span></p>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-zinc-500">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-emerald-500" /> Positif</span>
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-red-500" /> Négatif</span>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="h-[285px] min-w-[620px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashFlow} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardCashPositive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38b88a" />
                      <stop offset="100%" stopColor="#0f8a67" />
                    </linearGradient>
                    <linearGradient id="dashboardCashNegative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e85d6b" />
                      <stop offset="100%" stopColor="#c23b4a" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(41,50,71,.085)" strokeDasharray="4 5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#687386", fontSize: 10, fontWeight: 600 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8b94a3", fontSize: 10 }} tickFormatter={formatAxisMoney} width={42} />
                  <ReferenceLine y={0} stroke="#8b94a3" strokeWidth={1.4} />
                  <Tooltip
                    cursor={{ fill: "rgba(78,64,120,.04)" }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#172033", fontWeight: 800, marginBottom: 6 }}
                    formatter={(value) => [tooltipMoney(value), "Cash-flow net"]}
                  />
                  <Bar dataKey="cashFlow" name="Cash-flow net" radius={[7, 7, 7, 7]} maxBarSize={28} animationDuration={700}>
                    {cashFlow.map((item) => <Cell key={item.key} fill={item.cashFlow >= 0 ? "url(#dashboardCashPositive)" : "url(#dashboardCashNegative)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
