import { inferDiscount } from "@/lib/domain/calculations";

export interface ParsedHenrriLine {
  designation: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  netAmount: number;
  discount: number;
  discountRateBasisPoints: number;
  implicitDiscountDetected: boolean;
  vatRateBasisPoints: number;
}

export interface ParsedHenrriDocument {
  documentType: "quote" | "invoice" | "unknown";
  number?: string;
  date?: string;
  clientName?: string;
  company?: string;
  professional: boolean;
  title?: string;
  lines: ParsedHenrriLine[];
  totalExcludingTax?: number;
  totalTax?: number;
  totalIncludingTax?: number;
  dueDate?: string;
  paymentMethod?: string;
  paymentTerms?: string;
  confidence: Record<string, number>;
  missingFields: string[];
  warnings: string[];
  rawText: string;
}

const amountToCents = (value: string) => {
  const normalized = value.replace(/\s/g, "").replace(/€/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  return Math.round(Number(normalized) * 100);
};

const toIsoDate = (value: string) => {
  const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  return `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}T12:00:00.000Z`;
};

const extractTotal = (text: string, labels: string[]) => {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*:?\\s*([0-9][0-9 .]*[,.][0-9]{2})\\s*€?`, "i"));
    if (match?.[1]) return amountToCents(match[1]);
  }
  return undefined;
};

function extractLines(text: string): ParsedHenrriLine[] {
  const excluded = /total|tva|acompte|net à payer|montant|prix|désignation|échéance/i;
  return text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).flatMap((raw) => {
    if (excluded.test(raw)) return [];
    const amounts = [...raw.matchAll(/(?<![\d,.])([0-9]+(?:[ .][0-9]{3})*[,.][0-9]{2})\s*€/g)];
    if (amounts.length < 2) return [];
    const firstAmountIndex = amounts[0]?.index;
    if (firstAmountIndex === undefined) return [];
    const beforeAmounts = raw.slice(0, firstAmountIndex).trim();
    const quantityMatch = beforeAmounts.match(/^(.*?)(?:\s+(\d+(?:[,.]\d+)?))?$/);
    const designation = quantityMatch?.[1]?.replace(/\s+/g, " ").trim();
    if (!designation || designation.length < 3) return [];
    const quantity = quantityMatch?.[2] ? Number(quantityMatch[2].replace(",", ".")) : 1;
    const unitPrice = amountToCents(amounts[0]?.[1] ?? "0");
    const netAmount = amountToCents(amounts.at(-1)?.[1] ?? "0");
    const discount = inferDiscount(quantity, unitPrice, netAmount);
    return [{
      designation,
      quantity,
      unitPrice,
      netAmount,
      discount: discount.amount,
      discountRateBasisPoints: discount.rateBasisPoints,
      implicitDiscountDetected: discount.detected,
      vatRateBasisPoints: 0,
    }];
  });
}

export function parseHenrriText(rawText: string): ParsedHenrriDocument {
  const text = rawText.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const documentType = /\bdevis\b/i.test(text) ? "quote" : /\bfacture\b/i.test(text) ? "invoice" : "unknown";
  const numberPatterns = documentType === "quote"
    ? [/devis\s*(?:n[°ºo]\s*)?[:#-]?\s*([A-Z]?-?\d{2}-\d{2}-\d+)/i, /\b(I-\d{2}-\d{2}-\d+)\b/i]
    : [/facture\s*(?:n[°ºo]\s*)?[:#-]?\s*(\d{2}-\d{2}-\d+)/i, /\b(\d{2}-\d{2}-\d+)\b/i];
  const number = numberPatterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean);
  const dateMatch = text.match(/(?:date\s*(?:du document)?\s*:?\s*)?(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  const date = dateMatch?.[1] ? toIsoDate(dateMatch[1]) : undefined;
  const clientName = text.match(/(?:client|destinataire)\s*:\s*([^\r\n]+)/i)?.[1]?.trim();
  const company = text.match(/(?:société|raison sociale)\s*:\s*([^\r\n]+)/i)?.[1]?.trim();
  const siretPresent = /\bSIRET\b/i.test(text);
  const totalExcludingTax = extractTotal(text, ["total\\s+ht", "montant\\s+ht"]);
  const totalTax = extractTotal(text, ["total\\s+tva", "montant\\s+tva", "tva"]);
  const totalIncludingTax = extractTotal(text, ["total\\s+ttc", "net\\s+à\\s+payer", "total"]);
  const dueMatch = text.match(/(?:échéance|date limite)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  const paymentMethod = /virement/i.test(text) ? "Virement" : /carte/i.test(text) ? "Carte" : /espèces?/i.test(text) ? "Espèces" : /chèque/i.test(text) ? "Chèque" : undefined;
  const paymentTerms = /comptant/i.test(text) ? "Comptant" : undefined;
  const lines = extractLines(text);
  const missingFields: string[] = [];
  if (!number) missingFields.push("Numéro");
  if (!date) missingFields.push("Date du document");
  if (!clientName && !company) missingFields.push("Client ou société");
  if (totalIncludingTax === undefined) missingFields.push("Total TTC");
  if (!lines.length) missingFields.push("Lignes du document");
  const warnings = lines.filter((line) => line.implicitDiscountDetected).map((line) => `Remise implicite détectée sur « ${line.designation} » : ${(line.discountRateBasisPoints / 100).toFixed(2)} %.`);
  if (documentType === "invoice") warnings.push("Facture émise : le paiement reste à confirmer manuellement.");
  if (documentType === "unknown") warnings.push("Type de document non reconnu.");
  return {
    documentType,
    number,
    date,
    clientName,
    company,
    professional: Boolean(company || siretPresent),
    lines,
    totalExcludingTax,
    totalTax,
    totalIncludingTax,
    dueDate: dueMatch?.[1] ? toIsoDate(dueMatch[1]) : undefined,
    paymentMethod,
    paymentTerms,
    confidence: {
      documentType: documentType === "unknown" ? 0.2 : 0.99,
      number: number ? 0.98 : 0,
      date: date ? 0.95 : 0,
      client: clientName || company ? 0.8 : 0,
      lines: lines.length ? 0.82 : 0,
      totals: totalIncludingTax !== undefined ? 0.97 : 0,
    },
    missingFields,
    warnings,
    rawText,
  };
}
