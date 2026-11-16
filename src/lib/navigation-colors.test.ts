import { describe, expect, it } from "vitest";
import { sectionTone } from "./navigation-colors";

describe("repères visuels des sections", () => {
  it("regroupe les fonctions liées sous une même couleur", () => {
    for (const route of ["/finances", "/banque", "/factures"]) expect(sectionTone(route)).toBe("emerald");
    for (const route of ["/clients", "/equipe", "/inbox", "/compte"]) expect(sectionTone(route)).toBe("violet");
    for (const route of ["/prestations", "/catalogue"]) expect(sectionTone(route)).toBe("amber");
  });
  it("conserve les repères dans les sous-pages et les liens filtrés", () => {
    expect(sectionTone("/planning?date=2026-11-16")).toBe("blue");
    expect(sectionTone("/clients/contact-123")).toBe("violet");
    expect(sectionTone("/entretiens#contrat-123")).toBe("teal");
  });
  it("garde une couleur neutre pour les réglages et les pages inconnues", () => {
    expect(sectionTone("/parametres/import")).toBe("neutral");
    expect(sectionTone("/inconnue")).toBe("neutral");
    expect(sectionTone("/")).toBe("neutral");
  });
});
