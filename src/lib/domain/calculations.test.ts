import { describe, expect, it } from "vitest";
import {
  actualPersonMinutes,
  calculateVat,
  clientRevenueMetrics,
  conversionRate,
  grossMargin,
  hourlyMargin,
  inferDiscount,
  objectiveProgress,
  occupancyRate,
  paymentStatusForInvoice,
  expenseOccursInMonth,
  paidExpenseAmountForMonth,
  projectedExpenseAmountForMonth,
  recurringExpenseMetrics,
  paymentsForIntervention,
  paymentsForInvoice,
} from "./calculations";
import type { Intervention, Invoice, Lead, MonthlyObjective, Payment } from "./types";

const base = { organizationId: "org", locationId: "loc", createdAt: "2026-01-01", updatedAt: "2026-01-01" };

const intervention: Intervention = {
  ...base, id: "i1", clientId: "c1", vehicleId: "v1", status: "completed", title: "Test", plannedDurationMinutes: 240,
  workers: [{ memberId: "a", plannedMinutes: 240, actualMinutes: 240 }, { memberId: "b", plannedMinutes: 240, actualMinutes: 180 }],
  items: [{ id: "l1", label: "Formule", quantity: 1, revenueAllocated: 50_000 }], productCost: 5_000, travelCost: 2_000, otherDirectCosts: 1_000,
  address: "", checklistDone: 1, checklistTotal: 1, depositAmount: 0,
};

const invoice: Invoice = {
  ...base, id: "f1", clientId: "c1", number: "F-1", status: "issued", paymentStatus: "unpaid", issuedAt: "2026-07-01",
  dueAt: "2026-07-15", totalExcludingTax: 10_000, totalTax: 2_000, totalIncludingTax: 12_000, lines: [],
};

const payment = (id: string, amount: number): Payment => ({ ...base, id, invoiceId: "f1", amount, paidAt: "2026-07-10", method: "Virement" });

describe("calculs financiers", () => {
  it("calcule la marge brute en centimes", () => expect(grossMargin(intervention)).toBe(42_000));
  it("additionne les heures-personnes individuelles", () => expect(actualPersonMinutes(intervention)).toBe(420));
  it("calcule la marge horaire sur les heures-personnes", () => expect(hourlyMargin(intervention)).toBe(6_000));
  it("gère une durée nulle sans division", () => expect(hourlyMargin({ ...intervention, workers: [] })).toBeNull());
  it("calcule la TVA sans flottant métier", () => expect(calculateVat(18_110, 2_000)).toBe(3_622));
  it("détecte une remise implicite de 10 %", () => expect(inferDiscount(1, 6_900, 6_210)).toEqual({ amount: 690, rateBasisPoints: 1_000, detected: true }));
  it("ignore une remise lorsque le prix brut est nul", () => expect(inferDiscount(0, 10_000, -500)).toEqual({ amount: 0, rateBasisPoints: 0, detected: false }));
  it("additionne plusieurs paiements", () => expect(paymentsForInvoice("f1", [payment("p1", 5_000), payment("p2", 2_000)])).toBe(7_000));
  it("additionne les paiements manuels d’une prestation sans les mélanger aux factures", () => {
    const direct = { ...base, id: "direct", interventionId: "i1", amount: 8_000, paidAt: "2026-07-10", method: "Carte" } satisfies Payment;
    expect(paymentsForIntervention("i1", [payment("invoice", 5_000), direct])).toBe(8_000);
  });
  it("agrège les revenus d'un client avec et sans facture sans double comptage", () => {
    const linkedIntervention = { ...intervention, invoiceId: invoice.id };
    const directIntervention = { ...intervention, id: "i2", invoiceId: undefined, items: [{ ...intervention.items[0]!, id: "l2", revenueAllocated: 8_000 }] };
    const scheduledIntervention = { ...intervention, id: "i3", status: "scheduled" as const, items: [{ ...intervention.items[0]!, id: "l3", revenueAllocated: 5_000 }] };
    const directPayment = { ...base, id: "direct", interventionId: "i2", amount: 8_000, paidAt: "2026-07-10", method: "Carte" } satisfies Payment;
    const metrics = clientRevenueMetrics("c1", [invoice], [linkedIntervention, directIntervention, scheduledIntervention], [payment("invoice", 5_000), directPayment]);
    expect(metrics.revenue).toBe(20_000);
    expect(metrics.collected).toBe(13_000);
    expect(metrics.revenueEntryCount).toBe(2);
  });
  it("distingue paiement partiel et facture payée", () => {
    expect(paymentStatusForInvoice(invoice, [payment("p1", 5_000)], new Date("2026-07-10"))).toBe("partial");
    expect(paymentStatusForInvoice(invoice, [payment("p1", 12_000)], new Date("2026-07-10"))).toBe("paid");
  });
  it("ne considère jamais une facture émise comme payée", () => expect(paymentStatusForInvoice(invoice, [], new Date("2026-07-10"))).toBe("unpaid"));
  it("marque en retard uniquement après échéance", () => expect(paymentStatusForInvoice(invoice, [], new Date("2026-07-20"))).toBe("overdue"));
});

