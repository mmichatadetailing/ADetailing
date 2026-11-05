import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { BankDraftEditor } from "./bank-draft-inbox";
import type { BankDraft } from "@/lib/domain/bank-drafts";

const draft: BankDraft = {
  id: "draft", side: "credit", status: "pending", created_at: "2025-09-16", updated_at: "2025-09-16",
  payload: { title: "Prestation à vérifier", completed: true, performedOn: "2025-09-16", revenue: 11000, durationMinutes: 0, notes: "", expenseDate: "2025-09-16", supplier: "Fournisseur", category: "", family: "variable", vatRateBasisPoints: 0, vatRecoverable: false },
  transaction: { id: "bank", remote_id: "remote", account_name: "Compte", label: "Prestation", counterparty: "Client", reference: "", amount_cents: 11000, currency: "EUR", side: "credit", status: "completed", settled_at: "2025-09-16T12:00:00Z", emitted_at: "2025-09-16T12:00:00Z", operation_type: "transfer", reconciliation: "unmatched", payment_id: null, expense_id: null, expense_month: null, created_entry: false, ignored_reason: null },
};
it("présente la prestation modifiable avec une confirmation avant toute création", () => {
  const html = renderToStaticMarkup(<BankDraftEditor draft={draft} candidates={[]} onDone={async () => {}} onCancel={() => {}} />);
  expect(html).toContain("Intitulé de la prestation");
  expect(html).toContain("Prestation à réaliser / acompte");
  expect(html).toContain("Enregistrer le brouillon");
  expect(html).toContain("J’ai vérifié");
  expect(html).toMatch(/disabled="">.*?Valider l’intégration/s);
});
it("propose de rattacher un paiement correspondant sans recréer une prestation", () => {
  const html = renderToStaticMarkup(<BankDraftEditor draft={draft} candidates={[{ key: "payment:existing", id: "existing", kind: "payment", amount: 11000, date: "2025-09-16", identities: ["Client"], label: "Paiement existant" }]} onDone={async () => {}} onCancel={() => {}} />);
  expect(html).toContain("Paiement existant");
  expect(html).toContain("aucune prestation supplémentaire ne sera ajoutée");
  expect(html).not.toContain("Intitulé de la prestation");
});
it("traite les sorties comme des charges à classer, sans déduire une TVA supposée", () => {
  const html = renderToStaticMarkup(<BankDraftEditor draft={{ ...draft, side: "debit", transaction: { ...draft.transaction, side: "debit" } }} candidates={[]} onDone={async () => {}} onCancel={() => {}} />);
  expect(html).toContain("Libellé de la charge");
  expect(html).toContain("Catégorie");
  expect(html).toContain("aucune TVA n’est devinée");
  expect(html).not.toContain("Client</span>");
});
