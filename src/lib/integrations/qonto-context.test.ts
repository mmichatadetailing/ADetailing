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
it("une prestation déjà encaissée en espèces ne fournit pas un candidat pour le crédit bancaire", async () => {
  const p={intervention_id:"job",amount_cents:11000,paid_at:"2026-06-20"};
  const result=await qontoContext(database({payments:[{...p,id:"cash",method:"Espèces"},{...p,id:"transfer",method:"Virement"}],
    interventions:[{id:"job",client_id:"client",status:"completed"}],clients:[{id:"client",last_name:"Martin"}]}),"org");
  expect(result.candidates.map(c=>[c.kind,c.id,c.clientId])).toEqual([["payment","transfer","client"]]);
});
it("retrouve la cible commune des mouvements groupés et ne la propose plus au rapprochement", async () => {
  const result = await qontoContext(database({
    payments: [{ id: "payment", intervention_id: "job", amount_cents: 11000, paid_at: "2026-09-15" }],
    bank_reconciliation_groups: [{ id: "group", payment_id: "payment", note: "Deux virements" }],
    bank_transactions: [{ id: "a", reconciliation_group_id: "group" }, { id: "b", reconciliation_group_id: "group" }],
  }), "org");
  expect(result.candidates.some((candidate) => candidate.id === "payment")).toBe(false);
  expect(result.transactions[0]).toMatchObject({ payment_id: "payment", reconciliation_group_id: "group", group_size: 2, group_note: "Deux virements" });
});
it("avant le 24 juin, une simple prévision ne devient pas une charge réglée par la reprise bancaire", async () => {
  const charge={expense_date:"2026-06-15",amount_including_tax_cents:11000,recurrence:"monthly",paid:true,supplier:"Exemple",description:"Abonnement"};
  const result=await qontoContext(database({expenses:[{...charge,id:"forecast"},{...charge,id:"registered",legacy_row:4},{...charge,id:"cash",legacy_row:5,payment_method:"Espèces"}],
    bank_transactions:[{id:"b",side:"debit",reconciliation:"unmatched",settled_at:"2026-06-15"}]}),"org");
  const june=result.candidates.filter(c=>c.month==="2026-06");
  expect(june.find(c=>c.id==="forecast")?.historicalEligible).toBe(false);
  expect(june.find(c=>c.id==="registered")?.historicalEligible).toBe(true);
  expect(june.some(c=>c.id==="cash")).toBe(false);
});
it("distingue les charges déjà payées des charges non payées pour le regroupement historique", async () => {
  const result = await qontoContext(database({
    expenses: [{ id: "paid", expense_date: "2026-09-15", paid: true, paid_at: "2026-09-17", recurrence: "one_off", amount_including_tax_cents: 11000 }, { id: "unpaid", expense_date: "2026-09-15", paid: false, recurrence: "one_off", amount_including_tax_cents: 11000 }],
    bank_transactions: [{ id: "a", side: "debit", reconciliation: "unmatched", settled_at: "2026-09-15T12:00:00Z" }],
  }), "org");
  expect(result.candidates.find((candidate) => candidate.id === "paid")).toMatchObject({ historicalEligible: true, date: "2026-09-17" });
  expect(result.candidates.find((candidate) => candidate.id === "unpaid")).toMatchObject({ historicalEligible: false });
});
it("ne rapproche pas une dépense en liquide même si le fournisseur, le montant et la date correspondent", async () => {
  const expense = {expense_date:"2026-09-15", paid:true, recurrence:"one_off", supplier:"Même magasin", amount_including_tax_cents:3000};
  const result = await qontoContext(database({
    expenses:[{...expense,id:"cash",payment_method:"Espèces"},{...expense,id:"unknown",payment_method:null}],
    bank_transactions:[{id:"debit",side:"debit",counterparty:"Même magasin",amount_cents:3000,reconciliation:"unmatched",settled_at:"2026-09-15T12:00:00Z"}],
  }),"org");
  expect(result.candidates.map((candidate) => candidate.id)).toEqual(["unknown"]);
});
