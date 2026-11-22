import { describe, expect, it } from "vitest";
import { demoSeed } from "@/lib/demo/seed";
import { clientRevenueMetrics, expenseMonthSummary, grossMargin, performanceByService, rankExpensesForMonths } from "./calculations";
import { buildDashboardChartData } from "./dashboard-charts";
import { dashboardExpenses } from "./dashboard-expenses";
import { getInterventionWorkflow } from "./intervention-workflow";
import { billingPeriodForVisit, dueMaintenanceAmount, maintenanceAnnualValue, maintenanceRenewalStatus } from "./maintenance";
import { paymentTimestamp } from "./payment-date";
import { periodPerformance } from "./performance";
import { getCompanyStatsPeriod, previousReportDay, reportKey } from "./periods";
import { recordedActivity } from "./qonto-finance";
import { weeklyWorkload } from "./team-workload";
import type { Expense, Intervention, MaintenanceBillingPeriod, MaintenanceContract } from "./types";

const now = new Date("2026-11-21T12:00:00Z");
const job: Intervention = { ...demoSeed.interventions[0]!, id: "job", clientId: "client", invoiceId: "invoice", status: "completed", startAt: "2026-10-31T23:20:00Z",
  items: [{ id: "line", label: "Formule", quantity: 1, revenueAllocated: 10_000 }], productCost: 750, travelCost: 250, otherDirectCosts: 0 };
const invoice = { ...demoSeed.invoices[0]!, id: "invoice", clientId: "client", totalIncludingTax: 10_000 };
const deposit = { ...demoSeed.payments[0]!, id: "deposit", invoiceId: "invoice", interventionId: "job", amount: 3000, paidAt: "2026-10-31T23:30:00Z" };
const fees: Expense = { ...demoSeed.expenses[0]!, id: "fees", date: "2026-10-02", seriesId: "fees", recurrence: "monthly", paid: true, paidAt: undefined,
  amountIncludingTax: 10_000, settlements: [{ id: "s", month: "2026-10", paidAt: "2026-11-05", amount: 10_000, bankTransactionId: "transfer", splitLeg: 1, cashDelta: 10 }] };

