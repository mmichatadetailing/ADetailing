import { describe, expect, it } from "vitest";
import { maintenanceAnnualValue, maintenanceCollectionSummary, maintenanceMonthlyRevenue, maintenanceRenewalStatus, maintenanceSchedule, maintenanceTermEndDate } from "./maintenance";

describe("entretiens mensuels", () => {
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

