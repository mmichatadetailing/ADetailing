import { describe, expect, it } from "vitest";
import { buildDashboardChartData } from "./dashboard-charts";

describe("données des graphiques du dashboard", () => {
  it("agrège le CA facturé et conserve uniquement les objectifs renseignés", () => {
    const result = buildDashboardChartData({
      year: 2026,
      objectives: [{ month: "2026-07", revenueTarget: 150_000 }],
      invoices: [
        { issuedAt: "2026-07-03T08:00:00.000Z", status: "issued", totalIncludingTax: 50_000 },
        { issuedAt: "2026-07-18T08:00:00.000Z", status: "issued", totalIncludingTax: 25_000 },
        { issuedAt: "2026-07-22T08:00:00.000Z", status: "cancelled", totalIncludingTax: 99_000 },
      ],
      payments: [],
      expenses: [],
    });

    expect(result.revenue).toHaveLength(12);
    expect(result.revenue[6]).toMatchObject({ key: "2026-07", objective: 150_000, realized: 75_000 });
    expect(result.revenue[5]?.objective).toBeNull();
  });

  it("calcule le cash-flow mensuel depuis les encaissements et dépenses payées", () => {
    const result = buildDashboardChartData({
      year: 2026,
      objectives: [],
      invoices: [],
      payments: [{ paidAt: "2026-03-05T08:00:00.000Z", amount: 120_000 }],
      expenses: [
        { date: "2026-03-02T08:00:00.000Z", paidAt: "2026-03-07T08:00:00.000Z", paid: true, amountIncludingTax: 45_000 },
        { date: "2026-03-09T08:00:00.000Z", paid: false, amountIncludingTax: 90_000 },
      ],
    });

    expect(result.cashFlow[2]).toMatchObject({ receipts: 120_000, expenses: 45_000, cashFlow: 75_000 });
  });
});