describe("cohérence entre les registres, la période et le pilotage", () => {
  it("laisse 70 € sur une prestation à 100 € avec un acompte de 30 € rattaché aux deux pièces", () => {
    const payments = [deposit, { ...deposit, id: "future", amount: 7000, paidAt: "2026-11-21T13:00:00Z" }];
    expect(getInterventionWorkflow(job, invoice, payments, now)).toMatchObject({ outstanding: 7000, paidAmount: 3000, isPaid: false });
    expect(clientRevenueMetrics("client", [invoice], [job], payments, [], [], now)).toMatchObject({ outstanding: 7000, collected: 3000, revenue: 10_000 });
    expect(periodPerformance([job], payments, "2026-11", now)).toMatchObject({ collected: 3000, margin: 9000, basket: 10000 });
    expect(periodPerformance([job], payments, "2026-10", now)).toMatchObject({ collected: 0, margin: 0, basket: 0 });
    const chart = buildDashboardChartData({ year: 2026, interventions: [job], payments, expenses: [], objectives: [], reference: now });
    expect(chart.revenue[10]?.collected).toBe(3000);
    expect(recordedActivity(payments, [], "2026-11", 0, now).received).toBe(3000);
  });

  it("sépare en novembre le règlement tardif d’octobre, son arrondi, le liquide et le prélèvement sans preuve", () => {
    const cash: Expense = { ...fees, id: "cash", seriesId: undefined, date: "2026-11-09", recurrence: "one_off", paymentMethod: "Espèces", amountIncludingTax: 600, settlements: [] };
    const list = [fees, cash];
    const november = dashboardExpenses(list, ["2026-11"], "2026-11-21");
    expect(november.paid).toMatchObject({ total: 10600, cash: 600 });
    expect(november.outstanding).toMatchObject({ total: 10000 });
    expect(dashboardExpenses(list, ["2026-10"], "2026-11-21")).toMatchObject({ paid: { total: 0 }, outstanding: { total: 0 } });
    expect(expenseMonthSummary(list, "2026-11", now)).toMatchObject({ paid: 600, due: 10000 });
    expect(rankExpensesForMonths(list, ["2026-10", "2026-11"], now)[0]).toMatchObject({ paid: 10000, remaining: 10000, lastMonth: "2026-11" });
    const chart = buildDashboardChartData({ year: 2026, interventions: [], payments: [], expenses: list, objectives: [], reference: now });
    expect(chart.cashFlow[10]).toMatchObject({ registeredExpenses: 10600, outstandingExpenses: 10000, paidExpenses: 20610 });
    expect(recordedActivity([], list, "2026-11", 0, now).spent).toBe(10600);
  });

  it("répartit le coût à un centime près sur les offres, y compris une ligne libre", () => {
    const mixed = { ...job, productCost: 1, travelCost: 0, items: ["b", "a", undefined].map((serviceId, i) => ({ id: String(i), serviceId, label: "Ligne", quantity: 1, revenueAllocated: 100 })) };
    const stats = performanceByService([mixed, { ...mixed, id: "future-job", status: "scheduled" }]);
    expect(stats.size).toBe(3);
    expect(stats.get(undefined)?.sales).toBe(1);
    expect([...stats.values()].reduce((sum, s) => sum + s.margin, 0)).toBe(grossMargin(mixed));
  });

  it("garde la semaine de Paris et répartit le travail qui traverse le lundi à minuit", () => {
    const betweenWeeks = { ...job, startAt: "2026-11-15T22:30:00Z", endAt: "2026-11-15T23:30:00Z", workers: [{ memberId: "m", plannedMinutes: 60 }] };
    const nextWeek = { ...betweenWeeks, startAt: "2026-11-23T10:00:00Z", endAt: "2026-11-23T11:00:00Z" };
    expect(weeklyWorkload([betweenWeeks, nextWeek, { ...betweenWeeks, status: "cancelled" }], now).get("m")).toBe(30);
    expect(weeklyWorkload([betweenWeeks], new Date("2026-11-15T10:00Z")).get("m")).toBe(30);
  });

  it("ne propage pas le règlement d’un forfait de six mois à la période de renouvellement", () => {
    const contract: MaintenanceContract = { ...job, id: "contract", title: "Six mois", billingFrequency: "prepaid", termMonths: 6, billingAmount: 10001,
      status: "active", firstVisitOn: "2026-05-31", visitDay: 31, vehicleCount: 1, preferredStartTime: "09:00", assignedMemberIds: [], renewalReminderDays: 30, notes: "" };
    const paid: MaintenanceBillingPeriod = { ...job, id: "first", contractId: contract.id, amount: 10001, periodStart: "2026-05-01", dueOn: "2026-05-31", status: "paid", paidAt: "2026-05-31" };
    const renewal = { ...paid, id: "renewal", periodStart: "2026-11-01", dueOn: "2026-11-12", paidAt: "2026-11-25" };
    const periods = [renewal, paid];
    expect(billingPeriodForVisit({ maintenanceContractId: contract.id, maintenancePeriod: "2026-10", startAt: "2026-11-02" }, contract, periods)?.id).toBe("first");
    expect(billingPeriodForVisit({ maintenanceContractId: contract.id, maintenancePeriod: "2026-11" }, contract, periods)?.id).toBe("renewal");
    expect(dueMaintenanceAmount(periods, now)).toBe(10001);
    expect(clientRevenueMetrics("client", [], [], [], [contract], periods, now).outstanding).toBe(10001);
    expect(maintenanceAnnualValue(contract)).toBe(20002);
    expect(maintenanceAnnualValue({ ...contract, billingFrequency: "annual" })).toBe(10001);
    expect(maintenanceRenewalStatus({ ...contract, endsOn: "2026-10-27" }, new Date("2026-10-24T12:00Z")).daysRemaining).toBe(3);
  });

  it("distingue le jour civil du fuseau du navigateur et compare les périodes bissextiles", () => {
    const midnight = new Date("2026-10-31T23:30:00Z");
    expect(reportKey(null, "month", midnight)).toBe("month:2026-11");
    expect(reportKey("2026-12", "month", midnight)).toBe("month:2026-11");
    expect(paymentTimestamp("2026-11-01", midnight)).toBe(midnight.toISOString());
    expect(() => paymentTimestamp("2026-02-30", midnight)).toThrow();
    expect(previousReportDay(getCompanyStatsPeriod("month:2024-02"), new Date("2024-02-29T12:00Z"))).toBe("2023-02-28");
    expect(previousReportDay(getCompanyStatsPeriod("month:2025-02"), now)).toBe("2024-02-29");
  });
});
