"use client";

import { AlertCircle, Banknote, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, Landmark, PackageSearch, Pencil, Plus, ReceiptText, Repeat2, Save, ShieldCheck, Trash2, TriangleAlert, WalletCards } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  cashBalance,
  collectedRevenue,
  expenseForecast,
  expenseMonthSummary,
  paidExpenseAmountForMonth,
  recurringExpenseMetrics,
} from "@/lib/domain/calculations";
import { getInterventionWorkflow } from "@/lib/domain/intervention-workflow";
import { monthKey } from "@/lib/domain/periods";
import type { Expense } from "@/lib/domain/types";
import { useDemoStore, type NewExpenseInput } from "@/lib/demo/store";
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

const occurrenceLabels = {
  paid: "Décaissée",
  due: "À régler",
  upcoming: "À venir",
} as const;

function formatMonth(month: string, style: "long" | "short" = "long") {
  const label = new Intl.DateTimeFormat("fr-FR", { month: style, year: "numeric" }).format(new Date(`${month}-01T12:00:00`));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function vatRateForExpense(expense: Expense) {
  if (expense.amountExcludingTax <= 0) return 0;
  return Math.round(expense.vatAmount / expense.amountExcludingTax * 1_000) / 10;
}

function ExpenseEditor({ expense, onCancel, onSave }: { expense: Expense; onCancel: () => void; onSave: (input: NewExpenseInput) => void }) {
  const [date, setDate] = useState(expense.date.slice(0, 10));
  const [recurrence, setRecurrence] = useState<Expense["recurrence"]>(expense.recurrence);
  const [family, setFamily] = useState<Expense["family"]>(expense.family);
  const [category, setCategory] = useState(expense.category);
  const [supplier, setSupplier] = useState(expense.supplier);
  const [description, setDescription] = useState(expense.description);
  const [amountEuros, setAmountEuros] = useState(expense.amountIncludingTax / 100);
  const [vatRate, setVatRate] = useState(vatRateForExpense(expense));
  const [paid, setPaid] = useState(expense.paid);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!date) return toast.error("Indiquez une date.");
    if (category.trim().length < 2) return toast.error("Indiquez une catégorie.");
    if (description.trim().length < 2) return toast.error("Indiquez une description.");
    if (!Number.isFinite(amountEuros) || amountEuros <= 0) return toast.error("Le montant doit être supérieur à zéro.");
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) return toast.error("Le taux de TVA doit être compris entre 0 et 100 %.");
    onSave({
      date,
      recurrence,
      family,
      category: category.trim(),
      supplier: supplier.trim(),
      description: description.trim(),
      amountIncludingTax: Math.round(amountEuros * 100),
      vatRateBasisPoints: Math.round(vatRate * 100),
      paid,
    });
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fréquence"><Select autoFocus value={recurrence} onChange={(event) => setRecurrence(event.target.value as Expense["recurrence"])}><option value="one_off">Ponctuelle</option><option value="monthly">Tous les mois</option><option value="annual">Tous les ans</option></Select></Field>
        <Field label={recurrence === "one_off" ? "Date de la dépense" : "Première échéance"}><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800">
        {recurrence === "monthly" ? "Cette charge sera ajoutée automatiquement au total de chaque mois à cette date." : recurrence === "annual" ? "Cette charge sera ajoutée automatiquement au total du mois de cette échéance, chaque année." : "Cette charge ne sera comptée qu’une seule fois."}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Famille"><Select value={family} onChange={(event) => setFamily(event.target.value as Expense["family"])}><option value="fixed">Fixe</option><option value="variable">Variable</option><option value="investment">Investissement</option><option value="personal">Personnel</option></Select></Field>
        <Field label="Catégorie"><Input value={category} onChange={(event) => setCategory(event.target.value)} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fournisseur" hint="Facultatif"><Input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></Field>
        <Field label="Description"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant TTC (€)"><Input min="0.01" step="0.01" type="number" value={amountEuros} onChange={(event) => setAmountEuros(Number(event.target.value))} /></Field>
        <Field label="TVA (%)"><Input min="0" max="100" step="0.1" type="number" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value))} /></Field>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm font-semibold text-zinc-700"><input type="checkbox" className="accent-brand-500" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> {recurrence === "one_off" ? "Dépense déjà payée" : "Prélèvement automatique à chaque échéance"}</label>
      {recurrence !== "one_off" && <p className="-mt-2 text-[11px] leading-5 text-zinc-500">Même décochée, la charge reste incluse dans le total prévu. Cochez uniquement si elle doit être déduite automatiquement de la trésorerie le jour prévu.</p>}
      <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button type="submit"><Save className="size-4" /> Enregistrer les modifications</Button></div>
    </form>
  );
}

