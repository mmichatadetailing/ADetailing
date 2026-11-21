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
import { totalRevenueObjective, type CashFlowChartPoint, type RevenueChartPoint } from "@/lib/domain/dashboard-charts";
import { formatMoney } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  boxShadow: "0 12px 32px rgba(22,25,20,.1)",
  color: "var(--text)",
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
  focusMonth,
  periodLabel,
}: {
  year: number;
  revenue: RevenueChartPoint[];
  cashFlow: CashFlowChartPoint[];
  focusMonth?: string;
  periodLabel: string;
}) {
  const periodRevenue = focusMonth ? revenue.filter((item) => item.key === focusMonth) : revenue;
  const periodCashFlow = focusMonth ? cashFlow.filter((item) => item.key === focusMonth) : cashFlow;
  const isAnnualView = !focusMonth;
  const periodCollected = periodRevenue.reduce((sum, item) => sum + item.collected, 0);
  const periodObjective = totalRevenueObjective(periodRevenue);
  const annualCashFlow = periodCashFlow.reduce((sum, item) => sum + item.cashFlow, 0);
  const periodExpenses = periodCashFlow.reduce((sum, item) => sum + item.expenses, 0);
  const periodPaidExpenses = periodCashFlow.reduce((sum, item) => sum + item.paidExpenses, 0);
  const positiveMonths = periodCashFlow.filter((item) => item.cashFlow > 0).length;
  const negativeMonths = periodCashFlow.filter((item) => item.cashFlow < 0).length;

  return (
    <section className="grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-4 sm:flex-row">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full tone-icon" data-tone="blue"><Target className="size-[18px]" /></span>
            <div>
              <h2 className="font-bold">Objectif & encaissements</h2>
              <p className="mt-1 text-xs text-zinc-500">Exercice {year} · encaissements des prestations, des entretiens et du registre historique, comptés une seule fois.</p>
            </div>
          </div>
          <Badge>{periodLabel}</Badge>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="mb-5 grid gap-3 rounded-2xl border border-contrast/[0.06] bg-brand-50/60 p-4 shadow-sm sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold tracking-[.12em] text-zinc-600 uppercase">CA encaissé · {isAnnualView ? "année" : "mois"}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-emerald-700">{formatMoney(periodCollected)}</p>
            </div>
            <div className="sm:border-l sm:border-line sm:pl-4">
              <p className="text-[10px] font-bold tracking-[.12em] text-zinc-600 uppercase">{isAnnualView ? "Objectif annuel" : "Objectif du mois"}</p>
              <p className="tone-text mt-1 text-xl font-semibold tracking-tight" data-tone="blue">{formatMoney(periodObjective)}</p>
              {isAnnualView && <p className="mt-1 text-[10px] text-zinc-500">Somme des 12 objectifs mensuels</p>}
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-zinc-500">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-[var(--chart-green)]" /> Encaissements</span>
            <span className="flex items-center gap-2"><span className="h-0 w-5 border-t-2 border-dashed border-[var(--chart-blue)]" /> Objectif</span>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="h-[285px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revenue} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardRevenueBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-green-top)" />
                      <stop offset="100%" stopColor="var(--chart-green)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10, fontWeight: 600 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={formatAxisMoney} width={42} />
                  <Tooltip
                    cursor={{ fill: "var(--chart-cursor)" }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--text)", fontWeight: 800, marginBottom: 6 }}
                    formatter={(value, name) => [tooltipMoney(value), name === "collected" || name === "CA encaissé" ? "CA encaissé" : "Objectif"]}
                  />
                  <Bar dataKey="collected" name="CA encaissé" fill="url(#dashboardRevenueBar)" radius={[7, 7, 3, 3]} maxBarSize={30} animationDuration={700}>
                    {revenue.map((item) => <Cell key={item.key} fill="url(#dashboardRevenueBar)" opacity={!focusMonth || item.key === focusMonth ? 1 : 0.22} />)}
                  </Bar>
                  <Line dataKey="objective" name="Objectif" type="monotone" stroke="var(--chart-blue)" strokeWidth={2.5} strokeDasharray="6 5" connectNulls={false} dot={{ r: 4, fill: "var(--surface)", stroke: "var(--chart-blue)", strokeWidth: 2 }} activeDot={{ r: 6, fill: "var(--chart-blue)", stroke: "var(--surface)", strokeWidth: 3 }} animationDuration={700} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-4 sm:flex-row">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full tone-icon" data-tone="emerald"><WalletCards className="size-[18px]" /></span>
            <div>
              <h2 className="font-bold">Encaissements & charges</h2>
              <p className="mt-1 text-xs text-zinc-500">Ce graphique compare les encaissements aux charges prévues à leur échéance. Il ne représente pas le résultat enregistré.</p>
            </div>
          </div>
          <Badge variant={annualCashFlow >= 0 ? "green" : "red"}>{annualCashFlow >= 0 ? "Positif" : "Négatif"}</Badge>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="mb-5 rounded-2xl border border-contrast/[0.06] bg-brand-50/60 p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold tracking-[.12em] text-zinc-500 uppercase">Solde après charges prévues</p>
                <p className={`mt-1 flex items-center gap-1.5 text-xl font-semibold tracking-tight ${annualCashFlow >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {annualCashFlow >= 0 ? <ArrowUpRight className="size-5" /> : <ArrowDownRight className="size-5" />}
                  {formatMoney(annualCashFlow)}
                </p>
              </div>
              <div className="sm:border-l sm:border-line sm:pl-4"><p className="text-[10px] font-bold tracking-[.12em] text-zinc-500 uppercase">Charges prévues</p><p className="tone-text mt-1 text-lg font-semibold" data-tone="amber">{formatMoney(periodExpenses)}</p></div>
              <div className="sm:border-l sm:border-line sm:pl-4"><p className="text-[10px] font-bold tracking-[.12em] text-zinc-500 uppercase">Décaissements avec estimations</p><p className="mt-1 text-lg font-semibold text-zinc-800">{formatMoney(periodPaidExpenses)}</p></div>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-zinc-500">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-[var(--chart-green)]" /> Solde positif</span>
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-[var(--chart-red)]" /> Solde négatif</span>
            <span className="ml-auto">{positiveMonths} mois positif(s) · {negativeMonths} négatif(s)</span>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="h-[285px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashFlow} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardCashPositive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-green-top)" />
                      <stop offset="100%" stopColor="var(--chart-green)" />
                    </linearGradient>
                    <linearGradient id="dashboardCashNegative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-red-top)" />
                      <stop offset="100%" stopColor="var(--chart-red)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10, fontWeight: 600 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={formatAxisMoney} width={42} />
                  <ReferenceLine y={0} stroke="var(--muted)" strokeWidth={1.4} />
                  <Tooltip
                    cursor={{ fill: "var(--chart-cursor)" }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--text)", fontWeight: 800, marginBottom: 6 }}
                    formatter={(value) => [tooltipMoney(value), "Encaissements − charges prévues"]}
                  />
                  <Bar dataKey="cashFlow" name="Solde après charges prévues" radius={[7, 7, 7, 7]} maxBarSize={28} animationDuration={700}>
                    {cashFlow.map((item) => <Cell key={item.key} fill={item.cashFlow >= 0 ? "url(#dashboardCashPositive)" : "url(#dashboardCashNegative)"} opacity={!focusMonth || item.key === focusMonth ? 1 : 0.2} />)}
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
