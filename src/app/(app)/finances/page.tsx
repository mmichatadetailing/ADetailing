"use client";

import { AlertCircle, Banknote, CalendarClock, CircleDollarSign, Landmark, PackageSearch, Pencil, Plus, ReceiptText, Repeat2, Save, ShieldCheck, Trash2, TriangleAlert, WalletCards } from "lucide-react";
import { Suspense, useState, type FormEvent } from "react";
import { FinanceState } from "@/components/banking/finance-state";
import { useFinanceAnchor } from "@/components/banking/use-finance-anchor";
import { expenseAccess, expenseFamilyLabels as familyLabels, isEstimatedDebit, occurrenceState, registerState } from "@/lib/domain/finance-presentation";
import { expensePaymentMethods, manualExpensePayment } from "@/lib/domain/expense-ledger";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { BankResultCard } from "@/components/banking/bank-result-card";
import { useWorkspace } from "@/components/workspace-provider";
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
  nextExpenseOccurrenceDateKey,
  recurringExpenseMetrics,
} from "@/lib/domain/calculations";
import { getInterventionWorkflow } from "@/lib/domain/intervention-workflow";
import { dueMaintenanceAmount } from "@/lib/domain/maintenance";
import { financialDateKey, monthKey } from "@/lib/domain/periods";
import type { Expense } from "@/lib/domain/types";
import { useDemoStore, type NewExpenseInput } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

const recurrenceLabels: Record<Expense["recurrence"], string> = {
  one_off: "Ponctuelle",
  monthly: "Mensuelle",
  annual: "Annuelle",
};

function formatMonth(month: string, style: "long" | "short" = "long") {
  const label = new Intl.DateTimeFormat("fr-FR", { month: style, year: "numeric" }).format(new Date(`${month}-01T12:00:00`));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function previousDateKey(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function vatRateForExpense(expense: Expense) {
  if (expense.amountExcludingTax <= 0) return 0;
  return Math.round(expense.vatAmount / expense.amountExcludingTax * 1_000) / 10;
}

function ExpenseEditor({ expense, onCancel, onSave }: { expense: Expense; onCancel: () => void; onSave: (input: NewExpenseInput) => void }) {
  const isRecurringRevision = expense.recurrence !== "one_off";
  const [date, setDate] = useState(() => isRecurringRevision
    ? nextExpenseOccurrenceDateKey(expense) ?? expense.date.slice(0, 10)
    : expense.date.slice(0, 10));
  const [recurrence, setRecurrence] = useState<Expense["recurrence"]>(expense.recurrence);
  const [family, setFamily] = useState<Expense["family"]>(expense.family);
  const [category, setCategory] = useState(expense.category);
  const [supplier, setSupplier] = useState(expense.supplier);
  const [description, setDescription] = useState(expense.description);
  const [amountEuros, setAmountEuros] = useState(expense.amountIncludingTax / 100);
  const [vatRate, setVatRate] = useState(vatRateForExpense(expense));
  const [paid, setPaid] = useState(expense.paid);
  const [paymentMethod, setPaymentMethod] = useState(isRecurringRevision ? "" : expense.paymentMethod ?? "");
  const [paidOn, setPaidOn] = useState(!isRecurringRevision && expense.paidAt ? financialDateKey(expense.paidAt) : "");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!date) return toast.error("Indiquez une date.");
    if (isRecurringRevision && date < expense.date.slice(0, 10)) return toast.error("La nouvelle date ne peut pas précéder la première échéance actuelle.");
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
      paymentMethod: paid && recurrence === "one_off" ? paymentMethod || null : null,
      paidOn: paid && recurrence === "one_off" ? paidOn || date : undefined,
    });
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fréquence"><Select autoFocus value={recurrence} onChange={(event) => setRecurrence(event.target.value as Expense["recurrence"])}><option value="one_off">Ponctuelle</option><option value="monthly">Tous les mois</option><option value="annual">Tous les ans</option></Select></Field>
        <Field label={isRecurringRevision ? "Date de début du nouveau montant" : recurrence === "one_off" ? "Date de la dépense" : "Première échéance"} hint={isRecurringRevision ? "Choisissez librement le jour exact d’application." : undefined}><Input type="date" min={isRecurringRevision ? expense.date.slice(0, 10) : undefined} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800">
        {isRecurringRevision
          ? date ? `L’ancien montant de ${formatMoney(expense.amountIncludingTax)} restera valable jusqu’au ${formatDate(previousDateKey(date))}. Le nouveau montant commencera exactement le ${formatDate(date)}.` : "Choisissez la date exacte à laquelle le nouveau montant doit commencer."
          : recurrence === "monthly" ? "Cette charge sera ajoutée automatiquement au total de chaque mois à cette date." : recurrence === "annual" ? "Cette charge sera ajoutée automatiquement au total du mois de cette échéance, chaque année." : "Cette charge ne sera comptée qu’une seule fois."}
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
      <label className="flex items-center gap-3 rounded-xl border border-line bg-zinc-50 p-3 text-sm font-semibold text-zinc-700"><input type="checkbox" className="accent-brand-500" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> {recurrence === "one_off" ? "Dépense déjà payée" : "Estimer un prélèvement à chaque échéance"}</label>
      {paid && recurrence === "one_off" && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Moyen de paiement"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Non précisé</option>{Array.from(new Set([...expensePaymentMethods, ...(expense.paymentMethod && !isRecurringRevision ? [expense.paymentMethod] : [])])).map((method) => <option key={method}>{method}</option>)}</Select></Field>
        <Field label="Date du règlement"><Input required type="date" value={paidOn || date} onChange={(event) => setPaidOn(event.target.value)} /></Field>
      </div>}
      {recurrence !== "one_off" && <p className="-mt-2 text-[11px] leading-5 text-zinc-500">La charge reste dans le prévisionnel. Cette estimation ne devient pas un règlement confirmé à la date prévue.</p>}
      <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button type="submit"><Save className="size-4" /> {isRecurringRevision ? "Appliquer à partir de cette date" : "Enregistrer les modifications"}</Button></div>
    </form>
  );
}

