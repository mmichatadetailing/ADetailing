import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankTransaction } from "@/lib/domain/banking";
import { readAllPages } from "@/lib/supabase/pagination";

type LinkedExpense = { family: string } | null;
type JournalRow = BankTransaction & { expense: LinkedExpense; historical: { note: string; payment_id: string | null; expense: LinkedExpense } | null };

/** Journal and reports only need the bank rows, not every client, job and invoice. */
export async function readQontoJournal(db: SupabaseClient, organizationId: string, period?: string) {
  const rows = await readAllPages<JournalRow>(async (from, to) => {
    let query = db.from("bank_transactions").select("id,remote_id,account_name,label,counterparty,reference,amount_cents,currency,side,status,settled_at,emitted_at,operation_type,reconciliation,payment_id,expense_id,expense_month,created_entry,ignored_reason,monthly_split_rule_id,split_cash_delta_cents,reconciliation_group_id,automated_at,automation_note,posting_kind,expense:expenses(family),historical:bank_reconciliation_groups(note,payment_id,expense:expenses(family))").eq("organization_id", organizationId);
    if (period) {
      // A UTC day of padding covers French midnight/DST. Exact local period
      // and settled status are checked by bankCashSummary before aggregation.
      const [year, month] = period.split("-").map(Number);
      query = query.eq("status", "completed").gte("settled_at", new Date(Date.UTC(year!, (month ?? 1) - 1, 0)).toISOString())
        .lt("settled_at", new Date(Date.UTC(year!, month ?? 12, 2)).toISOString());
    }
    const result = await query.order("id").range(from, to);
    if (result.error) throw new Error("Lecture du journal bancaire impossible. Vérifiez la migration Qonto.");
    return { data: result.data as unknown as JournalRow[], error: null };
  });
  return rows.map(({ expense, historical, ...tx }) => ({ ...tx, expense_family: expense?.family ?? historical?.expense?.family,
    payment_id: tx.payment_id ?? historical?.payment_id ?? null, group_note: historical?.note }));
}