describe("charges récurrentes", () => {
  const monthly = { date: "2026-02-28T12:00:00.000Z", recurrence: "monthly" as const, amountIncludingTax: 12_000, paid: true };
  const annual = { date: "2026-03-10T12:00:00.000Z", recurrence: "annual" as const, amountIncludingTax: 24_000, paid: true };
  const oneOff = { date: "2026-04-15T12:00:00.000Z", recurrence: "one_off" as const, amountIncludingTax: 5_000, paid: false };

  it("projette chaque fréquence uniquement dans les mois concernés", () => {
    expect(expenseOccursInMonth(monthly, "2026-01")).toBe(false);
    expect(expenseOccursInMonth(monthly, "2026-04")).toBe(true);
    expect(expenseOccursInMonth(annual, "2027-03")).toBe(true);
    expect(expenseOccursInMonth(annual, "2027-04")).toBe(false);
    expect(projectedExpenseAmountForMonth([monthly, annual, oneOff], "2026-04")).toBe(17_000);
  });

  it("ne compte un prélèvement automatique qu’une fois son échéance passée", () => {
    expect(paidExpenseAmountForMonth([monthly], "2026-03", new Date("2026-03-15T12:00:00"))).toBe(0);
    expect(paidExpenseAmountForMonth([monthly], "2026-03", new Date("2026-03-31T12:00:00"))).toBe(12_000);
  });

  it("calcule l’équivalent mensuel et l’engagement annuel", () => {
    expect(recurringExpenseMetrics([monthly, annual, oneOff], "2026-04")).toEqual({ monthly: 12_000, annual: 24_000, monthlyEquivalent: 14_000, annualCommitment: 168_000 });
  });
});

describe("indicateurs", () => {
  const lead = (id: string, stage: Lead["stage"]): Lead => ({ ...base, id, prospectName: id, phone: "", email: "", vehicleLabel: "", serviceLabel: "", estimatedAmount: 0, source: "Google", stage, ownerId: "a", requestedAt: "2026-01-01", nextAction: "" });
  it("calcule le taux de conversion sur les décisions", () => expect(conversionRate([lead("1", "won"), lead("2", "lost"), lead("3", "received")])).toBe(0.5));
  it("borne le taux de remplissage à 100 %", () => expect(occupancyRate(600, 500)).toBe(1));
  it("calcule l’atteinte d’objectif", () => {
    const objective = { ...base, id: "o", month: "2026-07", revenueTarget: 100_000, interventionTarget: 0, averageBasketTarget: 0, hourlyMarginTarget: 0, reviewTarget: 0 } satisfies MonthlyObjective;
    expect(objectiveProgress(45_000, objective)).toBe(0.45);
  });
});
