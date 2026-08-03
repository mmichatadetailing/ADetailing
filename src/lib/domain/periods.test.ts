import { describe, expect, it } from "vitest";
import { getCompanyStatsPeriod, getCompanyStatsPeriodOptions, getPeriodRange, getPreviousCompanyStatsPeriodKey, isDateInRange, monthKey } from "./periods";

const reference = new Date("2026-07-30T12:00:00+02:00");

describe("dashboard periods", () => {
  it("builds a Monday-to-Monday week", () => {
    const range = getPeriodRange("Cette semaine", reference);
    expect(range.start.getDay()).toBe(1);
    expect(range.end.getTime() - range.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isDateInRange("2026-07-27T08:00:00+02:00", range)).toBe(true);
    expect(isDateInRange("2026-08-03T00:00:00+02:00", range)).toBe(false);
  });

  it("selects the previous calendar month", () => {
    const range = getPeriodRange("Mois précédent", reference);
    expect(monthKey(range.start)).toBe("2026-06");
    expect(isDateInRange("2026-06-30T23:59:00+02:00", range)).toBe(true);
    expect(isDateInRange("2026-07-01T00:00:00+02:00", range)).toBe(false);
  });
});

describe("périodes statistiques de l’entreprise", () => {
  it("propose l’année courante, ses mois écoulés et toute l’année N-1", () => {
    const options = getCompanyStatsPeriodOptions(reference);
    expect(options[0]?.year).toBe(2026);
    expect(options[0]?.options[0]).toEqual({ key: "year:2026", label: "Année 2026" });
    expect(options[0]?.options).toHaveLength(8);
    expect(options[1]?.options).toHaveLength(13);
  });

  it("construit une période mensuelle et une période annuelle complètes", () => {
    const month = getCompanyStatsPeriod("month:2026-03", reference);
    expect(month.monthKeys).toEqual(["2026-03"]);
    expect(monthKey(month.start)).toBe("2026-03");
    expect(monthKey(new Date(month.end.getTime() - 1))).toBe("2026-03");

    const year = getCompanyStatsPeriod("year:2025", reference);
    expect(year.monthKeys).toHaveLength(12);
    expect(year.monthKeys[0]).toBe("2025-01");
    expect(year.monthKeys[11]).toBe("2025-12");
  });

  it("compare avec la meme periode de l'annee precedente", () => {
    expect(getPreviousCompanyStatsPeriodKey(getCompanyStatsPeriod("month:2026-03", reference))).toBe("month:2025-03");
    expect(getPreviousCompanyStatsPeriodKey(getCompanyStatsPeriod("year:2026", reference))).toBe("year:2025");
  });
});
