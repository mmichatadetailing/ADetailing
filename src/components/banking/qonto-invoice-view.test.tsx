import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QontoInvoiceList } from "./qonto-invoice-view";
import type { QontoInvoice } from "@/lib/domain/qonto-invoices";

const late: QontoInvoice = { id: "late", number: "F-RETARD", clientName: "Client A", status: "unpaid", dueDate: "2026-11-09", issueDate: "2026-11-02", currency: "EUR", total: "150", remaining: "75" };

it("met en tête les retards et distingue une échéance du jour et les factures payées", () => {
  const html = renderToStaticMarkup(<QontoInvoiceList today="2026-11-10" invoices={[
    { ...late, id: "paid", number: "F-PAYÉE", status: "paid", remaining: "0" },
    { ...late, id: "today", number: "F-DUJOUR", dueDate: "2026-11-10" },
    late,
  ]} />);
  expect(html).toContain("1 jour de retard");
  expect(html).toContain("Aujourd’hui");
  expect(html).toContain("Payée");
  expect(html).toContain("Reste à encaisser");
  expect(html.indexOf("F-RETARD")).toBeLessThan(html.indexOf("F-DUJOUR"));
  expect(html.indexOf("F-DUJOUR")).toBeLessThan(html.indexOf("F-PAYÉE"));
});
