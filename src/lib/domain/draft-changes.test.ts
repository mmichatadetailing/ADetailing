import { describe, expect, it } from "vitest";
import { draftSnapshots, hasDraftChanges } from "./draft-changes";

describe("brouillons des fiches planning", () => {
  it("ne signale pas un formulaire inchangé ou une saisie rétablie", () => {
    const initial = draftSnapshots({ details: { title: "Lavage", hours: 2 }, payment: null });
    expect(hasDraftChanges(initial, draftSnapshots({ details: { title: "Lavage", hours: 2 }, payment: null }))).toBe(false);
    expect(hasDraftChanges(initial, draftSnapshots({ details: { title: "Autre", hours: 2 }, payment: null }))).toBe(true);
  });
  it("ne nettoie pas les autres sections lorsqu’une section est enregistrée", () => {
    const initial = draftSnapshots({ details: "initial", actuals: 2 });
    const current = draftSnapshots({ details: "modifié", actuals: 3 });
    expect(hasDraftChanges({ ...initial, details: current.details! }, current)).toBe(true);
    expect(hasDraftChanges(current, current)).toBe(false);
  });
  it("détecte aussi une affectation ou une ligne changée par un bouton", () => {
    expect(hasDraftChanges(draftSnapshots({ workers: ["a"] }), draftSnapshots({ workers: ["a", "b"] }))).toBe(true);
  });
});
