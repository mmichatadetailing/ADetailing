import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseExcelDate, previewHistoricalWorkbook } from "./xlsx-importer";

describe("import historique XLSX", () => {
  it("convertit les numéros de série Excel et les dates françaises", () => {
    expect(parseExcelDate(46_233)).toContain("2026-07-30");
    expect(parseExcelDate("30/07/2026")).toContain("2026-07-30");
    expect(parseExcelDate("date invalide")).toBeUndefined();
  });
  it("prévisualise les onglets métier et ignore les synthèses", async () => {
    const workbook = new ExcelJS.Workbook();
    const prestations = workbook.addWorksheet("Prestations");
    prestations.addRow(["Client", "Téléphone", "Prestation", "Prix TTC", "Temps intervention", "Date intervention", "Source"]);
    prestations.addRow(["Cliente Exemple", "06 12 34 56 78", "Formule 2", 279, 4, new Date("2026-07-10T12:00:00Z"), "Google"]);
    const charges = workbook.addWorksheet("Charges");
    charges.addRow(["Date", "Famille", "Catégorie", "Description", "Montant TTC", "Payé"]);
    charges.addRow([new Date("2026-07-01T12:00:00Z"), "Fixe", "Local", "Loyer", 1200, "Oui"]);
    const dashboard = workbook.addWorksheet("Dashboard");
    dashboard.addRow(["CA encaissé", 1000]);
    const bytes = await workbook.xlsx.writeBuffer();
    const arrayBuffer = Uint8Array.from(bytes as unknown as Uint8Array).buffer;
    const preview = await previewHistoricalWorkbook(arrayBuffer, "historique-test.xlsx");
    expect(preview.totals.interventions).toBe(1);
    expect(preview.totals.expenses).toBe(1);
    expect(preview.normalized.clients[0]?.phone).toBe("+33612345678");
    expect(preview.sheets.find((sheet) => sheet.name === "Dashboard")?.detectedKind).toBe("ignored_summary");
  });
});
