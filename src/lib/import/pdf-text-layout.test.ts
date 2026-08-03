import { describe, expect, it } from "vitest";
import { reconstructVisualRows } from "./pdf-text-layout";

describe("reconstruction des lignes PDF", () => {
  it("regroupe les cellules par coordonnée verticale et les trie de gauche à droite", () => {
    expect(reconstructVisualRows([
      { str: "80,00 €", x: 489, y: 571.2 },
      { str: "PACK BRILLANCE FOURGON", x: 90, y: 571.2 },
      { str: "1,00", x: 309, y: 571.2 },
      { str: "100,00 €", x: 483, y: 446.8 },
      { str: "PACK CONFORT + FOURGON", x: 90, y: 446.8 },
    ])).toBe("PACK BRILLANCE FOURGON 1,00 80,00 €\nPACK CONFORT + FOURGON 100,00 €");
  });
});
