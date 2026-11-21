import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ExpenseCheck } from "./bank-result-card";
import { formatMoney } from "@/lib/utils";

const charges = {total: 54286, linked: 48286, cash: 4000, unlinked: 2000};
const bank = {expenses: 49200, receipts: 0, result: -49200, customerRefunds: 0, unallocatedCredits: 0, splitCashDelta: 214,
  expenseDebits: {linked: 48500, unlinked: 1000, supplierRefunds: 300}};
it("compare les seuls montants rapprochés et explique séparément liquide, remboursements et arrondi", () => {
  const html = renderToStaticMarkup(<ExpenseCheck charges={charges} bank={bank} partial={false} />);
  expect(html).toContain("Les totaux rapprochés concordent");
  for (const amount of [48286,48500,4000,2000,1000,300,214]) expect(html).toContain(formatMoney(amount));
});
it("affiche le vrai écart, sans certifier les périodes incomplètes ni les charges sans lien", () => {
  const render = (linked: number, partial: boolean) => renderToStaticMarkup(<ExpenseCheck charges={{...charges,linked:0}} bank={{...bank,splitCashDelta:0,expenseDebits:{...bank.expenseDebits,linked}}} partial={partial} />);
  expect(render(500,false)).toContain("Écart sur les totaux rapprochés (Qonto − logiciel) : " + formatMoney(500));
  expect(render(500,true)).toContain("Contrôle indicatif");
  expect(render(0,false)).toContain("Aucun montant rapproché");
});
