import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BankJournalRow } from "./bank-journal-row";
import type { BankTransaction } from "@/lib/domain/banking";

const tx: BankTransaction = {
  id:"bank",remote_id:"qonto",account_name:"Principal",label:"Nettoyage",counterparty:"Camille",reference:"Exemple",amount_cents:4900,currency:"EUR",
  side:"credit",status:"completed",settled_at:"2026-09-16",emitted_at:"2026-09-15",operation_type:"transfer",reconciliation:"unmatched",
  created_entry:false,payment_id:null,expense_id:null,expense_month:null,ignored_reason:null,
};
it.each([
  [{side:"debit",posting_kind:"expense",reconciliation:"matched",automation_note:"Charge créée et réglée"}, "Charge créée et réglée"],
  [{posting_kind:"service",reconciliation:"matched",automation_note:"Prestation terminée"}, "Prestation terminée"],
  [{posting_kind:"bank_only",automation_note:"Homonymes"}, "Homonymes"],
  [{status:"reversed"}, "Annulée par Qonto"],
  [{reconciliation_group_id:"group"}, "Regroupement historique conservé"],
  [{}, "Historique importé"],
] as const)("explique chaque traitement sans action manuelle : %s", (patch, label) => {
  const html = renderToStaticMarkup(<BankJournalRow tx={{...tx,...patch}} postingFrom="2026-10-01" />);
  expect(html).toContain(label);
  expect(html).not.toMatch(/<button|<select|<input|À traiter|À valider/);
});
