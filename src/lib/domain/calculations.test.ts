import { describe, expect, it } from "vitest";
import {
  actualPersonMinutes,
  cashBalance,
  calculateVat,
  clientRevenueMetrics,
  collectedInterventionRevenue,
  grossMargin,
  hourlyMargin,
  inferDiscount,
  objectiveProgress,
  occupancyRate,
  paymentStatusForInvoice,
  expenseOccursInMonth,
  expenseForecast,
  expenseMonthSummary,
  expenseOccurrenceDateKey,
  nextExpenseOccurrenceDateKey,
  paidExpenseAmountForMonth,
  projectedExpenseAmountForMonth,
  rankExpensesForMonths,
  recurringExpenseMetrics,
  paymentsForIntervention,
  paymentsForInvoice,
  servicePerformance,
} from "./calculations";
import type { Expense, Intervention, Invoice, MonthlyObjective, Payment } from "./types";

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
  it("répartit les coûts entre les offres sans dupliquer la marge de la prestation", () => {
    const mixedIntervention = {
      ...intervention,
      items: [
        { id: "l1", label: "Offre A", serviceId: "service-a", quantity: 1, revenueAllocated: 30_000 },
        { id: "l2", label: "Offre B", serviceId: "service-b", quantity: 1, revenueAllocated: 20_000 },
      ],
      productCost: 5_000,
      travelCost: 3_000,
      otherDirectCosts: 2_000,
    };
    const scheduledIntervention = { ...mixedIntervention, id: "i2", status: "scheduled" as const };

    expect(servicePerformance("service-a", [mixedIntervention, scheduledIntervention])).toEqual({
      sales: 1,
      revenue: 30_000,
      margin: 24_000,
      averageMargin: 24_000,
    });
  });
  it("calcule la TVA sans flottant métier", () => expect(calculateVat(18_110, 2_000)).toBe(3_622));
  it("détecte une remise implicite de 10 %", () => expect(inferDiscount(1, 6_900, 6_210)).toEqual({ amount: 690, rateBasisPoints: 1_000, detected: true }));
  it("ignore une remise lorsque le prix brut est nul", () => expect(inferDiscount(0, 10_000, -500)).toEqual({ amount: 0, rateBasisPoints: 0, detected: false }));
  it("additionne plusieurs paiements", () => expect(paymentsForInvoice("f1", [payment("p1", 5_000), payment("p2", 2_000)])).toBe(7_000));
  it("additionne les paiements manuels d’une prestation sans les mélanger aux factures", () => {
    const direct = { ...base, id: "direct", interventionId: "i1", amount: 8_000, paidAt: "2026-07-10", method: "Carte" } satisfies Payment;
    expect(paymentsForIntervention("i1", [payment("invoice", 5_000), direct])).toBe(8_000);
  });
  it("compte dans les objectifs les paiements de prestations et d’entretiens, une seule fois", () => {
    const direct = { ...base, id: "direct", interventionId: "i1", amount: 8_000, paidAt: "2026-07-10", method: "Carte" } satisfies Payment;
    const linkedInvoice = payment("linked", 5_000);
    const maintenancePayment = { ...base, id: "maintenance", maintenanceContractId: "contract-1", maintenanceBillingPeriodId: "period-1", amount: 11_000, paidAt: "2026-07-10", method: "Virement" } satisfies Payment;
    const unrelatedInvoice = { ...payment("unrelated", 90_000), invoiceId: "other-invoice" };
    expect(collectedInterventionRevenue([{ id: "i1" }, { id: "i2", invoiceId: "f1" }], [direct, linkedInvoice, maintenancePayment, unrelatedInvoice])).toBe(24_000);
  });
  it("agrège les revenus d'un client avec facture, paiement direct et entretien sans double comptage", () => {
    const linkedIntervention = { ...intervention, invoiceId: invoice.id };
    const directIntervention = { ...intervention, id: "i2", invoiceId: undefined, items: [{ ...intervention.items[0]!, id: "l2", revenueAllocated: 8_000 }] };
    const scheduledIntervention = { ...intervention, id: "i3", status: "scheduled" as const, items: [{ ...intervention.items[0]!, id: "l3", revenueAllocated: 5_000 }] };
    const directPayment = { ...base, id: "direct", interventionId: "i2", amount: 8_000, paidAt: "2026-07-10", method: "Carte" } satisfies Payment;
    const maintenancePayment = { ...base, id: "maintenance", maintenanceBillingPeriodId: "period-c1", amount: 11_000, paidAt: "2026-07-10", method: "Virement" } satisfies Payment;
    const otherClientMaintenancePayment = { ...base, id: "maintenance-other", maintenanceBillingPeriodId: "period-c2", amount: 90_000, paidAt: "2026-07-10", method: "Virement" } satisfies Payment;
    const metrics = clientRevenueMetrics(
      "c1",
      [invoice],
      [linkedIntervention, directIntervention, scheduledIntervention],
      [payment("invoice", 5_000), directPayment, maintenancePayment, otherClientMaintenancePayment],
      [{ id: "contract-c1", clientId: "c1" }, { id: "contract-c2", clientId: "c2" }],
      [{ id: "period-c1", contractId: "contract-c1" }, { id: "period-c2", contractId: "contract-c2" }],
    );
    expect(metrics.revenue).toBe(58_000);
    expect(metrics.collected).toBe(24_000);
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

  it("inclut toutes les échéances du mois dans le total, même avant leur prélèvement", () => {
    const largeMonthlyCharge = { ...monthly, date: "2026-09-25", amountIncludingTax: 36_000 };
    const currentCosts = { ...oneOff, date: "2026-09-03", amountIncludingTax: 25_100, paid: true, paidAt: "2026-09-03" };
    const summary = expenseMonthSummary([largeMonthlyCharge, currentCosts], "2026-09", new Date("2026-09-09T08:00:00"));

    expect(summary.total).toBe(61_100);
    expect(summary.paid).toBe(25_100);
    expect(summary.upcoming).toBe(36_000);
    expect(summary.occurrences.map((occurrence) => occurrence.dueDate)).toEqual(["2026-09-03", "2026-09-25"]);
  });

  it("considère l’échéance comme atteinte dès le début du jour concerné", () => {
    const dueToday = { ...monthly, date: "2026-09-09", amountIncludingTax: 36_000 };
    expect(paidExpenseAmountForMonth([dueToday], "2026-09", new Date("2026-09-09T08:00:00"))).toBe(36_000);
  });

  it("reporte une échéance du 31 au dernier jour des mois plus courts", () => {
    const endOfMonth = { ...monthly, date: "2026-01-31" };
    expect(expenseOccurrenceDateKey(endOfMonth, "2026-02")).toBe("2026-02-28");
  });

  it("construit une prévision sur douze mois en séparant les fréquences", () => {
    const forecast = expenseForecast([monthly, annual, oneOff], "2026-02", 12);
    expect(forecast).toHaveLength(12);
    expect(forecast[0]).toMatchObject({ month: "2026-02", total: 12_000, monthly: 12_000, annual: 0, oneOff: 0 });
    expect(forecast[1]).toMatchObject({ month: "2026-03", total: 36_000, monthly: 12_000, annual: 24_000, oneOff: 0 });
    expect(forecast[2]).toMatchObject({ month: "2026-04", total: 17_000, monthly: 12_000, annual: 0, oneOff: 5_000 });
    expect(forecast[11]?.month).toBe("2027-01");
  });

  it("calcule l’équivalent mensuel et l’engagement annuel", () => {
    expect(recurringExpenseMetrics([monthly, annual, oneOff], "2026-04")).toEqual({ monthly: 12_000, annual: 24_000, monthlyEquivalent: 14_000, annualCommitment: 168_000 });
  });

  it("classe les charges selon leur cumul réel sur la période choisie", () => {
    const expenses = [
      { ...monthly, id: "mensuelle", date: "2026-01-05", amountIncludingTax: 10_000 },
      { ...annual, id: "annuelle", date: "2026-02-10", amountIncludingTax: 25_000 },
      { ...oneOff, id: "ponctuelle", date: "2026-03-15", amountIncludingTax: 20_000 },
    ];
    const ranking = rankExpensesForMonths(expenses, ["2026-01", "2026-02", "2026-03"], new Date("2026-03-31T12:00:00"));

    expect(ranking.map(({ expense, total, occurrenceCount }) => ({ id: expense.id, total, occurrenceCount }))).toEqual([
      { id: "mensuelle", total: 30_000, occurrenceCount: 3 },
      { id: "annuelle", total: 25_000, occurrenceCount: 1 },
      { id: "ponctuelle", total: 20_000, occurrenceCount: 1 },
    ]);
    expect(ranking[0]).toMatchObject({ paid: 30_000, remaining: 0 });
    expect(ranking[2]).toMatchObject({ paid: 0, remaining: 20_000 });
  });

  it("conserve l’ancien tarif avant la date d’augmentation", () => {
    const oldPrice = { ...monthly, id: "old", seriesId: "subscription", date: "2026-01-15", endsAt: "2026-08-31", amountIncludingTax: 10_000 };
    const newPrice = { ...monthly, id: "new", seriesId: "subscription", date: "2026-09-15", amountIncludingTax: 12_000 };

    expect(projectedExpenseAmountForMonth([oldPrice, newPrice], "2026-08")).toBe(10_000);
    expect(projectedExpenseAmountForMonth([oldPrice, newPrice], "2026-09")).toBe(12_000);
    expect(recurringExpenseMetrics([oldPrice, newPrice], "2026-08").monthly).toBe(10_000);
    expect(recurringExpenseMetrics([oldPrice, newPrice], "2026-09").monthly).toBe(12_000);

    const ranking = rankExpensesForMonths(
      [oldPrice, newPrice],
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      new Date("2026-09-30T12:00:00"),
    );
    expect(ranking).toHaveLength(1);
    expect(ranking[0]).toMatchObject({ expense: { id: "new" }, total: 92_000, occurrenceCount: 9 });
  });

  it("applique une date exacte sans doubler l’abonnement pendant le mois de transition", () => {
    const oldPrice = { ...monthly, id: "old", seriesId: "subscription", date: "2026-01-15", endsAt: "2026-10-21", amountIncludingTax: 10_000 };
    const newPrice = { ...monthly, id: "new", seriesId: "subscription", date: "2026-10-22", amountIncludingTax: 12_000 };
    const summary = expenseMonthSummary([oldPrice, newPrice], "2026-10", new Date("2026-10-31T12:00:00"));

    expect(summary.total).toBe(12_000);
    expect(summary.occurrences).toHaveLength(1);
    expect(summary.occurrences[0]).toMatchObject({ expense: { id: "new" }, dueDate: "2026-10-22" });

    const expenseDetails = {
      ...base,
      family: "fixed" as const,
      category: "Logiciel",
      supplier: "Éditeur",
      description: "Abonnement",
      amountExcludingTax: 0,
      vatAmount: 0,
      vatRecoverable: true,
      recurrence: "monthly" as const,
      allocatedMonth: "2026-01",
      paid: true,
    };
    expect(cashBalance(0, [], [
      { ...expenseDetails, ...oldPrice },
      { ...expenseDetails, ...newPrice },
    ] satisfies Expense[], new Date("2026-10-31T12:00:00"))).toBe(-102_000);
  });

  it("propose la prochaine échéance disponible pour un nouveau tarif", () => {
    expect(nextExpenseOccurrenceDateKey({ ...monthly, date: "2026-01-15" }, new Date("2026-10-22T12:00:00"))).toBe("2026-11-15");
    expect(nextExpenseOccurrenceDateKey({ ...monthly, date: "2026-01-28" }, new Date("2026-10-22T12:00:00"))).toBe("2026-10-28");
  });
});

describe("indicateurs", () => {
  it("borne le taux de remplissage à 100 %", () => expect(occupancyRate(600, 500)).toBe(1));
  it("calcule l’atteinte d’objectif", () => {
    const objective = { ...base, id: "o", month: "2026-07", revenueTarget: 100_000, interventionTarget: 0, averageBasketTarget: 0, hourlyMarginTarget: 0, reviewTarget: 0 } satisfies MonthlyObjective;
    expect(objectiveProgress(45_000, objective)).toBe(0.45);
  });
});
