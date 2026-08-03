import { describe, expect, it } from "vitest";
import type { Intervention, Invoice, Payment } from "./types";
import { getInterventionWorkflow } from "./intervention-workflow";

const base = { organizationId: "org", locationId: "loc", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const intervention = { ...base, id: "job", clientId: "client", vehicleId: "vehicle", status: "completed", title: "Formule", startAt: "2026-07-01T08:00:00Z", endAt: "2026-07-01T10:00:00Z", plannedDurationMinutes: 120, workers: [], items: [], productCost: 0, travelCost: 0, otherDirectCosts: 0, address: "Orange", checklistDone: 0, checklistTotal: 0, depositAmount: 0 } satisfies Intervention;
const invoice = { ...base, id: "invoice", clientId: "client", number: "F-1", status: "issued", paymentStatus: "unpaid", issuedAt: "2026-07-01", totalExcludingTax: 10_000, totalTax: 2_000, totalIncludingTax: 12_000, lines: [] } satisfies Invoice;

describe("parcours d’une prestation", () => {
  it("place une prestation terminée sans facture à l’étape facturation", () => {
    const result = getInterventionWorkflow(intervention, undefined, []);
    expect(result.currentStep).toBe("invoice");
    expect(result.steps.map((step) => step.state)).toEqual(["done", "done", "current", "pending"]);
  });

  it("distingue un paiement partiel d’un encaissement complet", () => {
    const partial = [{ ...base, id: "payment-1", invoiceId: invoice.id, amount: 4_000, paidAt: "2026-07-02", method: "Carte" }] satisfies Payment[];
    const partialResult = getInterventionWorkflow({ ...intervention, invoiceId: invoice.id }, invoice, partial);
    expect(partialResult.currentStep).toBe("payment");
    expect(partialResult.outstanding).toBe(8_000);
    expect(partialResult.steps[3]?.detail).toBe("Paiement partiel");

    const paid = [...partial, { ...base, id: "payment-2", invoiceId: invoice.id, amount: 8_000, paidAt: "2026-07-03", method: "Virement" }] satisfies Payment[];
    expect(getInterventionWorkflow({ ...intervention, invoiceId: invoice.id }, invoice, paid).isComplete).toBe(true);
  });

  it("permet un encaissement manuel sans facture", () => {
    const pricedIntervention = { ...intervention, items: [{ id: "line", label: "Formule", quantity: 1, revenueAllocated: 12_000 }] };
    const partial = [{ ...base, id: "manual-1", interventionId: intervention.id, amount: 4_000, paidAt: "2026-07-02", method: "Carte" }] satisfies Payment[];
    const partialResult = getInterventionWorkflow(pricedIntervention, undefined, partial);
    expect(partialResult.currentStep).toBe("payment");
    expect(partialResult.steps[2]?.detail).toBe("Sans facture");
    expect(partialResult.outstanding).toBe(8_000);

    const paid = [...partial, { ...base, id: "manual-2", interventionId: intervention.id, amount: 8_000, paidAt: "2026-07-03", method: "Espèces" }] satisfies Payment[];
    expect(getInterventionWorkflow(pricedIntervention, undefined, paid).isComplete).toBe(true);
  });
});
