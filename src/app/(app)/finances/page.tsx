"use client";

import { Banknote, CalendarClock, CircleDollarSign, Landmark, PackageSearch, Pencil, Plus, ReceiptText, Repeat2, Save, ShieldCheck, Trash2, TriangleAlert, WalletCards } from "lucide-react";
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
  paidExpenseAmountForMonth,
  projectedExpenseAmountForMonth,
  projectedExpensesForMonth,
  recurringExpenseMetrics,
  unpaidAmount,
} from "@/lib/domain/calculations";
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
        {recurrence === "monthly" ? "Cette charge sera recalculée tous les mois à partir de cette date." : recurrence === "annual" ? "Cette charge sera recalculée chaque année au mois de cette échéance." : "Cette charge ne sera comptée qu’une seule fois."}
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
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Début / date", "Fréquence", "Famille", "Catégorie", "Fournisseur", "Description", "TTC / échéance", "TVA", "Paiement", "Actions"].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5 last:pr-5">{head}</th>)}</tr></thead>
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
