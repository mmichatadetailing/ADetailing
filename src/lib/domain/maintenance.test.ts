import { describe, expect, it } from "vitest";
import { maintenanceAnnualValue, maintenanceCollectionSummary, maintenanceMonthlyRevenue, maintenanceSchedule } from "./maintenance";

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

