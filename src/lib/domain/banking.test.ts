import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automaticBankMatches, bankCandidateMatches, type BankTransaction, type BankCandidate } from "./banking";
const transaction = { id: "tx", remote_id: "remote", account_name: "Compte", label: "VIREMENT FACTURE F2026-123", counterparty: "Matis Paysage", reference: "", amount_cents: 11_000, currency: "EUR", side: "credit", status: "completed", settled_at: "2026-09-16T12:00:00Z", emitted_at: "2026-09-16T12:00:00Z", operation_type: "transfer", reconciliation: "unmatched", payment_id: null, expense_id: null, expense_month: null, created_entry: false, ignored_reason: null } satisfies BankTransaction;
const candidate = { key: "payment:p1", kind: "payment", id: "p1", label: "Paiement", identities: ["Matis Paysage"], amount: 11_000, date: "2026-09-15T12:00:00Z" } satisfies BankCandidate;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("rapprochement bancaire prudent", () => {
  it("rapproche un montant exact avec un nom explicite", () => expect(automaticBankMatches([transaction], [candidate])).toHaveLength(1));
  it("ne rapproche jamais sur le montant seul", () => expect(bankCandidateMatches({ ...transaction, label: "Virement", counterparty: "Inconnu" }, [candidate])).toHaveLength(0));
  it("ne rapproche pas des noms partiels accidentels", () => expect(bankCandidateMatches({ ...transaction, label: "", counterparty: "Matis Paysagiste" }, [candidate])).toHaveLength(0));
  it("refuse les opérations non terminées, inversées, en devise ou internes", () => {
    for (const patch of [{ status: "pending" }, { status: "reversed" }, { status: "declined" }, { currency: "USD" }, { operation_type: "internal_transfer" }, { reconciliation: "matched" as const }]) expect(automaticBankMatches([{ ...transaction, ...patch }], [candidate])).toHaveLength(0);
  });
  it("laisse une ambiguïté à validation manuelle dans les deux sens", () => {
    expect(automaticBankMatches([transaction], [candidate, { ...candidate, key: "payment:p2", id: "p2" }])).toHaveLength(0);
    expect(automaticBankMatches([transaction, { ...transaction, id: "second" }], [candidate])).toHaveLength(0);
    const second = { ...candidate, key: "payment:p2", id: "p2", identities: ["Autre Client"] };
    expect(automaticBankMatches([transaction, { ...transaction, id: "second", counterparty: "Matis Paysage et Autre Client" }], [candidate, second])).toHaveLength(0);
  });
  it("ne crée pas automatiquement de paiement d’une prestation ou d’un entretien", () => {
    expect(automaticBankMatches([transaction], [{ ...candidate, kind: "intervention" }])).toHaveLength(0);
    expect(automaticBankMatches([transaction], [{ ...candidate, kind: "maintenance" }])).toHaveLength(0);
  });
  it("ne rapproche pas une opération sans date de règlement ou située dans le futur", () => {
    expect(automaticBankMatches([{ ...transaction, settled_at: null }], [candidate])).toHaveLength(0);
    expect(automaticBankMatches([{ ...transaction, settled_at: "2027-01-01T12:00:00Z" }], [candidate])).toHaveLength(0);
  });
  it("compare une sortie uniquement à une échéance de charge connue", () => {
    expect(automaticBankMatches([{ ...transaction, side: "debit" }], [candidate])).toHaveLength(0);
    expect(automaticBankMatches([{ ...transaction, side: "debit" }], [{ ...candidate, kind: "expense", key: "expense:e1:2026-09", month: "2026-09" }])).toHaveLength(1);
  });
});