export default function FinancesPage() {
  const data = useDemoStore();
  const [tab, setTab] = useState<"expenses" | "assets">("expenses");
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [recurrenceFilter, setRecurrenceFilter] = useState<"all" | Expense["recurrence"]>("all");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);

  const monthLabel = formatMonth(selectedMonth);
  const monthSummary = expenseMonthSummary(data.expenses, selectedMonth);
  const selectedExpenses = monthSummary.occurrences.map((occurrence) => occurrence.expense);
  const projectedExpenses = monthSummary.total;
  const paidExpenses = paidExpenseAmountForMonth(data.expenses, selectedMonth);
  const collected = collectedRevenue(data.payments.filter((payment) => payment.paidAt.slice(0, 7) === selectedMonth));
  const cash = cashBalance(data.settings.initialCash, data.payments, data.expenses);
  const toCollect = data.interventions
    .filter((intervention) => intervention.status === "completed")
    .reduce((sum, intervention) => {
      const invoice = data.invoices.find((item) => item.id === intervention.invoiceId);
      return sum + getInterventionWorkflow(intervention, invoice, data.payments).outstanding;
    }, 0);
  const recoverableVat = selectedExpenses.filter((expense) => expense.vatRecoverable).reduce((sum, expense) => sum + expense.vatAmount, 0);
  const recurring = recurringExpenseMetrics(data.expenses, selectedMonth);
  const oneOff = monthSummary.oneOff;
  const remainingExpenses = monthSummary.due + monthSummary.upcoming;
  const forecast = expenseForecast(data.expenses, selectedMonth, 12);
  const forecastTotal = forecast.reduce((sum, month) => sum + month.total, 0);
  const forecastMaximum = Math.max(...forecast.map((month) => month.total), 1);
  const visibleExpenses = [...data.expenses]
    .filter((expense) => recurrenceFilter === "all" || expense.recurrence === recurrenceFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const openExpenseForm = () => window.dispatchEvent(new CustomEvent("adetailing:open-add", { detail: "expense" }));
  const saveExpense = (expense: Expense, input: NewExpenseInput) => {
    data.updateExpense(expense.id, input);
    setEditingExpense(null);
    toast.success("Charge modifiée", { description: "Les statistiques et projections ont été recalculées." });
  };
  const deleteExpense = () => {
    if (!deletingExpense) return;
    data.removeExpense(deletingExpense.id);
    setDeletingExpense(null);
    toast.success("Charge supprimée");
  };

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

      <Modal open={Boolean(editingExpense)} onClose={() => setEditingExpense(null)} title="Modifier la charge" description={editingExpense ? `${recurrenceLabels[editingExpense.recurrence]} · ${editingExpense.description}` : undefined}>
        {editingExpense && <ExpenseEditor key={editingExpense.id} expense={editingExpense} onCancel={() => setEditingExpense(null)} onSave={(input) => saveExpense(editingExpense, input)} />}
      </Modal>

      <Modal open={Boolean(deletingExpense)} onClose={() => setDeletingExpense(null)} title="Supprimer cette charge ?" description={deletingExpense?.description}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-red-700"><TriangleAlert className="size-4" /> Cette charge disparaîtra de vos calculs</p>
          <p className="mt-2 text-xs leading-5 text-red-600">{deletingExpense?.recurrence === "one_off" ? "Le décaissement ponctuel ne sera plus comptabilisé dans la trésorerie ni dans les statistiques." : "Toutes les projections liées à cette charge récurrente seront retirées des mois concernés."}</p>
        </div>
        {deletingExpense && <div className="mt-4 grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-600"><p><strong className="text-zinc-900">{deletingExpense.description}</strong> · {formatMoney(deletingExpense.amountIncludingTax)}</p><p>{recurrenceLabels[deletingExpense.recurrence]} · première date le {formatDate(deletingExpense.date)}</p></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeletingExpense(null)}>Annuler</Button><Button variant="danger" onClick={deleteExpense}><Trash2 className="size-4" /> Supprimer définitivement</Button></div>
      </Modal>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { icon: CalendarClock, label: `Total charges · ${monthLabel}`, value: formatMoney(projectedExpenses), detail: `${formatMoney(monthSummary.recurring)} récurrent · ${formatMoney(oneOff)} ponctuel`, color: "text-orange-600" },
          { icon: CheckCircle2, label: "Déjà décaissé", value: formatMoney(paidExpenses), detail: `${formatMoney(monthSummary.paid)} rattaché aux échéances du mois`, color: "text-emerald-700" },
          { icon: Clock3, label: "Reste à décaisser", value: formatMoney(remainingExpenses), detail: `${formatMoney(monthSummary.due)} arrivé à échéance · ${formatMoney(monthSummary.upcoming)} à venir`, color: monthSummary.due > 0 ? "text-red-600" : "text-amber-600" },
          { icon: Banknote, label: "Solde prévisionnel du mois", value: formatMoney(collected - projectedExpenses), detail: `${formatMoney(collected)} encaissé − toutes les charges prévues`, color: collected - projectedExpenses >= 0 ? "text-emerald-700" : "text-red-600" },
          { icon: WalletCards, label: "Trésorerie disponible", value: formatMoney(cash), detail: `${formatMoney(toCollect)} de prestations à encaisser`, color: "text-violet-700" },
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

      {monthSummary.due > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div><p className="text-sm font-bold">{formatMoney(monthSummary.due)} arrivé à échéance</p><p className="mt-1 text-xs text-amber-800">Ces charges sont bien incluses dans le total de {monthLabel}, mais leur paiement reste à confirmer.</p></div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><CalendarClock className="size-4 text-orange-600" /> Échéances de {monthLabel}</h2><p className="mt-1 text-xs text-zinc-500">Le total additionne automatiquement les charges mensuelles, les annuelles dues ce mois-ci et les dépenses ponctuelles.</p></div>
          <Badge variant="orange">{monthSummary.occurrences.length} échéance(s) · {formatMoney(projectedExpenses)}</Badge>
        </CardHeader>
        <CardContent className="grid gap-2">
          {monthSummary.occurrences.map((occurrence) => (
            <div key={occurrence.expense.id} className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 transition hover:border-orange-200 hover:bg-orange-50/60 sm:grid-cols-[110px_minmax(0,1fr)_auto_auto] sm:items-center">
              <div><p className="text-xs font-bold text-zinc-900">{formatDate(occurrence.dueDate, { day: "2-digit", month: "long" })}</p><p className="mt-1 text-[10px] text-zinc-500">{recurrenceLabels[occurrence.expense.recurrence]}</p></div>
              <div className="min-w-0"><p className="truncate text-sm font-bold text-zinc-900">{occurrence.expense.description}</p><p className="mt-1 truncate text-xs text-zinc-500">{occurrence.expense.category}{occurrence.expense.supplier ? ` · ${occurrence.expense.supplier}` : ""}</p></div>
              <div className="flex items-center gap-2 sm:justify-end"><Badge variant={occurrence.status === "paid" ? "green" : occurrence.status === "due" ? "yellow" : "blue"}>{occurrenceLabels[occurrence.status]}</Badge><p className="min-w-20 text-right text-sm font-extrabold text-zinc-900">{formatMoney(occurrence.amount)}</p></div>
              <Button size="sm" variant="secondary" onClick={() => setEditingExpense(occurrence.expense)}><Pencil className="size-3.5" /> Modifier</Button>
            </div>
          ))}
          {monthSummary.occurrences.length === 0 && <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center"><ReceiptText className="mx-auto size-6 text-zinc-400" /><p className="mt-2 text-sm font-bold text-zinc-700">Aucune charge prévue</p><p className="mt-1 text-xs text-zinc-500">Ajoutez une dépense ponctuelle ou une première échéance pour ce mois.</p></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><Banknote className="size-4 text-violet-600" /> Prévision des 12 prochains mois</h2><p className="mt-1 text-xs text-zinc-500">Projection glissante à partir de {monthLabel}, recalculée dès qu’une charge est ajoutée ou modifiée.</p></div>
          <div className="text-right"><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Total prévu</p><p className="mt-1 text-lg font-extrabold text-zinc-900">{formatMoney(forecastTotal)}</p></div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {forecast.map((month) => (
              <button key={month.month} type="button" onClick={() => setSelectedMonth(month.month)} className={`focus-ring rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md ${month.month === selectedMonth ? "border-orange-300 bg-orange-50 shadow-sm" : "border-zinc-200 bg-white"}`}>
                <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold capitalize text-zinc-600">{formatMonth(month.month, "short")}</p>{month.annual > 0 && <Badge variant="blue">annuelle</Badge>}</div>
                <p className="mt-3 text-lg font-extrabold text-zinc-900">{formatMoney(month.total)}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-violet-500" style={{ width: `${Math.max(month.total > 0 ? 8 : 0, Math.round(month.total / forecastMaximum * 100))}%` }} /></div>
                <p className="mt-2 text-[10px] leading-4 text-zinc-500">{formatMoney(month.monthly)} mensuel{month.annual > 0 ? ` · ${formatMoney(month.annual)} annuel` : ""}{month.oneOff > 0 ? ` · ${formatMoney(month.oneOff)} ponctuel` : ""}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><Repeat2 className="size-4 text-violet-600" /> Structure des charges</h2><p className="mt-1 text-xs text-zinc-500">Les charges récurrentes sont automatiquement projetées à partir de leur première échéance.</p></div>
          <Badge>{data.expenses.filter((expense) => expense.recurrence !== "one_off").length} récurrentes</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-4"><p className="text-[10px] font-bold text-violet-700 uppercase">Équivalent mensuel récurrent</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(recurring.monthlyEquivalent)}</p><p className="mt-1 text-[10px] text-zinc-500">Mensuel + annuel réparti sur 12 mois</p></div>
            <div className="rounded-xl border border-orange-100 bg-orange-50/70 p-4"><p className="text-[10px] font-bold text-orange-700 uppercase">Engagement annuel récurrent</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(recurring.annualCommitment)}</p><p className="mt-1 text-[10px] text-zinc-500">12 mensualités + échéances annuelles</p></div>
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4"><p className="text-[10px] font-bold text-sky-700 uppercase">Ponctuel · {monthLabel}</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(oneOff)}</p><p className="mt-1 text-[10px] text-zinc-500">Compté uniquement sur le mois choisi</p></div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4"><p className="text-[10px] font-bold text-emerald-700 uppercase">TVA récupérable · {monthLabel}</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(recoverableVat)}</p><p className="mt-1 text-[10px] text-zinc-500">Calculée sur toutes les échéances du mois</p></div>
          </div>
          <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">Le total prévu inclut toujours les échéances. L’option « prélèvement automatique » détermine seulement si elles sont aussi déduites automatiquement de la trésorerie à leur date.</p>
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
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Début / date", "Fréquence", "Famille", "Catégorie", "Fournisseur", "Description", "TTC / échéance", "TVA", "Paiement", "Actions"].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5 last:pr-5">{head}</th>)}</tr></thead>
              <tbody className="divide-y divide-zinc-100">
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
                    <td className="px-4 py-4 pr-5"><div className="flex items-center gap-1"><Button size="sm" variant="secondary" onClick={() => setEditingExpense(expense)}><Pencil className="size-3.5" /> Modifier</Button><Button size="sm" variant="ghost" className="text-red-600" aria-label={`Supprimer ${expense.description}`} onClick={() => setDeletingExpense(expense)}><Trash2 className="size-3.5" /></Button></div></td>
                  </tr>
                ))}
                {visibleExpenses.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-zinc-500">Aucune charge ne correspond à ce filtre.</td></tr>}
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
                  <div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-zinc-600">Prix TTC</p><p className="mt-1 text-sm font-bold">{formatMoney(asset.priceIncludingTax)}</p></div><div><p className="text-[10px] text-zinc-600">Gain temps</p><p className="mt-1 text-sm font-bold">{asset.expectedTimeGainMinutes} min</p></div><div><p className="text-[10px] text-zinc-600">ROI estimé</p><p className="mt-1 text-sm font-bold text-emerald-700">{payback ? `${payback.toFixed(1)} mois` : "À compléter"}</p></div></div>
                  <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3"><p className="flex items-center gap-2 text-xs font-semibold text-sky-800"><Landmark className="size-3.5 text-sky-600" /> Hypothèses du ROI</p><p className="mt-2 text-[11px] leading-5 text-zinc-600">Revenu mensuel additionnel {formatMoney(asset.expectedMonthlyRevenue)} + valeur de 4 gains de temps mensuels {formatMoney(monthlyTimeValue)}, au taux cible de {formatMoney(data.settings.hourlyMarginTarget)}/h.</p></div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
