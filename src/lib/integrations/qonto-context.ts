import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankCandidate, BankTransaction } from "@/lib/domain/banking";
import { bankDate } from "@/lib/domain/banking";
import { projectedExpensesForMonth, expenseOccurrenceDateKey } from "@/lib/domain/calculations";
import { readAllPages } from "@/lib/supabase/pagination";
import type { BankDraft } from "@/lib/domain/bank-drafts";

type Row = Record<string, unknown>;
export async function qontoContext(db: SupabaseClient, org: string) {
  const tables = ["payments", "expenses", "clients", "interventions", "intervention_items", "invoices", "maintenance_contracts", "maintenance_billing_periods", "bank_transactions", "expense_settlements", "bank_reconciliation_groups", "bank_transaction_drafts"] as const;
  const entries = await Promise.all(tables.map(async (table) => [table, await readAllPages<Row>(async (from, to) => {
    const result = await db.from(table).select("*").eq("organization_id", org).order("id").range(from, to);
    if (result.error) throw new Error("Données bancaires indisponibles. Vérifiez que la migration Qonto est appliquée.");
    return { data: result.data as Row[], error: null };
  })] as const));
  const rows = Object.fromEntries(entries) as Record<typeof tables[number], Row[]>;
  const clients = new Map(rows.clients.map((client) => [String(client.id), [client.company, `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()].filter(Boolean).map(String)]));
  const jobs = new Map(rows.interventions.map((job) => [String(job.id), job]));
  const invoices = new Map(rows.invoices.map((inv) => [String(inv.id), inv]));
  const contracts = new Map(rows.maintenance_contracts.map((contract) => [String(contract.id), contract]));
  const targets: BankCandidate[] = [];
  const groups = new Map(rows.bank_reconciliation_groups.map((group) => [group.id, group]));
  const groupSizes = new Map<unknown, number>();
  for (const transaction of rows.bank_transactions) if (transaction.reconciliation_group_id) groupSizes.set(transaction.reconciliation_group_id, (groupSizes.get(transaction.reconciliation_group_id) ?? 0) + 1);
  const transactions = rows.bank_transactions.map((transaction) => {
    const group = groups.get(transaction.reconciliation_group_id);
    return { ...transaction, payment_id: transaction.payment_id ?? group?.payment_id ?? null, expense_id: transaction.expense_id ?? group?.expense_id ?? null, expense_month: transaction.expense_month ?? group?.expense_month ?? null,
      group_size: group ? groupSizes.get(group.id) : undefined, group_note: group ? String(group.note) : undefined };
  }) as unknown as BankTransaction[];
  const linked = new Set(transactions.filter((tx) => tx.payment_id).map((tx) => tx.payment_id));
  const clientNames = (id: unknown) => clients.get(String(id)) ?? [];
  for (const payment of rows.payments) {
    if (linked.has(String(payment.id))) continue;
    const job = jobs.get(String(payment.intervention_id));
    const invoice = invoices.get(String(payment.invoice_id));
    const contract = contracts.get(String(payment.maintenance_contract_id));
    const names = clientNames(job?.client_id ?? invoice?.client_id ?? contract?.client_id);
    targets.push({ key: `payment:${payment.id}`, kind: "payment", id: String(payment.id), label: `Paiement existant · ${names[0] ?? "Client"} · ${contract?.title ?? job?.title ?? invoice?.number ?? "Encaissement"}`, identities: [...names, String(invoice?.number ?? ""), String(payment.reference ?? "")], amount: Number(payment.amount_cents), date: String(payment.paid_at), historicalEligible: bankDate(String(payment.paid_at)) <= bankDate(new Date().toISOString()) });
  }
  const paidFor = (key: string, id: unknown) => rows.payments.filter((payment) => payment[key] === id).reduce((sum, payment) => sum + Number(payment.amount_cents), 0);
  for (const job of rows.interventions.filter((job) => !job.archived_at && job.status === "completed" && !job.maintenance_contract_id && !job.invoice_id)) {
    const amount = rows.intervention_items.filter((item) => item.intervention_id === job.id).reduce((sum, item) => sum + Number(item.revenue_allocated_cents), 0) - paidFor("intervention_id", job.id);
    if (amount > 0) targets.push({ key: `intervention:${job.id}`, kind: "intervention", id: String(job.id), label: `Encaisser la prestation · ${clientNames(job.client_id)[0] ?? ""} · ${job.title}`, identities: clientNames(job.client_id), amount, date: String(job.start_at ?? job.created_at) });
  }
  for (const invoice of rows.invoices.filter((invoice) => !invoice.archived_at && !["cancelled", "credit_note"].includes(String(invoice.status)))) {
    const linkedJobs = new Set(rows.interventions.filter((job) => job.invoice_id === invoice.id).map((job) => job.id));
    const alreadyPaid = rows.payments.filter((payment) => payment.invoice_id === invoice.id || linkedJobs.has(payment.intervention_id)).reduce((sum, payment) => sum + Number(payment.amount_cents), 0);
    const amount = Number(invoice.total_including_tax_cents) - alreadyPaid;
    if (amount > 0) targets.push({ key: `invoice:${invoice.id}`, kind: "invoice", id: String(invoice.id), label: `Encaisser la facture · ${invoice.number} · ${clientNames(invoice.client_id)[0] ?? ""}`, identities: [...clientNames(invoice.client_id), String(invoice.number)], amount, date: String(invoice.due_at ?? invoice.issued_at) });
  }
  for (const period of rows.maintenance_billing_periods.filter((period) => period.status === "due")) {
    const contract = contracts.get(String(period.contract_id));
    if (!contract || contract.archived_at) continue;
    targets.push({ key: `maintenance:${period.id}`, kind: "maintenance", id: String(period.id), label: `Encaisser l’entretien · ${clientNames(contract.client_id)[0] ?? ""} · échéance ${period.due_on}`, identities: clientNames(contract.client_id), amount: Number(period.amount_cents), date: String(period.due_on) });
  }
  const expenses = rows.expenses.filter((expense) => !expense.archived_at).map((expense) => ({
    id: String(expense.id), date: String(expense.expense_date), endsAt: expense.ends_on ? String(expense.ends_on) : undefined, seriesId: expense.series_id ? String(expense.series_id) : undefined,
    amountIncludingTax: Number(expense.amount_including_tax_cents), recurrence: String(expense.recurrence) as "monthly" | "annual" | "one_off", paid: Boolean(expense.paid),
    settlements: rows.expense_settlements.filter((entry) => entry.expense_id === expense.id).map((entry) => ({ id: String(entry.id), month: String(entry.period_month).slice(0, 7), amount: Number(entry.amount_cents), paidAt: bankDate(String(entry.paid_at)), bankTransactionId: String(entry.bank_transaction_id) })),
    supplier: String(expense.supplier ?? ""), description: String(expense.description),
  }));
  const months = new Set<string>();
  for (const expense of expenses.filter((expense) => expense.recurrence === "one_off" && expense.paid)) months.add(expense.date.slice(0, 7));
  for (const tx of transactions.filter((tx) => tx.reconciliation === "unmatched" && tx.side === "debit")) {
    const day = bankDate(tx.settled_at ?? tx.emitted_at);
    for (const delta of [-1, 0, 1]) { const date = new Date(`${day.slice(0, 7)}-15T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); months.add(date.toISOString().slice(0, 7)); }
  }
  for (const month of months) for (const expense of projectedExpensesForMonth(expenses, month)) {
    if (rows.expense_settlements.some((entry) => entry.expense_id === expense.id && String(entry.period_month).slice(0, 7) === month)) continue;
    const date = expenseOccurrenceDateKey(expense, month)!;
    const original = rows.expenses.find((entry) => entry.id === expense.id);
    const paidDate = expense.recurrence === "one_off" && original?.paid_at ? bankDate(String(original.paid_at)) : date;
    targets.push({ key: `expense:${expense.id}:${month}`, kind: "expense", id: expense.id, month, label: `Charge · ${expense.supplier || expense.description} · ${expense.description} · ${month}`, identities: [expense.supplier, expense.description], amount: expense.amountIncludingTax, date: paidDate, historicalEligible: expense.paid && paidDate <= bankDate(new Date().toISOString()) });
  }
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const drafts = rows.bank_transaction_drafts.flatMap((draft) => {
    const transaction = transactionById.get(String(draft.bank_transaction_id));
    return transaction ? [{ ...draft, transaction } as unknown as BankDraft] : [];
  });
  return { transactions, candidates: targets, drafts };
}
