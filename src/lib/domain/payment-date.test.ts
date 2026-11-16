import { describe, expect, it } from "vitest";
import { dateKey } from "./periods";
import { paymentTimestamp } from "./payment-date";

describe("date d’encaissement", () => {
  it("accepte un encaissement du jour avant midi sans le placer dans le futur", () => {
    const morning = new Date(2026, 10, 16, 9, 0);
    expect(paymentTimestamp("2026-11-16", morning)).toBe(morning.toISOString());
  });
  it("conserve le jour choisi pour une saisie historique", () => {
    expect(dateKey(new Date(paymentTimestamp("2026-11-10", new Date(2026, 10, 16, 9))))).toBe("2026-11-10");
  });
  it("rejette une date vide, impossible ou future", () => {
    const now = new Date(2026, 10, 16, 9);
    for (const date of ["", "2026-02-30", "2026-11-17"]) expect(() => paymentTimestamp(date, now)).toThrow();
  });
});
