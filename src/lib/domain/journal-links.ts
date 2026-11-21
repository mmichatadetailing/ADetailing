import type { BankTransaction } from "./banking";
import type { Expense, Intervention, MaintenanceBillingPeriod, MaintenanceContract, Payment } from "./types";

export type JournalLink = { href: string; label: string };
type Ledger = {
  expenses: Pick<Expense,"id" | "date">[];
  interventions: Pick<Intervention,"id" | "invoiceId">[];
  payments: Pick<Payment,"id" | "interventionId" | "invoiceId" | "maintenanceBillingPeriodId">[];
  maintenanceContracts: Pick<MaintenanceContract,"id" | "archivedAt">[];
  maintenanceBillingPeriods: Pick<MaintenanceBillingPeriod,"id" | "contractId">[];
};

/** Links are built exclusively from records already visible in this workspace, never from a bank label. */
export function journalLinks(ledger: Ledger) {
  const expenses = new Map(ledger.expenses.map((x) => [x.id, x]));
  const jobs = new Set(ledger.interventions.map((x) => x.id));
  const byInvoice = new Map(ledger.interventions.flatMap((x) => x.invoiceId ? [[x.invoiceId, x.id] as const] : []));
  const contracts = new Set(ledger.maintenanceContracts.filter((c) => !c.archivedAt).map((c) => c.id));
  const periods = new Set(ledger.maintenanceBillingPeriods.filter((p) => contracts.has(p.contractId)).map((p) => p.id));
  const payments = new Map(ledger.payments.map((p) => [p.id, p]));
  return (tx: Pick<BankTransaction,"status" | "reconciliation" | "expense_id" | "expense_month" | "payment_id" | "monthly_split_rule_id">): JournalLink | undefined => {
    if (tx.status !== "completed" || tx.reconciliation !== "matched") return;
    if (tx.monthly_split_rule_id && tx.expense_month) return {href:"/finances?mois=" + encodeURIComponent(tx.expense_month.slice(0,7)), label:"Voir les échéances du mois"};
    const expense = tx.expense_id && expenses.get(tx.expense_id);
    if (expense) {
      const month = (tx.expense_month || expense.date).slice(0, 7);
      return {href: "/finances?registre=charges&mois=" + encodeURIComponent(month) + "#charge-" + encodeURIComponent(expense.id), label:"Voir la charge"};
    }
    const payment = tx.payment_id && payments.get(tx.payment_id);
    if (!payment) return;
    if (payment.maintenanceBillingPeriodId && periods.has(payment.maintenanceBillingPeriodId))
      return {href:"/entretiens#echeance-" + encodeURIComponent(payment.maintenanceBillingPeriodId), label:"Voir l’échéance du contrat"};
    const job = payment.interventionId ?? (payment.invoiceId && byInvoice.get(payment.invoiceId));
    if (job && jobs.has(job)) return {href:"/prestations?intervention=" + encodeURIComponent(job), label:"Voir la prestation"};
  };
}
