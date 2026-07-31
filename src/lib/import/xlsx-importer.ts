import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { normalizePhone, normalizeText } from "@/lib/utils";

export interface HistoricalClientRow {
  legacyRow: number;
  firstName: string;
  lastName: string;
  company?: string;
  email: string;
  phone: string;
  city: string;
  source: string;
}

export interface HistoricalInterventionRow {
  legacyRow: number;
  clientKey: string;
  clientName: string;
  serviceLabel: string;
  interventionDate?: string;
  revenueCents: number;
  actualMinutes: number;
  productCostCents: number;
  travelCostCents: number;
  source: string;
  notes: string;
}

export interface HistoricalExpenseRow {
  legacyRow: number;
  date?: string;
  family: "fixed" | "variable" | "investment" | "personal";
  category: string;
  supplier: string;
  description: string;
  amountCents: number;
  paid: boolean;
  recurrence: "monthly" | "annual" | "one_off";
}

export interface HistoricalObjectiveRow {
  legacyRow: number;
  month?: string;
  revenueTargetCents: number;
  interventionTarget: number;
  averageBasketTargetCents: number;
  hourlyMarginTargetCents: number;
  reviewTarget: number;
}

export interface HistoricalLeadRow {
  legacyRow: number;
  prospectName: string;
  phone: string;
  serviceLabel: string;
  source: string;
  amountCents: number;
  stage: string;
}

export interface HistoricalImportPreview {
  fileName: string;
  fileHash: string;
  sheets: Array<{ name: string; detectedKind: string; rows: number }>;
  totals: { rows: number; clients: number; interventions: number; expenses: number; objectives: number; leads: number };
  duplicateCandidates: Array<{ rows: number[]; reason: string; value: string }>;
  errors: Array<{ sheet: string; row: number; field: string; message: string }>;
  warnings: string[];
  normalized: {
    clients: HistoricalClientRow[];
    interventions: HistoricalInterventionRow[];
    expenses: HistoricalExpenseRow[];
    objectives: HistoricalObjectiveRow[];
    leads: HistoricalLeadRow[];
  };
}

type RowRecord = Record<string, unknown>;

function rawCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
  }
  return value;
}

export function parseExcelDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && value > 1) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.round(value * 86_400_000));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const french = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (french) {
      const yearValue = Number(french[3]);
      const year = yearValue < 100 ? 2000 + yearValue : yearValue;
      const date = new Date(Date.UTC(year, Number(french[2]) - 1, Number(french[1]), 12));
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function cents(value: unknown): number {
  if (typeof value === "number") return Math.round(value * 100);
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/\s/g, "").replace(/€/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(",", ".")) || 0;
  return 0;
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function boolValue(value: unknown): boolean {
  return /^(oui|yes|true|1|pay[eé]e?)$/i.test(textValue(value));
}

function findHeaderRow(sheet: ExcelJS.Worksheet) {
  let best = { row: 1, score: 0 };
  for (let row = 1; row <= Math.min(sheet.rowCount, 25); row += 1) {
    const values = sheet.getRow(row).values as unknown[];
    const score = values.filter((value) => /client|date|montant|prix|statut|prestation|cat[eé]gorie|source|objectif/i.test(textValue(value))).length;
    if (score > best.score) best = { row, score };
  }
  return best.row;
}

function sheetRows(sheet: ExcelJS.Worksheet) {
  const headerRow = findHeaderRow(sheet);
  const headers = (sheet.getRow(headerRow).values as unknown[]).map((value) => normalizeText(textValue(value)));
  const rows: Array<{ row: number; record: RowRecord }> = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record: RowRecord = {};
    headers.forEach((header, index) => { if (header) record[header] = rawCellValue(row.getCell(index)); });
    if (Object.values(record).some((value) => textValue(value))) rows.push({ row: rowNumber, record });
  }
  return rows;
}

function pick(record: RowRecord, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (aliases.some((alias) => key === normalizeText(alias) || key.includes(normalizeText(alias)))) return value;
  }
  return undefined;
}

function nameParts(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? "À vérifier", lastName: "" };
  return { firstName: parts.shift() ?? "", lastName: parts.join(" ") };
}

function detectSheetKind(name: string) {
  const normalized = normalizeText(name);
  if (normalized.includes("prestation")) return "interventions";
  if (normalized.includes("charge") || normalized.includes("depense")) return "expenses";
  if (normalized.includes("objectif")) return "objectives";
  if (normalized.includes("pipeline") || normalized.includes("commercial")) return "leads";
  if (normalized.includes("invest")) return "assets";
  if (normalized.includes("capacite") || normalized.includes("planning")) return "capacity_snapshots";
  if (normalized.includes("parametre")) return "settings";
  if (normalized.includes("dashboard") || normalized.includes("synthese")) return "ignored_summary";
  return "unknown";
}

