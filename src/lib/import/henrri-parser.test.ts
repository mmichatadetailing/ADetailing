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

const columnInvoiceFixture = `
Référence
Désignation
Quantité
PU Vente
TVA
Montant HT
PACK BRILLANCE FOURGON
- Prélavage actif
1,00
80,0000 €
0,00
80,00 €
PACK CONFORT + FOURGON
1,00
100,0000 €
0,00
100,00 €
FACTURE N° 26-06-7
ADETAILING
84100 ORANGE
FRANCE
N° SIRET : 94766076700023
MATIS PONS PAYSAGE
83 Impasse DES DOMINICAINS
84250 LE THOR
SIRET : 98312255700017
Le samedi 27 juin 2026
100 % soit 180,00 € à payer (virement) le : 27/06/2026
Règlement par virement.
Total HT 180,00 €
TVA ( 0 % ) 0,00 €
Total TTC 180,00 €

PACK BRILLANCE FOURGON 1,00 80,0000 € 0,00 80,00 €
PACK CONFORT + FOURGON 1,00 100,0000 € 0,00 100,00 €
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
  it("importe les factures Henrri dont les colonnes PDF sont extraites verticalement", () => {
    const parsed = parseHenrriText(columnInvoiceFixture);
    expect(parsed).toMatchObject({
      documentType: "invoice",
      number: "26-06-7",
      company: "MATIS PONS PAYSAGE",
      professional: true,
      totalExcludingTax: 18_000,
      totalTax: 0,
      totalIncludingTax: 18_000,
      paymentMethod: "Virement",
    });
    expect(parsed.date).toContain("2026-06-27");
    expect(parsed.dueDate).toContain("2026-06-27");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.netAmount)).toEqual([8_000, 10_000]);
    expect(parsed.missingFields).toEqual([]);
  });
});
