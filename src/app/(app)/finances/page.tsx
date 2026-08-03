"use client";

import { Banknote, CalendarClock, CircleDollarSign, Landmark, PackageSearch, Plus, ReceiptText, Repeat2, ShieldCheck, WalletCards } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import {
  cashBalance,
  collectedRevenue,
  paidExpenseAmountForMonth,
  projectedExpenseAmountForMonth,
  projectedExpensesForMonth,
  recurringExpenseMetrics,
  unpaidAmount,
} from "@/lib/domain/calculations";
import { monthKey } from "@/lib/domain/periods";
import type { Expense } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

const recurrenceLabels: Record<Expense["recurrence"], string> = {
  one_off: "Ponctuelle",
  monthly: "Mensuelle",
  annual: "Annuelle",
};

const familyLabels: Record<Expense["family"], string> = {
  fixed: "Fixe",
  variable: "Variable",
  investment: "Investissement",
  personal: "Personnel",
};

export default function FinancesPage() {
  const data = useDemoStore();
  const [tab, setTab] = useState<"expenses" | "assets">("expenses");
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [recurrenceFilter, setRecurrenceFilter] = useState<"all" | Expense["recurrence"]>("all");

  const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(`${selectedMonth}-01T12:00:00`));
  const selectedExpenses = projectedExpensesForMonth(data.expenses, selectedMonth);
  const projectedExpenses = projectedExpenseAmountForMonth(data.expenses, selectedMonth);
  const paidExpenses = paidExpenseAmountForMonth(data.expenses, selectedMonth);
  const collected = collectedRevenue(data.payments.filter((payment) => payment.paidAt.slice(0, 7) === selectedMonth));
  const cash = cashBalance(data.settings.initialCash, data.payments, data.expenses);
  const unpaid = unpaidAmount(data.invoices, data.payments);
  const recoverableVat = selectedExpenses.filter((expense) => expense.vatRecoverable).reduce((sum, expense) => sum + expense.vatAmount, 0);
  const recurring = recurringExpenseMetrics(data.expenses, selectedMonth);
  const oneOff = selectedExpenses.filter((expense) => expense.recurrence === "one_off").reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  const visibleExpenses = [...data.expenses]
    .filter((expense) => recurrenceFilter === "all" || expense.recurrence === recurrenceFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const openExpenseForm = () => window.dispatchEvent(new CustomEvent("adetailing:open-add", { detail: "expense" }));

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Trésorerie & charges"
        title="Finances"
        description="Distinguez les décaissements réels des charges prévues, qu’elles soient ponctuelles, mensuelles ou annuelles."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-[170px]" aria-label="Mois analysé" type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
            <Button onClick={openExpenseForm}><Plus className="size-4" /> Ajouter une dépense</Button>
          </div>
        )}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: WalletCards, label: "Trésorerie disponible", value: formatMoney(cash), detail: "Solde réel, prélèvements automatiques inclus", color: "text-orange-300" },
          { icon: Banknote, label: `Cash-flow · ${monthLabel}`, value: formatMoney(collected - paidExpenses), detail: `${formatMoney(collected)} encaissé − ${formatMoney(paidExpenses)} décaissé`, color: collected - paidExpenses >= 0 ? "text-emerald-300" : "text-red-300" },
          { icon: ReceiptText, label: "Impayés clients", value: formatMoney(unpaid), detail: "Factures émises non soldées", color: "text-red-300" },
          { icon: CalendarClock, label: `Charges prévues · ${monthLabel}`, value: formatMoney(projectedExpenses), detail: `${formatMoney(paidExpenses)} décaissé · ${formatMoney(recoverableVat)} de TVA récupérable`, color: "text-sky-300" },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-zinc-500 capitalize">{item.label}</p><item.icon className={`size-4 ${item.color}`} /></div>
              <p className={`mt-4 text-2xl font-bold ${item.color}`}>{item.value}</p>
              <p className="mt-1 text-[10px] text-zinc-600">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {cash < data.settings.cashSafetyBuffer && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.055] p-4">
          <ShieldCheck className="mt-0.5 size-5 text-red-300" />
          <div><p className="text-sm font-bold text-red-200">Trésorerie sous la marge de sécurité</p><p className="mt-1 text-xs text-zinc-500">La marge configurée est de {formatMoney(data.settings.cashSafetyBuffer)}.</p></div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><Repeat2 className="size-4 text-violet-300" /> Structure des charges</h2><p className="mt-1 text-xs text-zinc-500">Les charges récurrentes sont automatiquement projetées à partir de leur première échéance.</p></div>
          <Badge>{data.expenses.filter((expense) => expense.recurrence !== "one_off").length} récurrentes</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"><p className="text-[10px] font-bold text-zinc-600 uppercase">Équivalent mensuel récurrent</p><p className="mt-2 text-xl font-bold">{formatMoney(recurring.monthlyEquivalent)}</p><p className="mt-1 text-[10px] text-zinc-600">Mensuel + annuel réparti sur 12 mois</p></div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"><p className="text-[10px] font-bold text-zinc-600 uppercase">Engagement annuel récurrent</p><p className="mt-2 text-xl font-bold">{formatMoney(recurring.annualCommitment)}</p><p className="mt-1 text-[10px] text-zinc-600">12 mensualités + échéances annuelles</p></div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"><p className="text-[10px] font-bold text-zinc-600 uppercase">Ponctuel · {monthLabel}</p><p className="mt-2 text-xl font-bold">{formatMoney(oneOff)}</p><p className="mt-1 text-[10px] text-zinc-600">Compté uniquement sur le mois choisi</p></div>
          </div>
          <p className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/[0.045] px-4 py-3 text-xs leading-5 text-zinc-500">Une charge récurrente cochée « prélèvement automatique » est intégrée à la trésorerie à chaque échéance. Sans cette option, elle reste visible dans les charges prévues sans être considérée comme décaissée.</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === "expenses" ? "secondary" : "ghost"} onClick={() => setTab("expenses")}><CircleDollarSign className="size-4" /> Charges</Button>
        <Button variant={tab === "assets" ? "secondary" : "ghost"} onClick={() => setTab("assets")}><PackageSearch className="size-4" /> Investissements & matériel</Button>
      </div>

      {tab === "expenses" ? (
        <Card>
          <CardHeader>
            <div><h2 className="font-bold">Charges & dépenses</h2><p className="mt-1 text-xs text-zinc-500">Une ligne récurrente représente une règle ; elle n’est pas dupliquée chaque mois dans cette liste.</p></div>
            <div className="flex items-center gap-2"><Select aria-label="Filtrer par fréquence" className="w-[170px]" value={recurrenceFilter} onChange={(event) => setRecurrenceFilter(event.target.value as typeof recurrenceFilter)}><option value="all">Toutes les fréquences</option><option value="one_off">Ponctuelles</option><option value="monthly">Mensuelles</option><option value="annual">Annuelles</option></Select><Badge>{visibleExpenses.length} charge(s)</Badge></div>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-1">
            <table className="w-full min-w-[960px] text-left text-xs">
              <thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Début / date", "Fréquence", "Famille", "Catégorie", "Fournisseur", "Description", "TTC / échéance", "TVA", "Paiement"].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5">{head}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/[0.055]">
                {visibleExpenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-4 pl-5 text-zinc-500">{formatDate(expense.date)}</td>
                    <td className="px-4 py-4"><Badge variant={expense.recurrence === "one_off" ? "neutral" : "blue"}>{recurrenceLabels[expense.recurrence]}</Badge></td>
                    <td className="px-4 py-4"><Badge>{familyLabels[expense.family]}</Badge></td>
                    <td className="px-4 py-4 font-semibold">{expense.category}</td>
                    <td className="px-4 py-4 text-zinc-500">{expense.supplier}</td>
                    <td className="px-4 py-4 text-zinc-400">{expense.description}</td>
                    <td className="px-4 py-4 font-bold">{formatMoney(expense.amountIncludingTax)}</td>
                    <td className="px-4 py-4 text-zinc-500">{formatMoney(expense.vatAmount)}</td>
                    <td className="px-4 py-4"><Badge variant={expense.paid ? "green" : "yellow"}>{expense.recurrence === "one_off" ? (expense.paid ? "Payée" : "À payer") : (expense.paid ? "Automatique" : "À valider")}</Badge></td>
                  </tr>
                ))}
                {visibleExpenses.length === 0 && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-zinc-500">Aucune charge ne correspond à ce filtre.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {data.assets.map((asset) => {
            const monthlyTimeValue = Math.round(asset.expectedTimeGainMinutes / 60 * data.settings.hourlyMarginTarget * 4);
            const monthlyBenefit = asset.expectedMonthlyRevenue + monthlyTimeValue;
            const payback = monthlyBenefit > 0 ? asset.priceIncludingTax / monthlyBenefit : null;
            return (
              <Card key={asset.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{asset.name}</p><p className="mt-1 text-xs text-zinc-600">{asset.category} · {asset.supplier || "Fournisseur à définir"}</p></div><Badge variant={asset.status === "in_service" ? "green" : "yellow"}>{asset.status}</Badge></div>
                  <div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-zinc-600">Prix TTC</p><p className="mt-1 text-sm font-bold">{formatMoney(asset.priceIncludingTax)}</p></div><div><p className="text-[10px] text-zinc-600">Gain temps</p><p className="mt-1 text-sm font-bold">{asset.expectedTimeGainMinutes} min</p></div><div><p className="text-[10px] text-zinc-600">ROI estimé</p><p className="mt-1 text-sm font-bold text-emerald-300">{payback ? `${payback.toFixed(1)} mois` : "À compléter"}</p></div></div>
                  <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"><p className="flex items-center gap-2 text-xs font-semibold text-zinc-300"><Landmark className="size-3.5 text-sky-300" /> Hypothèses du ROI</p><p className="mt-2 text-[11px] leading-5 text-zinc-600">Revenu mensuel additionnel {formatMoney(asset.expectedMonthlyRevenue)} + valeur de 4 gains de temps mensuels {formatMoney(monthlyTimeValue)}, au taux cible de {formatMoney(data.settings.hourlyMarginTarget)}/h.</p></div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
