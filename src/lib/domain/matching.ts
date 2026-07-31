import type { Invoice, Quote } from "./types";

export interface MatchScore {
  quoteId: string;
  score: number;
  reasons: string[];
}

export function scoreQuoteForInvoice(invoice: Invoice, quote: Quote): MatchScore {
  let score = 0;
  const reasons: string[] = [];
  if (invoice.clientId === quote.clientId) { score += 45; reasons.push("Même client"); }
  const amountDelta = Math.abs(invoice.totalIncludingTax - quote.totalIncludingTax);
  const amountRate = amountDelta / Math.max(invoice.totalIncludingTax, quote.totalIncludingTax, 1);
  if (amountRate === 0) { score += 35; reasons.push("Même montant"); }
  else if (amountRate <= 0.05) { score += 25; reasons.push("Montant proche"); }
  const days = Math.abs(new Date(invoice.issuedAt).getTime() - new Date(quote.issuedAt).getTime()) / 86_400_000;
  if (days <= 45) { score += 10; reasons.push("Dates cohérentes"); }
  const invoiceWords = new Set(invoice.lines.flatMap((line) => line.designation.toLowerCase().split(/\W+/)).filter((word) => word.length > 3));
  const quoteWords = new Set(quote.lines.flatMap((line) => line.designation.toLowerCase().split(/\W+/)).filter((word) => word.length > 3));
  if ([...invoiceWords].some((word) => quoteWords.has(word))) { score += 10; reasons.push("Prestations similaires"); }
  return { quoteId: quote.id, score, reasons };
}

