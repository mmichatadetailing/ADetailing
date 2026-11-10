import { expect, it } from "vitest";
import { listQontoInvoices, qontoInvoiceDaysLate, qontoInvoiceStatus, qontoOverdueEuroTotal, type QontoInvoice } from "./qonto-invoices";

const invoice: QontoInvoice = { id: "one", number: "F-2026-101", clientName: "Élodie Martin", issueDate: "2026-11-02", dueDate: "2026-11-09", status: "unpaid", currency: "EUR", total: "150", remaining: "75" };
const today = "2026-11-10";

it("ne signale comme en retard que les impayés dont le jour d’échéance est passé", () => {
  expect(qontoInvoiceStatus(invoice, today)).toBe("overdue");
  expect(qontoInvoiceStatus({ ...invoice, dueDate: today }, today)).toBe("unpaid");
  expect(qontoInvoiceStatus({ ...invoice, dueDate: "2026-11-11" }, today)).toBe("unpaid");
  expect(qontoInvoiceStatus({ ...invoice, dueDate: null }, today)).toBe("unpaid");
  for (const status of ["paid", "draft", "canceled"] as const) expect(qontoInvoiceStatus({ ...invoice, status }, today)).toBe(status);
  expect(qontoInvoiceStatus({ ...invoice, status: "future-status" }, today)).toBe("unknown");
});

it("compte les jours calendaires, y compris lors du changement d’heure", () => {
  expect(qontoInvoiceDaysLate("2026-10-24", "2026-10-26")).toBe(2);
  expect(qontoInvoiceDaysLate(invoice.dueDate!, today)).toBe(1);
});

it("additionne uniquement les soldes connus des factures en retard en euros", () => {
  expect(qontoOverdueEuroTotal([
    { ...invoice, remaining: "75.10" },
    { ...invoice, id: "second", remaining: "0.21" },
    { ...invoice, id: "missing", remaining: null },
    { ...invoice, id: "usd", currency: "USD" },
    { ...invoice, id: "today", dueDate: today },
    { ...invoice, id: "paid", status: "paid" },
    { ...invoice, id: "canceled", status: "canceled" },
  ], today)).toEqual({ amount: "75.31", missing: 1, nonEuro: 1 });
});

it("distingue l’absence de retard d’un solde non communiqué", () => {
  expect(qontoOverdueEuroTotal([], today)).toEqual({ amount: "0", missing: 0, nonEuro: 0 });
  expect(qontoOverdueEuroTotal([{ ...invoice, remaining: null }], today)).toEqual({ amount: null, missing: 1, nonEuro: 0 });
});

it("trie les retards les plus anciens en premier et filtre par client ou numéro", () => {
  const upcoming = { ...invoice, id: "upcoming", dueDate: today };
  const older = { ...invoice, id: "older", number: "F-2026-100", dueDate: "2026-11-07" };
  const paid = { ...invoice, id: "paid", status: "paid", dueDate: "2026-11-03" };
  const list = [upcoming, paid, invoice, older];
  expect(listQontoInvoices(list, today, "all", "", "priority").map(({ invoice }) => invoice.id)).toEqual(["older", "one", "upcoming", "paid"]);
  expect(listQontoInvoices(list, today, "overdue", "elodie F-2026-101", "priority").map(({ invoice }) => invoice.id)).toEqual(["one"]);
  expect(listQontoInvoices(list, today, "unpaid", "", "priority")).toHaveLength(3);
  expect(listQontoInvoices(list, today, "all", "", "due")[0]?.invoice.id).toBe("paid");
});
