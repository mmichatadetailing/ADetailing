import { describe, expect, it } from "vitest";
import { parseHenrriText } from "./henrri-parser";

const quoteFixture = `
DEVIS I-26-05-17
Date : 28/05/2026
Client : Client EXEMPLE
Pack Brillance Berline 1 59,00 € 59,00 €
Pack Confort Berline 1 69,00 € 69,00 €
Pack Confort Citadine 1 59,00 € 59,00 €
Pressing sièges avant 1 30,00 € 30,00 €
Total TTC : 217,00 €
Paiement comptant
`;

const invoiceFixture = `
FACTURE 26-06-6
Date : 01/06/2026
Société : ENTREPRISE EXEMPLE
SIRET 00000000000000
Pack Confort+ Fourgon 1 119,00 € 119,00 €
Pack Brillance Fourgon 1 69,00 € 62,10 €
Total HT : 181,10 €
TVA : 0,00 €
Total TTC : 181,10 €
Règlement par virement
`;

describe("parseur Henrri déterministe", () => {
  it("extrait un devis multi-lignes sans inventer la prestation réelle", () => {
    const parsed = parseHenrriText(quoteFixture);
    expect(parsed.documentType).toBe("quote");
    expect(parsed.number).toBe("I-26-05-17");
    expect(parsed.date).toContain("2026-05-28");
    expect(parsed.lines.map((line) => line.netAmount)).toEqual([5_900, 6_900, 5_900, 3_000]);
    expect(parsed.totalIncludingTax).toBe(21_700);
    expect(parsed.paymentTerms).toBe("Comptant");
  });
  it("extrait une facture et détecte la remise implicite", () => {
    const parsed = parseHenrriText(invoiceFixture);
    expect(parsed.documentType).toBe("invoice");
    expect(parsed.number).toBe("26-06-6");
    expect(parsed.professional).toBe(true);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[1]).toMatchObject({ unitPrice: 6_900, netAmount: 6_210, discount: 690, discountRateBasisPoints: 1_000, implicitDiscountDetected: true });
    expect(parsed.totalExcludingTax).toBe(18_110);
    expect(parsed.totalTax).toBe(0);
    expect(parsed.totalIncludingTax).toBe(18_110);
    expect(parsed.paymentMethod).toBe("Virement");
    expect(parsed.warnings.some((warning) => warning.includes("paiement reste à confirmer"))).toBe(true);
  });
});

