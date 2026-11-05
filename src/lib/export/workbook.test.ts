import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { demoSeed } from "@/lib/demo/seed";
import { buildExportWorkbook, excelDate, exportWorkspaceExcel } from "./workbook";
import type { BankDraft } from "@/lib/domain/bank-drafts";

const reference = new Date("2026-11-05T10:00:00Z");

describe("export Excel de l’entreprise", () => {
  it("sauvegarde les propositions Qonto séparément sans les compter dans les encaissements", () => {
    const draft: BankDraft = {
      id: "draft", side: "credit", status: "pending", created_at: "2026-11-05", updated_at: "2026-11-05",
      payload: { title: "À vérifier", performedOn: "2026-11-05", completed: true, revenue: 99900, durationMinutes: 0, expenseDate: "2026-11-05", supplier: "", category: "", family: "variable", vatRateBasisPoints: 0, vatRecoverable: false, notes: "" },
      transaction: { id: "bank", remote_id: "remote", account_name: "Principal", label: "Encaissement", counterparty: "Client", reference: "", amount_cents: 99900, currency: "EUR", side: "credit", status: "completed", settled_at: "2026-11-05T08:00:00Z", emitted_at: "2026-11-05T08:00:00Z", operation_type: "transfer", reconciliation: "unmatched", payment_id: null, expense_id: null, expense_month: null, created_entry: false, ignored_reason: null },
    };
    const before = buildExportWorkbook(demoSeed, { exportedAt: reference });
    const after = buildExportWorkbook(demoSeed, { exportedAt: reference, bankDrafts: [draft] });
    expect(after.getWorksheet("Brouillons Qonto")!.getCell("B5").value).toBe("À valider — hors statistiques");
    expect(after.getWorksheet("Brouillons Qonto")!.getCell("F5").value).toBe(999);
    expect(after.getWorksheet("Synthèse")!.getCell("B5").value).toBe(before.getWorksheet("Synthèse")!.getCell("B5").value);
    expect(after.getWorksheet("Paiements")!.rowCount).toBe(before.getWorksheet("Paiements")!.rowCount);
  });
  it("conserve les tables métier et les sous-lignes dans des feuilles filtrables", () => {
    const book = buildExportWorkbook(demoSeed, { exportedAt: reference });
    expect(book.worksheets[0]?.name).toBe("Synthèse");
    for (const [name, count] of [
      ["Clients", demoSeed.clients.length], ["Prestations", demoSeed.interventions.length],
      ["Paiements", demoSeed.payments.length], ["Charges", demoSeed.expenses.length],
      ["Messages accessibles", demoSeed.messages.length],
      ["Lignes prestations", demoSeed.interventions.flatMap((item) => item.items).length],
      ["Affectations", demoSeed.interventions.flatMap((item) => item.workers).length],
      ["Tarifs formules", demoSeed.services.flatMap((item) => item.prices).length],
    ] as const) {
      const sheet = book.getWorksheet(name)!;
      expect(sheet.rowCount).toBe(count + 4);
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 4 });
    }
  });

  it("utilise de vrais nombres en euros et des dates Excel", () => {
    const sheet = buildExportWorkbook(demoSeed, { exportedAt: reference }).getWorksheet("Paiements")!;
    expect(sheet.getCell("A5").value).toBeInstanceOf(Date);
    expect(sheet.getCell("F5").value).toBe(demoSeed.payments[0]!.amount / 100);
    expect(sheet.getCell("F5").numFmt).toContain("€");
  });

  it("compte une seule fois le forfait et retrouve son client sans le confondre avec une visite", () => {
    const data = structuredClone(demoSeed);
    const client = data.clients[0]!;
    data.maintenanceContracts = [{ ...data.interventions[0]!, id: "contract", clientId: client.id, title: "Forfait test", status: "active", billingFrequency: "prepaid", billingAmount: 60_000, termMonths: 6, renewalReminderDays: 30, vehicleCount: 1, firstVisitOn: "2026-11-05", visitDay: 5, preferredStartTime: "09:00", assignedMemberIds: [], notes: "" }];
    data.payments = [{ ...data.payments[0]!, id: "paid", invoiceId: undefined, interventionId: undefined, maintenanceContractId: "contract", maintenanceBillingPeriodId: "period", amount: 60_000, paidAt: reference.toISOString() }];
    const book = buildExportWorkbook(data, { exportedAt: reference });
    const payments = book.getWorksheet("Paiements")!;
    expect(payments.getCell("B5").value).toBe(client.company || `${client.firstName} ${client.lastName}`.trim());
    expect(payments.getCell("D5").value).toBe("Forfait test");
    expect(payments.getCell("E5").value).toBeNull();
    expect(book.getWorksheet("Synthèse")!.getCell("B5").value).toBe(600);
    const monthly = book.getWorksheet("Bilan mensuel")!;
    const row = [...Array(monthly.rowCount)].map((_, i) => monthly.getRow(i + 1)).find((entry) => (entry.getCell(1).value as Date)?.toISOString?.().startsWith("2026-11"));
    expect(row?.getCell(3).value).toBe(600);
  });

  it("préserve les téléphones et les saisies ressemblant à des formules comme du texte", async () => {
    const data = structuredClone(demoSeed);
    data.clients[0]!.company = '=HYPERLINK("https://invalid.example")';
    data.clients[0]!.phone = "0612345678";
    const bytes = await exportWorkspaceExcel(data, { exportedAt: reference });
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(bytes);
    const sheet = restored.getWorksheet("Clients")!;
    expect(sheet.getCell("A5").value).toBe(data.clients[0]!.company);
    expect(sheet.getCell("E5").value).toBe("0612345678");
    expect(restored.getWorksheet("Paiements")!.getCell("A5").value).toBeInstanceOf(Date);
  });

  it("convertit les heures de Paris en hiver et en été sans changer les dates civiles", () => {
    expect(excelDate("2026-11-05T23:30:00Z")?.toISOString()).toBe("2026-11-06T00:30:00.000Z");
    expect(excelDate("2026-07-05T23:30:00Z")?.toISOString()).toBe("2026-07-06T01:30:00.000Z");
    expect(excelDate("2026-11-05")?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("exporte un espace vide sans erreur", () => {
    const data = structuredClone(demoSeed);
    for (const key of Object.keys(data) as Array<keyof typeof data>) if (Array.isArray(data[key])) Object.assign(data, { [key]: [] });
    const book = buildExportWorkbook(data, { exportedAt: reference });
    expect(book.getWorksheet("Paiements")!.rowCount).toBe(4);
    expect(book.getWorksheet("Synthèse")!.getCell("B5").value).toBe(0);
  });
});
