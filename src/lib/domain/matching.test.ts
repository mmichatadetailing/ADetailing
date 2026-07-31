import { expect, it } from "vitest";
import { scoreQuoteForInvoice } from "./matching";
import type { Invoice, Quote } from "./types";

const base = { organizationId: "org", locationId: "loc", createdAt: "2026-01-01", updatedAt: "2026-01-01", clientId: "c1", issuedAt: "2026-06-01", totalExcludingTax: 18_110, totalTax: 0, totalIncludingTax: 18_110 };
const quote: Quote = { ...base, id: "q1", number: "D1", status: "sent", lines: [{ id: "l1", designation: "Pack Brillance Fourgon", quantity: 1, unitPrice: 18_110, discount: 0, netAmount: 18_110, vatRateBasisPoints: 0 }] };
const invoice: Invoice = { ...base, id: "i1", number: "F1", status: "issued", paymentStatus: "unpaid", lines: [{ id: "l2", designation: "Pack Brillance Fourgon", quantity: 1, unitPrice: 18_110, discount: 0, netAmount: 18_110, vatRateBasisPoints: 0 }] };

it("explique un rapprochement devis-facture fort", () => {
  const match = scoreQuoteForInvoice(invoice, quote);
  expect(match.score).toBe(100);
  expect(match.reasons).toContain("Même client");
  expect(match.reasons).toContain("Même montant");
});
