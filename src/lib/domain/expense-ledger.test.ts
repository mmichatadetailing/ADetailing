import { expect, it } from "vitest";
import { recordedExpenses } from "./expense-ledger";

const now = new Date("2026-11-20T12:00:00Z");
const entry = { family: "variable" as const, recurrence: "one_off" as const, date: "2026-10-12", paidAt: "2026-10-31T23:30:00Z", paid: true, amountIncludingTax: 1200 };
it("distingue les espèces déclarées et les charges non pointées, sans les inventer ni changer le mois du règlement", () => {
  const expenses = [{...entry, paymentMethod:"en liquide"}, entry, {...entry,paymentMethod:"Carte"},
    {...entry,paid:false}, {...entry,paidAt:"2026-11-21"}, {...entry,family:"personal" as const},
    {...entry,recurrence:"monthly" as const,paymentMethod:"Espèces"}];
  expect(recordedExpenses(expenses,"2026-10",now).total).toBe(0);
  expect(recordedExpenses(expenses,"2026-11",now)).toEqual({total:3600,cash:1200,linked:0,unlinked:2400});
  expect(recordedExpenses(expenses,"2026",now)).toEqual(recordedExpenses(expenses,"2026-11",now));
});
it("ne cumule pas le statut payé et son règlement rapproché, et garde la date réelle même pour une autre échéance", () => {
  const expenses = [{...entry,settlements:[{id:"s",bankTransactionId:"tx",amount:1350,paidAt:"2026-10-30",month:"2026-10"}]}];
  expect(recordedExpenses(expenses,"2026-11",now)).toEqual({total:1200,cash:0,linked:1200,unlinked:0});
  expect(recordedExpenses(expenses,"2026-10",now).total).toBe(0);
  expect(recordedExpenses([{...expenses[0]!,paymentMethod:"Espèces"}],"2026-11",now)).toEqual({total:1200,cash:1200,linked:0,unlinked:0,cashWithBankLink:1200});
});
