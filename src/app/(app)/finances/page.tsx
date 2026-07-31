"use client";

import { Banknote, CircleDollarSign, Landmark, PackageSearch, ReceiptText, ShieldCheck, TrendingDown, WalletCards } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cashBalance, collectedRevenue, unpaidAmount } from "@/lib/domain/calculations";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

export default function FinancesPage() {
  const data = useDemoStore();
  const [tab, setTab] = useState<"expenses" | "assets">("expenses");
  const collected = collectedRevenue(data.payments);
  const paidExpenses = data.expenses.filter((expense) => expense.paid).reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  const pendingExpenses = data.expenses.filter((expense) => !expense.paid).reduce((sum, expense) => sum + expense.amountIncludingTax, 0);
  const cash = cashBalance(data.settings.initialCash, data.payments, data.expenses);
  const unpaid = unpaidAmount(data.invoices, data.payments);
  const recoverableVat = data.expenses.filter((expense) => expense.vatRecoverable).reduce((sum, expense) => sum + expense.vatAmount, 0);
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Trésorerie & charges" title="Finances" description="Le cash-flow du mois, le solde de trésorerie, le CA facturé et l’encaissé restent quatre notions distinctes." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        { icon: WalletCards, label: "Trésorerie disponible", value: formatMoney(cash), detail: `dont ${formatMoney(data.settings.initialCash)} de solde initial`, color: "text-orange-300" },
        { icon: Banknote, label: "Cash-flow du mois", value: formatMoney(collected - paidExpenses), detail: `${formatMoney(collected)} encaissé − ${formatMoney(paidExpenses)} payé`, color: collected - paidExpenses >= 0 ? "text-emerald-300" : "text-red-300" },
        { icon: ReceiptText, label: "Impayés clients", value: formatMoney(unpaid), detail: "factures émises non soldées", color: "text-red-300" },
        { icon: TrendingDown, label: "Charges à payer", value: formatMoney(pendingExpenses), detail: `${formatMoney(recoverableVat)} de TVA récupérable`, color: "text-sky-300" },
      ].map((item) => <Card key={item.label}><CardContent className="p-5"><div className="flex items-start justify-between"><p className="text-xs font-semibold text-zinc-500">{item.label}</p><item.icon className={`size-4 ${item.color}`} /></div><p className={`mt-4 text-2xl font-bold ${item.color}`}>{item.value}</p><p className="mt-1 text-[10px] text-zinc-600">{item.detail}</p></CardContent></Card>)}</section>
      {cash < data.settings.cashSafetyBuffer && <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.055] p-4"><ShieldCheck className="mt-0.5 size-5 text-red-300" /><div><p className="text-sm font-bold text-red-200">Trésorerie sous la marge de sécurité</p><p className="mt-1 text-xs text-zinc-500">La marge configurée est de {formatMoney(data.settings.cashSafetyBuffer)}.</p></div></div>}
      <div className="flex gap-2"><Button variant={tab === "expenses" ? "secondary" : "ghost"} onClick={() => setTab("expenses")}><CircleDollarSign className="size-4" /> Charges</Button><Button variant={tab === "assets" ? "secondary" : "ghost"} onClick={() => setTab("assets")}><PackageSearch className="size-4" /> Investissements & matériel</Button></div>
      {tab === "expenses" ? <Card><CardHeader><div><h2 className="font-bold">Charges & dépenses</h2><p className="mt-1 text-xs text-zinc-500">Ajoutez une dépense depuis le bouton global « Ajouter ».</p></div><Badge>{data.expenses.length} écritures</Badge></CardHeader><CardContent className="overflow-x-auto px-0 pb-1"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Date", "Famille", "Catégorie", "Fournisseur", "Description", "TTC", "TVA", "Récurrence", "Paiement"].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5">{head}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.055]">{data.expenses.map((expense) => <tr key={expense.id} className="hover:bg-white/[0.02]"><td className="px-4 py-4 pl-5 text-zinc-500">{formatDate(expense.date)}</td><td className="px-4 py-4"><Badge>{expense.family}</Badge></td><td className="px-4 py-4 font-semibold">{expense.category}</td><td className="px-4 py-4 text-zinc-500">{expense.supplier}</td><td className="px-4 py-4 text-zinc-400">{expense.description}</td><td className="px-4 py-4 font-bold">{formatMoney(expense.amountIncludingTax)}</td><td className="px-4 py-4 text-zinc-500">{formatMoney(expense.vatAmount)}</td><td className="px-4 py-4 text-zinc-500">{expense.recurrence}</td><td className="px-4 py-4"><Badge variant={expense.paid ? "green" : "yellow"}>{expense.paid ? "Payée" : "À payer"}</Badge></td></tr>)}</tbody></table></CardContent></Card> : <section className="grid gap-4 lg:grid-cols-2">{data.assets.map((asset) => { const monthlyTimeValue = Math.round(asset.expectedTimeGainMinutes / 60 * data.settings.hourlyMarginTarget * 4); const monthlyBenefit = asset.expectedMonthlyRevenue + monthlyTimeValue; const payback = monthlyBenefit > 0 ? asset.priceIncludingTax / monthlyBenefit : null; return <Card key={asset.id}><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{asset.name}</p><p className="mt-1 text-xs text-zinc-600">{asset.category} · {asset.supplier || "Fournisseur à définir"}</p></div><Badge variant={asset.status === "in_service" ? "green" : "yellow"}>{asset.status}</Badge></div><div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-zinc-600">Prix TTC</p><p className="mt-1 text-sm font-bold">{formatMoney(asset.priceIncludingTax)}</p></div><div><p className="text-[10px] text-zinc-600">Gain temps</p><p className="mt-1 text-sm font-bold">{asset.expectedTimeGainMinutes} min</p></div><div><p className="text-[10px] text-zinc-600">ROI estimé</p><p className="mt-1 text-sm font-bold text-emerald-300">{payback ? `${payback.toFixed(1)} mois` : "À compléter"}</p></div></div><div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"><p className="flex items-center gap-2 text-xs font-semibold text-zinc-300"><Landmark className="size-3.5 text-sky-300" /> Hypothèses du ROI</p><p className="mt-2 text-[11px] leading-5 text-zinc-600">Revenu mensuel additionnel {formatMoney(asset.expectedMonthlyRevenue)} + valeur de 4 gains de temps mensuels {formatMoney(monthlyTimeValue)}, au taux cible de {formatMoney(data.settings.hourlyMarginTarget)}/h.</p></div></CardContent></Card>; })}</section>}
    </div>
  );
}
