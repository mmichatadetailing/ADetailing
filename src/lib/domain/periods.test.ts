import { describe, expect, it } from "vitest";
import { getPeriodRange, isDateInRange, monthKey } from "./periods";

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
