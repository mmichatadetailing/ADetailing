import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qontoContext } from "./qonto-context";
type Row = Record<string, unknown>;
function database(rows: Record<string, Row[]>) {
  return { from: (table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query, range: async (from: number, to: number) => ({ data: (rows[table] ?? []).slice(from, to + 1), error: null }) };
    return query;
  } } as unknown as SupabaseClient;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
it("retrouve la cible commune des mouvements groupés et ne la propose plus au rapprochement", async () => {
  const result = await qontoContext(database({
    payments: [{ id: "payment", intervention_id: "job", amount_cents: 11000, paid_at: "2026-09-15" }],
    bank_reconciliation_groups: [{ id: "group", payment_id: "payment", note: "Deux virements" }],
    bank_transactions: [{ id: "a", reconciliation_group_id: "group" }, { id: "b", reconciliation_group_id: "group" }],
  }), "org");
  expect(result.candidates.some((candidate) => candidate.id === "payment")).toBe(false);
  expect(result.transactions[0]).toMatchObject({ payment_id: "payment", reconciliation_group_id: "group", group_size: 2, group_note: "Deux virements" });
});
it("distingue les charges déjà payées des charges non payées pour le regroupement historique", async () => {
  const result = await qontoContext(database({
    expenses: [{ id: "paid", expense_date: "2026-09-15", paid: true, paid_at: "2026-09-17", recurrence: "one_off", amount_including_tax_cents: 11000 }, { id: "unpaid", expense_date: "2026-09-15", paid: false, recurrence: "one_off", amount_including_tax_cents: 11000 }],
    bank_transactions: [{ id: "a", side: "debit", reconciliation: "unmatched", settled_at: "2026-09-15T12:00:00Z" }],
  }), "org");
  expect(result.candidates.find((candidate) => candidate.id === "paid")).toMatchObject({ historicalEligible: true, date: "2026-09-17" });
  expect(result.candidates.find((candidate) => candidate.id === "unpaid")).toMatchObject({ historicalEligible: false });
});
