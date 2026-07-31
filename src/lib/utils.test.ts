import { describe, expect, it } from "vitest";
import { normalizePhone, normalizeText } from "./utils";

describe("normalisation", () => {
  it("normalise les téléphones français", () => expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678"));
  it("normalise accents, casse et ponctuation pour les rapprochements", () => expect(normalizeText("  PACK CONFORT +  ")).toBe("pack confort +"));
});