export default function FinancesPage() {
  return <Suspense fallback={<p role="status" className="p-5 text-sm">Chargement des finances…</p>}><FinancePeriod /></Suspense>;
}

function FinancePeriod() {
  const params = useSearchParams();
  const requested = params.get("mois");
  const register = params.get("registre") === "charges";
  const month = requested && /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) ? requested : monthKey(new Date());
  return <FinancesContent key={month + ":" + register} initialMonth={month} initialRegister={register} />;
}

function FinancesContent({ initialMonth, initialRegister }: { initialMonth: string; initialRegister: boolean }) {
  const data = useDemoStore();
  const { mode, workspace } = useWorkspace();
  const canManage = mode === "demo" || Boolean(workspace?.canManageBusiness);
  const [view, setView] = useState<"month" | "forecast" | "register">(initialRegister ? "register" : "month");
  const [tab, setTab] = useState<"expenses" | "assets">("expenses");
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [recurrenceFilter, setRecurrenceFilter] = useState<"all" | Expense["recurrence"]>("all");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);

  const monthLabel = formatMonth(selectedMonth);
  const monthSummary = expenseMonthSummary(data.expenses, selectedMonth);
  const selectedExpenses = monthSummary.occurrences.map((occurrence) => occurrence.expense);
  const splitLegs = selectedExpenses.flatMap((expense) => (expense.settlements ?? []).filter((s) => s.month === selectedMonth && s.splitLeg));
  const splitTotal = splitLegs.reduce((sum, s) => sum + s.amount, 0);
  const splitDelta = splitLegs.reduce((sum, s) => sum + (s.cashDelta ?? 0), 0);
  const projectedExpenses = monthSummary.total;
  const estimatedDebits = monthSummary.occurrences.reduce((sum, entry) => sum + (isEstimatedDebit(entry) ? entry.amount : 0), 0);
  const confirmedDues = monthSummary.paid - estimatedDebits;
  const collected = collectedRevenue(data.payments.filter((payment) => financialDateKey(payment.paidAt).slice(0, 7) === selectedMonth));
  const cash = cashBalance(data.settings.initialCash, data.payments, data.expenses);
  const toCollect = data.interventions
    .filter((intervention) => intervention.status === "completed")
    .reduce((sum, intervention) => {
      const invoice = data.invoices.find((item) => item.id === intervention.invoiceId);
      return sum + getInterventionWorkflow(intervention, invoice, data.payments).outstanding;
    }, 0) + dueMaintenanceAmount(data.maintenanceBillingPeriods);
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
  const linkedExpense = useFinanceAnchor("charge-", visibleExpenses, view === "register" && tab === "expenses");

  const openExpenseForm = () => window.dispatchEvent(new CustomEvent("adetailing:open-add", { detail: "expense" }));
  const saveExpense = (expense: Expense, input: NewExpenseInput) => {
    if (!canManage || !expenseAccess(expense).edit) return;
    data.updateExpense(expense.id, input);
    setEditingExpense(null);
    toast.success(expense.recurrence === "one_off" ? "Charge modifiée" : "Nouveau tarif enregistré", { description: expense.recurrence === "one_off" ? "Les statistiques et projections ont été recalculées." : "Les mois précédents conservent leur ancien montant." });
  };
  const deleteExpense = () => {
    if (!canManage || !deletingExpense || !expenseAccess(deletingExpense).remove) return;
    data.removeExpense(deletingExpense.id);
    setDeletingExpense(null);
    toast.success("Charge supprimée");
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Trésorerie & charges"
        title="Finances"
        description="Les charges réglées proviennent du registre, espèces comprises. Comparez leur part bancaire avec Qonto ou consultez les dépenses à venir."
        actions={<label className="grid gap-1 text-sm font-semibold"><span>Mois analysé</span>
          <Input className="w-[170px]" type="month" min="2000-01" max="2099-12" value={selectedMonth} onChange={(event) => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) setSelectedMonth(event.target.value); }} /></label>}
      />


      <Modal open={Boolean(editingExpense)} onClose={() => setEditingExpense(null)} title={editingExpense?.recurrence === "one_off" ? "Modifier la charge" : "Modifier le montant de l’abonnement"} description={editingExpense ? `${recurrenceLabels[editingExpense.recurrence]} · ${editingExpense.description}` : undefined}>
        {editingExpense && <ExpenseEditor key={editingExpense.id} expense={editingExpense} onCancel={() => setEditingExpense(null)} onSave={(input) => saveExpense(editingExpense, input)} />}
      </Modal>

      <Modal open={Boolean(deletingExpense)} onClose={() => setDeletingExpense(null)} title="Supprimer cette charge ?" description={deletingExpense?.description}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-red-700"><TriangleAlert className="size-4" /> Cette charge disparaîtra de vos calculs</p>
          <p className="mt-2 text-xs leading-5 text-red-600">{deletingExpense?.recurrence === "one_off" ? "Le décaissement ponctuel ne sera plus comptabilisé dans la trésorerie ni dans les statistiques." : "Les projections de la version actuelle seront retirées. Les anciens tarifs déjà historisés resteront conservés."}</p>
        </div>
        {deletingExpense && <div className="mt-4 grid gap-2 rounded-xl border border-line bg-zinc-50 p-4 text-xs text-zinc-600"><p><strong className="text-zinc-900">{deletingExpense.description}</strong> · {formatMoney(deletingExpense.amountIncludingTax)}</p><p>{recurrenceLabels[deletingExpense.recurrence]} · première date le {formatDate(deletingExpense.date)}</p></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeletingExpense(null)}>Annuler</Button><Button variant="danger" onClick={deleteExpense}><Trash2 className="size-4" /> Supprimer définitivement</Button></div>
      </Modal>

      {canManage && <BankResultCard period={selectedMonth} label={monthLabel} />}
      <nav aria-label="Vues des finances" className="finance-nav" data-tone="teal">
        {([{id:"month", label:"Échéances du mois", icon:CalendarClock}, {id:"forecast", label:"Prévisions", icon:Banknote}, {id:"register", label:"Charges et matériel", icon:ReceiptText}] as const).map(({id,label,icon:Icon}) =>
          <button key={id} className="focus-ring" type="button" aria-pressed={view === id} onClick={() => setView(id)}><Icon className="size-4" />{label}</button>)}
      </nav>
      {view === "month" && <>
      <section aria-label="Répartition des échéances du mois" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {label:"Total des échéances", value:projectedExpenses, detail:"Charges ponctuelles et récurrentes", tone:"blue"},
          {label:"Échéances réglées", value:confirmedDues, detail:"Un règlement est enregistré pour ces échéances", tone:"emerald"},
          {label:"Prélèvements estimés", value:estimatedDebits, detail:"Date passée, sans débit confirmé", tone:"amber"},
          {label:"Autres échéances", value:remainingExpenses, detail:formatMoney(monthSummary.due) + " échu · " + formatMoney(monthSummary.upcoming) + " à venir", tone:"violet"},
        ].map((item) => <dl key={item.label} data-tone={item.tone} className="finance-metric"><dt>{item.label}</dt><dd>{formatMoney(item.value)}</dd><div className="mt-1 text-xs text-zinc-600">{item.detail}</div></dl>)}
      </section>

      {splitLegs.length > 0 && <aside aria-label="Virements groupés du mois" className="rounded-xl border border-line bg-surface p-4 text-sm">
        <h3 className="font-bold">Virements groupés du mois</h3><p className="mt-1">{formatMoney(splitTotal + splitDelta)} sortis de Qonto pour {formatMoney(splitTotal)} d’échéances réglées.</p>
        {splitDelta !== 0 && <p className="mt-1 text-xs text-zinc-600">Écart de trésorerie : {formatMoney(splitDelta)}. Les tarifs des charges restent inchangés.</p>}
      </aside>}
      {monthSummary.due > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div><p className="text-sm font-bold">{formatMoney(monthSummary.due)} arrivé à échéance</p><p className="mt-1 text-xs text-amber-800">Ces charges sont bien incluses dans le total de {monthLabel}, mais aucun règlement n’est encore enregistré. Un débit Qonto correspondant sera rattaché automatiquement.</p></div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><CalendarClock className="size-4 text-orange-600" /> Échéances de {monthLabel}</h2><p className="mt-1 text-xs text-zinc-500">Le total additionne automatiquement les charges mensuelles, les annuelles dues ce mois-ci et les dépenses ponctuelles.</p></div>
          <Badge variant="orange">{monthSummary.occurrences.length} échéance(s) · {formatMoney(projectedExpenses)}</Badge>
        </CardHeader>
        <CardContent className="grid gap-2">
          {monthSummary.occurrences.map((occurrence) => (
            <div key={occurrence.expense.id} className="grid gap-3 rounded-2xl border border-line bg-zinc-50/80 p-4 transition hover:border-orange-200 hover:bg-orange-50/60 lg:grid-cols-[7rem_minmax(0,1fr)_auto_auto] lg:items-center">
              <div><p className="text-xs font-bold text-zinc-900">{formatDate(occurrence.dueDate, { day: "2-digit", month: "long" })}</p><p className="mt-1 text-[10px] text-zinc-500">{recurrenceLabels[occurrence.expense.recurrence]}</p></div>
              <div className="min-w-0"><p className="truncate text-sm font-bold text-zinc-900">{occurrence.expense.description}</p><p className="mt-1 truncate text-xs text-zinc-500">{occurrence.expense.category}{occurrence.expense.supplier ? ` · ${occurrence.expense.supplier}` : ""}</p></div>
              <div className="flex items-center gap-2 sm:justify-end"><FinanceState {...occurrenceState(occurrence)} /><p className="min-w-20 text-right text-sm font-extrabold text-zinc-900">{formatMoney(occurrence.amount)}</p></div>
              {canManage && expenseAccess(occurrence.expense).edit ? <Button size="sm" variant="secondary" onClick={() => setEditingExpense(occurrence.expense)}><Pencil className="size-3.5" /> {occurrence.expense.recurrence === "one_off" ? "Modifier" : "Modifier le tarif"}</Button> : null}
            </div>
          ))}
          {monthSummary.occurrences.length === 0 && <div className="rounded-2xl border border-dashed border-line bg-zinc-50 p-8 text-center"><ReceiptText className="mx-auto size-6 text-zinc-400" /><p className="mt-2 text-sm font-bold text-zinc-700">Aucune charge prévue</p><p className="mt-1 text-xs text-zinc-500">Aucune échéance enregistrée pour ce mois. Les charges synchronisées apparaîtront après leur import.</p></div>}
        </CardContent>
      </Card>

      </>}
      {view === "forecast" && <>
      <section aria-label="Repères de prévision" className="grid gap-3 sm:grid-cols-2">
        <dl data-tone="amber" className="finance-metric"><dt><WalletCards className="size-4" />Solde prévisionnel · {monthLabel}</dt><dd>{formatMoney(collected - projectedExpenses)}</dd><p>Encaissements enregistrés moins toutes les charges prévues du mois.</p></dl>
        <dl data-tone="violet" className="finance-metric"><dt><Landmark className="size-4" />Trésorerie estimée aujourd’hui</dt><dd>{formatMoney(cash)}</dd><p>Inclut les prélèvements estimés. Hors solde : {formatMoney(toCollect)} restant à encaisser.</p></dl>
      </section>
      {cash < data.settings.cashSafetyBuffer && <p data-tone="amber" className="finance-metric flex items-center gap-2 text-sm"><ShieldCheck className="size-5 shrink-0" />L’estimation actuelle est sous le seuil de sécurité de {formatMoney(data.settings.cashSafetyBuffer)}.</p>}
      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><Banknote className="size-4 text-violet-600" /> Prévision des 12 prochains mois</h2><p className="mt-1 text-xs text-zinc-500">Projection glissante à partir de {monthLabel}, recalculée dès qu’une charge est ajoutée ou modifiée.</p></div>
          <div className="text-right"><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Total prévu</p><p className="mt-1 text-lg font-extrabold text-zinc-900">{formatMoney(forecastTotal)}</p></div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {forecast.map((month) => (
              <button key={month.month} type="button" aria-label={`Voir les échéances de ${formatMonth(month.month)}`} onClick={() => { setSelectedMonth(month.month); setView("month"); }} className={`focus-ring rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md ${month.month === selectedMonth ? "border-orange-300 bg-orange-50 shadow-sm" : "border-line bg-surface"}`}>
                <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold capitalize text-zinc-600">{formatMonth(month.month, "short")}</p>{month.annual > 0 && <Badge variant="blue">annuelle</Badge>}</div>
                <p className="mt-3 text-lg font-extrabold text-zinc-900">{formatMoney(month.total)}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(month.total > 0 ? 8 : 0, Math.round(month.total / forecastMaximum * 100))}%` }} /></div>
                <p className="mt-2 text-[10px] leading-4 text-zinc-500">{formatMoney(month.monthly)} mensuel{month.annual > 0 ? ` · ${formatMoney(month.annual)} annuel` : ""}{month.oneOff > 0 ? ` · ${formatMoney(month.oneOff)} ponctuel` : ""}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div><h2 className="flex items-center gap-2 font-bold"><Repeat2 className="size-4 text-violet-600" /> Structure des charges</h2><p className="mt-1 text-xs text-zinc-500">Les charges récurrentes sont automatiquement projetées à partir de leur première échéance.</p></div>
          <Badge>{new Set(data.expenses.filter((expense) => expense.recurrence !== "one_off" && !expense.endsAt).map((expense) => expense.seriesId ?? expense.id)).size} récurrentes</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-4"><p className="text-[10px] font-bold text-violet-700 uppercase">Équivalent mensuel récurrent</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(recurring.monthlyEquivalent)}</p><p className="mt-1 text-[10px] text-zinc-500">Mensuel + annuel réparti sur 12 mois</p></div>
            <div className="rounded-xl border border-orange-100 bg-orange-50/70 p-4"><p className="text-[10px] font-bold text-orange-700 uppercase">Engagement annuel récurrent</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(recurring.annualCommitment)}</p><p className="mt-1 text-[10px] text-zinc-500">12 mensualités + échéances annuelles</p></div>
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4"><p className="text-[10px] font-bold text-sky-700 uppercase">Ponctuel · {monthLabel}</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(oneOff)}</p><p className="mt-1 text-[10px] text-zinc-500">Compté uniquement sur le mois choisi</p></div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4"><p className="text-[10px] font-bold text-emerald-700 uppercase">TVA récupérable · {monthLabel}</p><p className="mt-2 text-xl font-bold text-zinc-900">{formatMoney(recoverableVat)}</p><p className="mt-1 text-[10px] text-zinc-500">Calculée sur toutes les échéances du mois</p></div>
          </div>
          <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">Le total prévu inclut toujours les échéances. L’option d’estimation déduit le prélèvement de la trésorerie estimée à sa date, sans l’enregistrer comme un paiement réel.</p>
        </CardContent>
      </Card>

      </>}
      {view === "register" && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="finance-nav" data-tone="blue" role="group" aria-label="Type de registre">
        <Button aria-pressed={tab === "expenses"} variant={tab === "expenses" ? "secondary" : "ghost"} onClick={() => setTab("expenses")}><CircleDollarSign className="size-4" /> Charges</Button>
        <Button aria-pressed={tab === "assets"} variant={tab === "assets" ? "secondary" : "ghost"} onClick={() => setTab("assets")}><PackageSearch className="size-4" /> Investissements & matériel</Button>
        </div>
        {canManage && tab === "expenses" && <Button variant="secondary" onClick={openExpenseForm}><Plus className="size-4" />Prévoir une charge ou saisir hors banque</Button>}
      </div>

      {tab === "expenses" ? (
        <Card>
          <CardHeader className="flex-wrap gap-3">
            <div><h2 className="font-bold">Charges & dépenses</h2><p className="mt-1 text-xs text-zinc-500">Toutes les périodes. Les montants liés à Qonto sont protégés ; un nouveau tarif récurrent conserve les anciens mois.</p></div>
            <div className="flex items-center gap-2"><Select aria-label="Filtrer par fréquence" className="w-[170px]" value={recurrenceFilter} onChange={(event) => setRecurrenceFilter(event.target.value as typeof recurrenceFilter)}><option value="all">Toutes les fréquences</option><option value="one_off">Ponctuelles</option><option value="monthly">Mensuelles</option><option value="annual">Annuelles</option></Select><Badge>{visibleExpenses.length} charge(s)</Badge></div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line" aria-label="Registre des charges">{visibleExpenses.map((expense) => {
              const access = expenseAccess(expense);
              const settled = expense.settlements?.find((p) => expense.recurrence === "one_off" || p.month === selectedMonth);
              const manual = manualExpensePayment(expense);
              const paidDay = manual?.day ?? settled?.paidAt;
              return <li id={`charge-${expense.id}`} key={expense.id} tabIndex={-1} data-linked={linkedExpense === expense.id} className="finance-target grid min-w-0 gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)_auto] lg:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-bold">{expense.description}</h3>{expense.endsAt && <FinanceState label="Historique" tone="neutral" />}</div>
                  <p className="mt-1 break-words text-sm text-zinc-600">{[expense.supplier, expense.category, familyLabels[expense.family]].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 text-xs text-zinc-500">{recurrenceLabels[expense.recurrence]} · {formatDate(expense.date)}{expense.endsAt && " – " + formatDate(expense.endsAt)}</p></div>
                <div><p className="font-bold tabular-nums">{formatMoney(manual?.amount ?? settled?.amount ?? expense.amountIncludingTax)} <span className="text-xs font-normal text-zinc-500">TTC · TVA {formatMoney(expense.vatAmount)}</span></p>
                  <div className="mt-1 flex flex-wrap items-center gap-2"><FinanceState {...registerState(expense, selectedMonth)} />{paidDay && <span className="text-xs text-zinc-500">{formatDate(paidDay)}</span>}</div></div>
                {canManage && access.edit && <div className="flex flex-wrap gap-1"><Button size="sm" variant="secondary" onClick={() => setEditingExpense(expense)}><Pencil className="size-3.5" />{expense.recurrence === "one_off" ? "Modifier" : "Modifier le tarif"}</Button>{access.remove && <Button size="sm" variant="ghost" aria-label={`Supprimer ${expense.description}`} onClick={() => setDeletingExpense(expense)}><Trash2 className="size-4 text-red-600" /></Button>}</div>}
              </li>;
            })}</ul>
            {!visibleExpenses.length && <p className="p-5 text-center text-sm text-zinc-500">Aucune charge ne correspond à ce filtre.</p>}
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {!data.assets.length && <p className="rounded-xl border border-dashed border-line p-6 text-sm text-zinc-500">Aucun investissement enregistré.</p>}
          {data.assets.map((asset) => {
            const monthlyTimeValue = Math.round(asset.expectedTimeGainMinutes / 60 * data.settings.hourlyMarginTarget * 4);
            const monthlyBenefit = asset.expectedMonthlyRevenue + monthlyTimeValue;
            const payback = monthlyBenefit > 0 ? asset.priceIncludingTax / monthlyBenefit : null;
            return (
              <Card key={asset.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{asset.name}</p><p className="mt-1 text-xs text-zinc-600">{asset.category} · {asset.supplier || "Fournisseur à définir"}</p></div><Badge variant={asset.status === "in_service" ? "green" : "yellow"}>{{to_buy:"À acheter",ordered:"Commandé",in_service:"En service",to_replace:"À remplacer",sold:"Vendu"}[asset.status]}</Badge></div>
                  <div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-zinc-600">Prix TTC</p><p className="mt-1 text-sm font-bold">{formatMoney(asset.priceIncludingTax)}</p></div><div><p className="text-[10px] text-zinc-600">Gain temps</p><p className="mt-1 text-sm font-bold">{asset.expectedTimeGainMinutes} min</p></div><div><p className="text-[10px] text-zinc-600">ROI estimé</p><p className="mt-1 text-sm font-bold text-emerald-700">{payback ? `${payback.toFixed(1)} mois` : "À compléter"}</p></div></div>
                  <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3"><p className="flex items-center gap-2 text-xs font-semibold text-sky-800"><Landmark className="size-3.5 text-sky-600" /> Hypothèses du ROI</p><p className="mt-2 text-[11px] leading-5 text-zinc-600">Revenu mensuel additionnel {formatMoney(asset.expectedMonthlyRevenue)} + valeur de 4 gains de temps mensuels {formatMoney(monthlyTimeValue)}, au taux cible de {formatMoney(data.settings.hourlyMarginTarget)}/h.</p></div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
      </>}
    </div>
  );
}
