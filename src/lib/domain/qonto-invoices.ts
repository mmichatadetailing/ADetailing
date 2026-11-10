import Decimal from "decimal.js";
import { financialDateKey } from "./periods";
import { normalizeText } from "@/lib/utils";

export interface QontoInvoice {
  id: string;
  number: string | null;
  clientName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  status: string;
  currency: string | null;
  total: string | null;
  remaining: string | null;
}

export type QontoInvoiceFeed = { state: "ready"; invoices: QontoInvoice[]; fetchedAt: string }
  | { state: "not_connected" | "paused" };
export type QontoInvoiceStatus = "overdue" | "unpaid" | "paid" | "draft" | "canceled" | "unknown";
export type QontoInvoiceFilter = "all" | Exclude<QontoInvoiceStatus, "unknown">;
export type QontoInvoiceOrder = "priority" | "due" | "recent";

export function qontoInvoiceStatus(invoice: QontoInvoice, today = financialDateKey(new Date().toISOString())): QontoInvoiceStatus {
  if (invoice.status === "unpaid") return invoice.dueDate && invoice.dueDate < today ? "overdue" : "unpaid";
  if (invoice.status === "paid" || invoice.status === "draft" || invoice.status === "canceled") return invoice.status;
  return "unknown";
}

export function qontoInvoiceDaysLate(dueDate: string, today: string) {
  // Les deux valeurs sont des jours civils : le décompte ne dépend pas des changements d’heure.
  return Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
}

export function qontoInvoiceMatchesFilter(status: QontoInvoiceStatus, filter: QontoInvoiceFilter) {
  return filter === "all" || status === filter || (filter === "unpaid" && status === "overdue");
}

export function qontoOverdueEuroTotal(invoices: QontoInvoice[], today: string) {
  let amount = new Decimal(0);
  let known = 0;
  let missing = 0;
  let nonEuro = 0;
  for (const invoice of invoices) {
    if (qontoInvoiceStatus(invoice, today) !== "overdue") continue;
    if (invoice.currency !== "EUR") { nonEuro++; continue; }
    if (invoice.remaining === null) { missing++; continue; }
    amount = amount.plus(invoice.remaining);
    known++;
  }
  return { amount: missing > 0 && known === 0 ? null : amount.toFixed(), missing, nonEuro };
}

export function listQontoInvoices(invoices: QontoInvoice[], today: string, filter: QontoInvoiceFilter, query: string, order: QontoInvoiceOrder) {
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  const priority: Record<QontoInvoiceStatus, number> = { overdue: 0, unpaid: 1, paid: 2, draft: 3, canceled: 4, unknown: 5 };
  return invoices.map((invoice) => ({ invoice, status: qontoInvoiceStatus(invoice, today) })).filter(({ invoice, status }) => {
    const searchable = normalizeText(`${invoice.clientName ?? ""} ${invoice.number ?? ""}`);
    return qontoInvoiceMatchesFilter(status, filter) && tokens.every((token) => searchable.includes(token));
  }).sort((a, b) => {
    const recent = (b.invoice.issueDate ?? "").localeCompare(a.invoice.issueDate ?? "");
    const byDue = (a.invoice.dueDate ?? "9999").localeCompare(b.invoice.dueDate ?? "9999");
    if (order === "recent") return recent;
    if (order === "due") return byDue || recent;
    return priority[a.status] - priority[b.status]
      || (a.status === "overdue" || a.status === "unpaid" ? byDue : 0) || recent;
  });
}
