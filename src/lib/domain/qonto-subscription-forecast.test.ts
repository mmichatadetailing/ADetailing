import { describe, expect, it } from "vitest";
import { expenseMonthSummary, forecastExpensePrice, rankExpensesForMonths, recurringExpenseMetrics } from "./calculations";
import { buildDashboardChartData } from "./dashboard-charts";
import { dashboardExpenses } from "./dashboard-expenses";
import { occurrenceState } from "./finance-presentation";
import type { Expense } from "./types";

const reference = new Date("2026-11-22T12:00:00Z");
const payment = (month: string, amount: number) => ({ id: month, bankTransactionId: "bank-" + month, month, amount, paidAt: month + "-12T10:00:00Z" });
const first: Expense = {
  id: "s", seriesId: "s", organizationId: "org", locationId: "loc", createdAt: "2026-10-12", updatedAt: "2026-10-12",
  date: "2026-10-12", allocatedMonth: "2026-10", endsAt: "2026-11-30", supplier: "Atlas", description: "Prélèvement Atlas",
  family: "variable", category: "Logiciels", amountIncludingTax: 2900, amountExcludingTax: 2900, vatAmount: 0, vatRecoverable: false,
  recurrence: "monthly", paid: false, qontoRecurrence: "estimated", settlements: [payment("2026-10", 2900)],
};
const months = ["2026-10", "2026-11", "2026-12"];
const overview = (expenses: Expense[]) => buildDashboardChartData({ year: 2026, expenses, reference, objectives: [], interventions: [], payments: [] }).cashFlow;

describe("Abonnements fournisseurs : mêmes montants au registre, au dashboard et dans les prévisions", () => {
  it("affiche une seule estimation ouverte sans la transformer en paiement ni en engagement annuel", () => {
    expect(overview([first]).slice(9)).toMatchObject([
      {expenses:2900, registeredExpenses:2900, outstandingExpenses:0},
      {expenses:2900, paidExpenses:0, registeredExpenses:0, outstandingExpenses:2900},
      {expenses:0, registeredExpenses:0, outstandingExpenses:0},
    ]);
    const nov = expenseMonthSummary([first], months[1]!, reference);
    expect(nov).toMatchObject({total:2900, paid:0, due:2900});
    expect(occurrenceState(nov.occurrences[0]!)).toEqual({label:"Mensualité estimée · non réglée",tone:"amber"});
    expect(dashboardExpenses([first], months, "2026-11-22")).toMatchObject({paid:{total:2900},outstanding:{total:2900}});
    expect(recurringExpenseMetrics([first], months[1]!).annualCommitment).toBe(0);
  });
  it("remplace la prévision par le débit et reprend le dernier montant connu sans modifier les anciens mois", () => {
    const confirmed: Expense = {...first, endsAt:undefined, qontoRecurrence:"confirmed", settlements:[...first.settlements!, payment("2026-11",3190)]};
    expect(overview([confirmed]).slice(9)).toMatchObject([
      {expenses:2900,registeredExpenses:2900}, {expenses:3190,registeredExpenses:3190,outstandingExpenses:0},
      {expenses:3190,registeredExpenses:0,outstandingExpenses:3190},
    ]);
    expect(dashboardExpenses([confirmed], months.slice(0,2), "2026-11-22")).toMatchObject({paid:{total:6090},outstanding:{total:0}});
    expect(expenseMonthSummary([confirmed], "2026-11", new Date("2026-10-20T12:00:00Z"))).toMatchObject({total:2900,paid:0,upcoming:2900});
    expect(rankExpensesForMonths([confirmed], months, reference)).toMatchObject([{paid:6090,remaining:3190,occurrenceCount:3}]);
    expect(recurringExpenseMetrics([confirmed], "2026-11").annualCommitment).toBe(3190*12);
    const manual = {...confirmed, qontoRecurrence:undefined, amountIncludingTax:3500};
    expect(forecastExpensePrice(manual,"2026-12","2026-11-22")).toBe(3500);
  });
  it("retire seulement l’échéance non corroborée", () => {
    const expired: Expense = {...first, qontoRecurrence:"expired", endsAt:"2026-10-31"};
    expect(dashboardExpenses([expired], months, "2026-11-22")).toMatchObject({paid:{total:2900},outstanding:{total:0}});
  });
});
