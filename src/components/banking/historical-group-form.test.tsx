import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HistoricalGroupForm } from "./historical-group-form";
import type { BankCandidate, BankTransaction } from "@/lib/domain/banking";

it("présente le détail, le total et une confirmation explicite sans présélectionner la cible", () => {
  const base: BankTransaction = { id: "first", remote_id: "remote", account_name: "Principal", label: "Achat", counterparty: "Fournisseur", reference: "", amount_cents: 4000, currency: "EUR", side: "debit", status: "completed", settled_at: "2025-09-15T12:00:00Z", emitted_at: "2025-09-15T12:00:00Z", operation_type: "card", reconciliation: "unmatched", payment_id: null, expense_id: null, expense_month: null, created_entry: false, ignored_reason: null };
  const candidate: BankCandidate = { key: "expense:existing", kind: "expense", id: "existing", month: "2025-09", date: "2025-09-15", amount: 11000, label: "Charge historique", identities: [], historicalEligible: true };
  const html = renderToStaticMarkup(<HistoricalGroupForm transactions={[base, { ...base, id: "second", amount_cents: 7000 }]} candidates={[candidate]} onDone={async () => {}} onCancel={() => {}} />);
  expect(html).toContain("Charge historique");
  expect(html).toContain("110");
  expect(html).toContain('<option value="" selected="">');
  expect(html).toContain('<option value="expense:existing">');
  expect(html).toContain("Je confirme");
  expect(html).toContain("disabled=\"\"");
  expect(html).not.toContain("Créer une nouvelle charge");
});
