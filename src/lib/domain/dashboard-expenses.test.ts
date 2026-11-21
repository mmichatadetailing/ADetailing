import { describe, expect, it } from "vitest";
import { dashboardExpenses } from "./dashboard-expenses";
import { recordedExpenses } from "./expense-ledger";
import { getCompanyStatsPeriod } from "./periods";
import type { Expense } from "./types";

const today = "2026-11-21";
const year = getCompanyStatsPeriod("year:2026").monthKeys;
function expense(id: string, overrides: Partial<Expense> = {}): Expense {
  return { id, organizationId: "org", locationId: "site", createdAt: today, updatedAt: today, date: "2026-11-05",
    allocatedMonth: "2026-11", description: id, supplier: "Fournisseur", category: "Achats", family: "variable",
    paid: false, recurrence: "one_off", amountIncludingTax: 1000, amountExcludingTax: 1000, vatAmount: 0, vatRecoverable: false, ...overrides };
}
function settlement(id: string, month: string, paidAt: string, amount: number) {
  return { id, bankTransactionId: "banque-" + id, month, paidAt, amount };
}

describe("charges de la période du dashboard", () => {
  it("liste toutes les familles, y compris les espèces, sans changer le périmètre du résultat d’activité", () => {
    const all = (["fixed", "variable", "investment", "personal"] as const).flatMap((family, i) => [
      expense(family, { family, paid: true, amountIncludingTax: (i + 1) * 1000,
        ...(family === "variable" ? { paymentMethod: "Espèces", settlements: [settlement("lien", "2026-11", "2026-11-05", 2000)] } : {}) }),
      expense(family + "-due", { family, amountIncludingTax: (i + 1) * 100 }),
    ]);
    const { paid, outstanding } = dashboardExpenses(all, ["2026-11"], today);
    expect(paid).toMatchObject({ total: 10000, cash: 2000 });
    expect(paid.lines).toHaveLength(4);
    expect(outstanding.total).toBe(1000);
    expect(outstanding.lines).toHaveLength(4);
    expect(recordedExpenses(all, "2026-11", new Date(today)).total).toBe(3000);
  });

  it("rattache chaque règlement à son jour à Paris, mais solde son échéance d’origine, même hors période", () => {
    const all = [
      expense("tardif", { date: "2026-10-05", paid: true, paidAt: "2026-10-31T23:30:00Z" }),
      expense("anticipé", { date: "2026-12-08", settlements: [settlement("s", "2026-12", "2026-11-10", 750)] }),
      expense("futur", { paid: true, paidAt: "2026-12-02", paymentMethod: "Carte", amountIncludingTax: 1800 }),
    ];
    const november = dashboardExpenses(all, ["2026-11"], today);
    expect(november.paid.total).toBe(1750);
    expect(november.paid.lines.map(l => [l.expense.id, l.day, l.month])).toEqual([
      ["anticipé", "2026-11-10", "2026-12"], ["tardif", "2026-11-01", "2026-10"],
    ]);
    expect(november.outstanding.total).toBe(1800);
    expect(dashboardExpenses(all, ["2026-10"], today).outstanding.lines).toEqual([]);
    expect(dashboardExpenses(all, ["2026-12"], today)).toMatchObject({ paid: { total: 0 }, outstanding: { total: 0 } });
    expect(dashboardExpenses(all, ["2026-11"], "2026-12-02").outstanding.total).toBe(0);
    expect(dashboardExpenses(all, ["2026-12"], "2026-12-02").paid.total).toBe(1800);
  });

  it("un seul virement solde chaque ligne à son tarif, même après révision ; l’écart bancaire ne fait pas une dépense", () => {
    const split = (id: string, amount: number, splitLeg: number) => ({
      ...settlement(id, "2026-11", "2026-11-02", amount), bankTransactionId: "virement", splitLeg, cashDelta: splitLeg === 1 ? 214 : 0,
    });
    const all = [
      expense("camion", { date: "2026-10-01", recurrence: "monthly", endsAt: "2026-11-09", seriesId: "camion", paid: true, amountIncludingTax: 36071, settlements: [split("s1", 36071, 1)] }),
      expense("nouveau", { date: "2026-11-10", recurrence: "monthly", seriesId: "camion", paid: true, amountIncludingTax: 39000 }),
      expense("assurance", { recurrence: "monthly", paid: true, amountIncludingTax: 12215, settlements: [split("s2", 12215, 2)] }),
    ];
    const november = dashboardExpenses(all, ["2026-11"], today);
    expect(november.paid.total).toBe(48286);
    expect(november.paid.lines.map(l => l.grouped)).toEqual([true, true]);
    expect(november.outstanding.lines).toEqual([]);
    const annual = dashboardExpenses(all, year, today);
    expect(annual.paid.total).toBe(48286);
    expect(annual.outstanding.lines.map(l => [l.expense.id, l.day, l.amount])).toEqual([
      ["camion", "2026-10-01", 36071], ["assurance", "2026-12-05", 12215], ["nouveau", "2026-12-10", 39000],
    ]);
  });

  it("ne confond pas le prélèvement prévu et le règlement historique et respecte les fins de mois et de série", () => {
    const all = [
      expense("mensuelle", { date: "2026-01-31", recurrence: "monthly", paid: true, legacyRow: 1, paymentMethod: "Espèces", endsAt: "2026-03-31" }),
      expense("annuelle", { date: "2025-12-31", recurrence: "annual", paid: true, amountIncludingTax: 9000 }),
    ];
    const annual = dashboardExpenses(all, year, today);
    expect(annual.paid).toMatchObject({ total: 1000, cash: 1000 });
    expect(annual.outstanding.total).toBe(11000);
    expect(annual.outstanding.lines.map(l => l.day)).toEqual(["2026-02-28", "2026-03-31", "2026-12-31"]);
  });

  it("ne tronque pas le détail et calcule les totaux à partir des mêmes lignes", () => {
    const all = Array.from({ length: 30 }, (_, i) => expense(String(i), { paid: i % 2 === 0, amountIncludingTax: i + 1 }));
    const summary = dashboardExpenses(all, ["2026-11", "2026-11"], today);
    for (const group of [summary.paid, summary.outstanding]) {
      expect(group.lines).toHaveLength(15);
      expect(group.total).toBe(group.lines.reduce((n, l) => n + l.amount, 0));
    }
  });
});
