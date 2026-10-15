import { normalizePhone, normalizeText } from "@/lib/utils";
import type { Client, Invoice, Quote } from "./types";

export type DuplicateClientPair = [Client, Client, "Même e-mail" | "Même téléphone" | "Même nom ou société"];

export function findDuplicateClientPairs(clients: Client[]): DuplicateClientPair[] {
  const activeClients = clients.filter((client) => !client.archivedAt);
  const pairs: DuplicateClientPair[] = [];

  activeClients.forEach((client, index) => {
    activeClients.slice(index + 1).forEach((other) => {
      const email = normalizeText(client.email);
      const otherEmail = normalizeText(other.email);
      const phone = normalizePhone(client.phone);
      const otherPhone = normalizePhone(other.phone);
      const company = normalizeText(client.company ?? "");
      const otherCompany = normalizeText(other.company ?? "");
      const name = normalizeText(`${client.firstName} ${client.lastName}`);
      const otherName = normalizeText(`${other.firstName} ${other.lastName}`);
      const sameEmail = Boolean(email) && email === otherEmail;
      const samePhone = Boolean(phone) && phone === otherPhone;
      const sameIdentity = (Boolean(company) && company === otherCompany) || (Boolean(name) && name === otherName);

      if (sameEmail || samePhone || sameIdentity) {
        pairs.push([
          client,
          other,
          sameEmail ? "Même e-mail" : samePhone ? "Même téléphone" : "Même nom ou société",
        ]);
      }
    });
  });

  return pairs;
}

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