export async function previewHistoricalWorkbook(buffer: ArrayBuffer, fileName: string): Promise<HistoricalImportPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const clients: HistoricalClientRow[] = [];
  const interventions: HistoricalInterventionRow[] = [];
  const expenses: HistoricalExpenseRow[] = [];
  const objectives: HistoricalObjectiveRow[] = [];
  const leads: HistoricalLeadRow[] = [];
  const errors: HistoricalImportPreview["errors"] = [];
  const warnings: string[] = [];
  const sheets: HistoricalImportPreview["sheets"] = [];

  workbook.eachSheet((sheet) => {
    const kind = detectSheetKind(sheet.name);
    const rows = sheetRows(sheet);
    sheets.push({ name: sheet.name, detectedKind: kind, rows: rows.length });
    if (kind === "ignored_summary") return;
    if (kind === "unknown") { warnings.push(`Onglet « ${sheet.name} » non reconnu et ignoré.`); return; }
    rows.forEach(({ row, record }) => {
      if (kind === "interventions") {
        const combinedName = textValue(pick(record, ["client", "nom client"]));
        const firstName = textValue(pick(record, ["prenom"])) || nameParts(combinedName).firstName;
        const lastName = textValue(pick(record, ["nom"])) || nameParts(combinedName).lastName;
        const company = textValue(pick(record, ["societe", "entreprise"])) || undefined;
        const email = textValue(pick(record, ["email", "e mail"])).toLowerCase();
        const phone = normalizePhone(textValue(pick(record, ["telephone", "tel"])));
        const clientName = company || `${firstName} ${lastName}`.trim();
        if (!clientName) { errors.push({ sheet: sheet.name, row, field: "client", message: "Client manquant" }); return; }
        const key = email || phone || normalizeText(clientName);
        clients.push({ legacyRow: row, firstName, lastName, company, email, phone, city: textValue(pick(record, ["ville"])), source: textValue(pick(record, ["source"])) || "Import historique" });
        const date = parseExcelDate(pick(record, ["date intervention", "date de prestation", "date"]));
        if (pick(record, ["date intervention", "date de prestation"]) && !date) errors.push({ sheet: sheet.name, row, field: "date", message: "Date invalide" });
        interventions.push({ legacyRow: row, clientKey: key, clientName, serviceLabel: textValue(pick(record, ["formule", "prestation", "service"])) || "Prestation historique", interventionDate: date, revenueCents: cents(pick(record, ["prix ttc", "montant ttc", "prix"])), actualMinutes: Math.round(numberValue(pick(record, ["temps intervention", "duree", "temps"])) * 60), productCostCents: cents(pick(record, ["frais produits", "cout produits", "produits"])), travelCostCents: cents(pick(record, ["frais deplacement", "deplacement"])), source: textValue(pick(record, ["source"])), notes: textValue(pick(record, ["commentaire", "notes"])) });
      } else if (kind === "expenses") {
        const date = parseExcelDate(pick(record, ["date"]));
        if (!date) errors.push({ sheet: sheet.name, row, field: "date", message: "Date manquante ou invalide" });
        const familyText = normalizeText(textValue(pick(record, ["famille"])));
        const family = familyText.includes("invest") ? "investment" : familyText.includes("fix") ? "fixed" : familyText.includes("person") ? "personal" : "variable";
        const recurrenceText = normalizeText(textValue(pick(record, ["recurrence"])));
        expenses.push({ legacyRow: row, date, family, category: textValue(pick(record, ["categorie"])) || "À classer", supplier: textValue(pick(record, ["fournisseur"])), description: textValue(pick(record, ["description", "libelle"])) || "Charge importée", amountCents: cents(pick(record, ["montant ttc", "ttc", "montant"])), paid: boolValue(pick(record, ["paye", "payee", "statut paiement"])), recurrence: recurrenceText.includes("mens") ? "monthly" : recurrenceText.includes("annu") ? "annual" : "one_off" });
      } else if (kind === "objectives") {
        const date = parseExcelDate(pick(record, ["mois", "date"]));
        objectives.push({ legacyRow: row, month: date?.slice(0, 7), revenueTargetCents: cents(pick(record, ["ca objectif", "objectif ca"])), interventionTarget: Math.round(numberValue(pick(record, ["prestations cible", "nombre prestations cible"]))), averageBasketTargetCents: cents(pick(record, ["panier moyen cible"])), hourlyMarginTargetCents: cents(pick(record, ["marge horaire"])), reviewTarget: Math.round(numberValue(pick(record, ["avis cible"]))) });
      } else if (kind === "leads") {
        const prospectName = textValue(pick(record, ["client", "prospect", "nom"]));
        if (!prospectName) return;
        leads.push({ legacyRow: row, prospectName, phone: normalizePhone(textValue(pick(record, ["telephone", "tel"]))), serviceLabel: textValue(pick(record, ["prestation envisagee", "prestation"])), source: textValue(pick(record, ["source"])) || "Import historique", amountCents: cents(pick(record, ["montant devis", "montant"])), stage: textValue(pick(record, ["statut commercial", "statut"])) });
      }
    });
  });

  const uniqueClients = [...new Map(clients.map((client) => [client.email || client.phone || normalizeText(`${client.company ?? ""} ${client.firstName} ${client.lastName}`), client])).values()];
  const groups = new Map<string, number[]>();
  clients.forEach((client) => {
    const key = client.email ? `email:${client.email}` : client.phone ? `phone:${client.phone}` : `name:${normalizeText(`${client.company ?? ""} ${client.firstName} ${client.lastName}`)}`;
    groups.set(key, [...(groups.get(key) ?? []), client.legacyRow]);
  });
  const duplicateCandidates = [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ rows, reason: key.split(":")[0] === "email" ? "Même e-mail" : key.split(":")[0] === "phone" ? "Même téléphone" : "Même nom normalisé", value: key.slice(key.indexOf(":") + 1) }));
  return {
    fileName,
    fileHash: createHash("sha256").update(Buffer.from(buffer)).digest("hex"),
    sheets,
    totals: { rows: sheets.reduce((sum, sheet) => sum + sheet.rows, 0), clients: uniqueClients.length, interventions: interventions.length, expenses: expenses.length, objectives: objectives.length, leads: leads.length },
    duplicateCandidates,
    errors,
    warnings,
    normalized: { clients: uniqueClients, interventions, expenses, objectives, leads },
  };
}

