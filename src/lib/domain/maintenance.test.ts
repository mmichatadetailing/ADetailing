import { describe, expect, it } from "vitest";
import { dueMaintenanceAmount, isMaintenanceContractActive, maintenanceAnnualValue, maintenanceBillingState, maintenanceCollectionSummary, maintenanceMonthlyRevenue, maintenanceRenewalStatus, maintenanceSchedule, maintenanceTermEndDate, maintenanceWeekdayDate, nextMaintenanceVisit } from "./maintenance";

describe("entretiens mensuels", () => {
  it("ne présente pas une échéance annulée comme payable et distingue l’échéance du jour", () => {
    const now = new Date(2026, 10, 16, 9);
    expect(maintenanceBillingState({ status: "cancelled", dueOn: "2026-10-01" }, now)).toBe("cancelled");
    expect(maintenanceBillingState({ status: "due", dueOn: "2026-11-16" }, now)).toBe("due");
    expect(maintenanceBillingState({ status: "due", dueOn: "2026-11-15" }, now)).toBe("overdue");
    expect(maintenanceBillingState({ status: "due", dueOn: "2026-11-17" }, now)).toBe("upcoming");
    const base = { organizationId: "org", locationId: "loc", contractId: "contract", createdAt: "2026-01-01", updatedAt: "2026-01-01", periodStart: "2026-11-01", dueOn: "2026-11-16", amount: 1000 };
    expect(dueMaintenanceAmount([
      { ...base, id: "today", status: "due" }, { ...base, id: "late", status: "due", dueOn: "2026-11-10" },
      { ...base, id: "canceled", status: "cancelled" }, { ...base, id: "paid", status: "paid" },
      { ...base, id: "future", status: "due", dueOn: "2026-12-01" },
    ], now)).toBe(2000);
  });
  it("exclut des revenus récurrents les contrats futurs, terminés ou en pause", () => {
    const active = { status: "active" as const, firstVisitOn: "2026-11-01" };
    const now = new Date(2026, 10, 16);
    expect(isMaintenanceContractActive(active, now)).toBe(true);
    expect(isMaintenanceContractActive({ ...active, firstVisitOn: "2026-12-01" }, now)).toBe(false);
    expect(isMaintenanceContractActive({ ...active, endsOn: "2026-11-15" }, now)).toBe(false);
    expect(isMaintenanceContractActive({ ...active, status: "paused" }, now)).toBe(false);
  });
  it("ne propose pas une visite déjà réalisée dans les prochaines visites", () => {
    const base = { maintenanceContractId: "contract", startAt: "2026-11-16T09:00:00" };
    const next = { ...base, startAt: "2026-12-16T09:00:00", status: "scheduled" as const };
    expect(nextMaintenanceVisit("contract", [{ ...base, status: "completed" }, next], new Date(2026, 10, 16))).toBe(next);
  });
  it("tolère une date temporairement vide pendant la saisie du formulaire", () => {
    expect(maintenanceTermEndDate("", 6)).toBe("");
    expect(maintenanceTermEndDate("date-invalide", 6)).toBe("");
  });

  it("décale un week-end au lundi suivant sans toucher aux jours ouvrés", () => {
    expect(maintenanceWeekdayDate("2026-10-23")).toBe("2026-10-23");
    expect(maintenanceWeekdayDate("2026-10-24")).toBe("2026-10-26");
    expect(maintenanceWeekdayDate("2026-10-25")).toBe("2026-10-26");
  });

  it("ne décale que les occurrences mensuelles qui tombent le week-end", () => {
    const schedule = maintenanceSchedule({ firstVisitOn: "2026-10-24", visitDay: 24, billingFrequency: "monthly", billingAmount: 10_000 }, "2026-12-31");
    expect(schedule.map((entry) => entry.visitOn)).toEqual(["2026-10-26", "2026-11-24", "2026-12-24"]);
    expect(schedule.map((entry) => entry.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("conserve la dernière visite d’un forfait même si son lundi dépasse la date d’ancrage", () => {
    const endsOn = maintenanceTermEndDate("2026-10-24", 1);
    const schedule = maintenanceSchedule({ firstVisitOn: "2026-10-24", visitDay: 24, endsOn, billingFrequency: "prepaid", billingAmount: 10_000, termMonths: 1 }, endsOn);
    expect(endsOn).toBe("2026-10-24");
    expect(schedule.map((entry) => entry.visitOn)).toEqual(["2026-10-26"]);
  });

  it("reconnaît chaque mois un douzième d’un paiement annuel", () => {
    expect(maintenanceMonthlyRevenue({ billingFrequency: "annual", billingAmount: 120_000 })).toBe(10_000);
    expect(maintenanceAnnualValue({ billingFrequency: "monthly", billingAmount: 10_000 })).toBe(120_000);
  });

  it("génère une visite par mois mais une seule échéance annuelle", () => {
    const schedule = maintenanceSchedule({ firstVisitOn: "2026-10-22", visitDay: 22, billingFrequency: "annual", billingAmount: 120_000 }, "2027-10-31");
    expect(schedule).toHaveLength(13);
    expect(schedule.filter((entry) => entry.billingDue).map((entry) => entry.visitOn)).toEqual(["2026-10-22", "2027-10-22"]);
    expect(schedule.every((entry) => entry.recognizedRevenue === 10_000)).toBe(true);
  });

  it("répartit les centimes annuels sans écart sur les douze visites", () => {
    const schedule = maintenanceSchedule({ firstVisitOn: "2026-01-10", visitDay: 10, billingFrequency: "annual", billingAmount: 10_000 }, "2026-12-31");
    expect(schedule.reduce((sum, entry) => sum + entry.recognizedRevenue, 0)).toBe(10_000);
  });

  it("prépare exactement six visites et un seul paiement pour un forfait de six mois", () => {
    const endsOn = maintenanceTermEndDate("2026-10-23", 6);
    const schedule = maintenanceSchedule({ firstVisitOn: "2026-10-23", visitDay: 23, endsOn, billingFrequency: "prepaid", billingAmount: 60_000, termMonths: 6 }, endsOn);
    expect(endsOn).toBe("2027-03-23");
    expect(schedule).toHaveLength(6);
    expect(schedule.filter((entry) => entry.billingDue)).toHaveLength(1);
    expect(schedule.reduce((sum, entry) => sum + entry.recognizedRevenue, 0)).toBe(60_000);
  });

  it("adapte exactement le nombre de prestations à toute durée payée", () => {
    const endsOn = maintenanceTermEndDate("2026-10-23", 9);
    const schedule = maintenanceSchedule({ firstVisitOn: "2026-10-23", visitDay: 23, endsOn, billingFrequency: "prepaid", billingAmount: 90_000, termMonths: 9 }, endsOn);
    expect(endsOn).toBe("2027-06-23");
    expect(schedule).toHaveLength(9);
    expect(schedule.filter((entry) => entry.billingDue)).toHaveLength(1);
    expect(schedule.reduce((sum, entry) => sum + entry.recognizedRevenue, 0)).toBe(90_000);
  });

  it("déclenche la relance dans le délai configuré puis signale l’expiration", () => {
    const contract = { status: "active" as const, billingFrequency: "prepaid" as const, endsOn: "2027-03-23", renewalReminderDays: 30 };
    expect(maintenanceRenewalStatus(contract, new Date("2027-02-20T12:00:00")).state).toBe("later");
    expect(maintenanceRenewalStatus(contract, new Date("2027-03-01T12:00:00")).state).toBe("due");
    expect(maintenanceRenewalStatus(contract, new Date("2027-03-24T12:00:00")).state).toBe("expired");
  });

  it("ne relance jamais un contrat mis en pause ou terminé", () => {
    const contract = { billingFrequency: "prepaid" as const, endsOn: "2026-10-23", renewalReminderDays: 30 };
    expect(maintenanceRenewalStatus({ ...contract, status: "paused" }, new Date("2026-10-20T12:00:00")).state).toBe("not_applicable");
    expect(maintenanceRenewalStatus({ ...contract, status: "ended" }, new Date("2026-10-24T12:00:00")).state).toBe("not_applicable");
  });

  it("sépare les échéances encaissées, à venir et en retard", () => {
    const base = { organizationId: "org", locationId: "loc", contractId: "contract", createdAt: "2026-01-01", updatedAt: "2026-01-01", paymentMethod: undefined };
    const summary = maintenanceCollectionSummary([
      { ...base, id: "paid", periodStart: "2026-09-01", dueOn: "2026-09-10", amount: 10_000, status: "paid", paidAt: "2026-09-10" },
      { ...base, id: "late", periodStart: "2026-10-01", dueOn: "2026-10-10", amount: 10_000, status: "due" },
      { ...base, id: "future", periodStart: "2026-11-01", dueOn: "2026-11-10", amount: 10_000, status: "due" },
    ], new Date("2026-10-22T12:00:00"));
    expect(summary).toEqual({ total: 30_000, paid: 10_000, overdue: 10_000, upcoming: 10_000 });
  });
});

