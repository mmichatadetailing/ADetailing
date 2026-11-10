import { z } from "zod";
import Decimal from "decimal.js";
import type { QontoInvoice } from "@/lib/domain/qonto-invoices";
import { downloadQontoInvoicePdf, unavailableInvoicePdf } from "@/lib/integrations/qonto-invoice-pdf";
const remoteTransaction = z.object({
  transaction_id: z.string().min(1).optional(), id: z.string().min(1), amount_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string(), side: z.enum(["credit", "debit"]), status: z.enum(["pending", "completed", "declined", "reversed"]),
  settled_at: z.string().nullable(), emitted_at: z.string(), updated_at: z.string(),
  label: z.string().nullable().optional(), clean_counterparty_name: z.string().nullable().optional(), reference: z.string().nullable().optional(), operation_type: z.string(),
  transfer: z.object({ counterparty_account_number: z.string().nullable().optional() }).nullable().optional(),
});
export type QontoRemoteTransaction = z.infer<typeof remoteTransaction>;
export interface QontoAccount { id: string; iban: string; name: string; currency: string }

const money = z.object({ value: z.string().nullish(), currency: z.string().nullish() }).nullish();
const invoicePage = z.object({
  client_invoices: z.array(z.object({
    id: z.string().min(1), organization_id: z.string().nullish(), number: z.string().nullish(), status: z.string().min(1),
    client: z.object({ name: z.string().nullish(), first_name: z.string().nullish(), last_name: z.string().nullish() }).nullish(),
    issue_date: z.string().nullish(), due_date: z.string().nullish(), currency: z.string().nullish(),
    total_amount: money, total_amount_cents: z.number().int().nullish(), amount_paid: money,
  })),
  meta: z.object({ next_page: z.number().int().positive().nullable() }),
});
const dateSchema = z.iso.date();
const invoiceDetail = z.object({ client_invoice: z.object({
  id: z.uuid(), organization_id: z.string(), attachment_id: z.uuid().nullish(),
}) });
const invoiceAttachment = z.object({ attachment: z.object({ id: z.uuid(), url: z.string().nullish() }) });
function invoiceDate(value: string | null | undefined) { return dateSchema.safeParse(value).data ?? null; }
function invoiceAmount(value: string | null | undefined) {
  return value && value.length <= 32 && /^-?\d+(?:\.\d+)?$/.test(value) ? new Decimal(value) : null;
}

export class QontoRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class QontoClient {
  constructor(private readonly login: string, private readonly secret: string) {}
  private async get(path: string, params?: URLSearchParams, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetch(`https://thirdparty.qonto.com/v2/${path}${params ? `?${params}` : ""}`, {
      method: "GET", headers: { Authorization: `${this.login}:${this.secret}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new QontoRequestError(response.status, "Qonto refuse l’accès. Vérifiez l’identifiant et la clé API.");
      if (response.status === 429) throw new QontoRequestError(response.status, "Limite Qonto atteinte. Réessayez dans quelques minutes.");
      throw new QontoRequestError(response.status, `Qonto est momentanément indisponible (code ${response.status}).`);
    }
    return response.json();
  }
  async organization() {
    const result = z.object({ organization: z.object({ id: z.string(), legal_name: z.string(), bank_accounts: z.array(z.object({ id: z.string().optional(), iban: z.string(), name: z.string(), currency: z.string(), status: z.string().optional() })) }) }).parse(await this.get("organization"));
    return { id: result.organization.id, name: result.organization.legal_name, accounts: result.organization.bank_accounts.filter((account) => account.currency === "EUR").map((account) => ({ ...account, id: account.id ?? account.iban })) };
  }
  async transactions(account: QontoAccount, from: string, to: string, page: number) {
    const params = new URLSearchParams({ iban: account.iban, updated_at_from: from, updated_at_to: to, sort_by: "updated_at:asc", per_page: "100", page: String(page) });
    ["pending", "completed", "declined", "reversed"].forEach((status) => params.append("status[]", status));
    return z.object({ transactions: z.array(remoteTransaction), meta: z.object({ next_page: z.number().nullable(), total_pages: z.number() }) }).parse(await this.get("transactions", params));
  }
  async clientInvoicePdf(id: string, organizationId: string, requestSignal: AbortSignal) {
    const invoiceId = z.uuid().parse(id);
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(40_000)]);
    try {
      const { client_invoice: invoice } = invoiceDetail.parse(await this.get(`client_invoices/${invoiceId}`, undefined, signal));
      if (invoice.organization_id !== organizationId || invoice.id !== invoiceId) throw unavailableInvoicePdf();
      if (!invoice.attachment_id) throw unavailableInvoicePdf();
      const { attachment } = invoiceAttachment.parse(await this.get(`attachments/${invoice.attachment_id}`, undefined, signal));
      if (attachment.id !== invoice.attachment_id || !attachment.url) throw unavailableInvoicePdf();
      return await downloadQontoInvoicePdf(attachment.url, signal);
    } catch (error) {
      if (error instanceof QontoRequestError && error.status === 404) throw unavailableInvoicePdf();
      throw error;
    }
  }
  async clientInvoices(organizationId: string, requestSignal?: AbortSignal) {
    const timeout = AbortSignal.timeout(38_000);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    const invoices = new Map<string, QontoInvoice>();
    let page = 1;
    for (;;) {
      const params = new URLSearchParams({ page: String(page), per_page: "100", sort_by: "created_at:desc", exclude_imported: "false" });
      const result = invoicePage.parse(await this.get("client_invoices", params, signal));
      for (const invoice of result.client_invoices) {
        if (invoice.organization_id && invoice.organization_id !== organizationId) throw new Error("Organisation Qonto incohérente.");
        const rawCurrency = invoice.total_amount?.currency || invoice.currency;
        const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
        const total = invoiceAmount(invoice.total_amount?.value)
          ?? (invoice.total_amount_cents == null ? null : new Decimal(invoice.total_amount_cents).div(100));
        const paid = currency && currency === invoice.amount_paid?.currency ? invoiceAmount(invoice.amount_paid.value) : null;
        const remaining = invoice.status === "paid" ? "0" : invoice.status === "unpaid" && total && paid && paid.gte(0)
          ? Decimal.max(total.minus(paid), 0).toFixed() : null;
        invoices.set(invoice.id, { id: invoice.id, number: invoice.number?.trim() || null,
          clientName: invoice.client?.name?.trim() || [invoice.client?.first_name, invoice.client?.last_name].filter(Boolean).join(" ").trim() || null,
          status: invoice.status, issueDate: invoiceDate(invoice.issue_date), dueDate: invoiceDate(invoice.due_date),
          currency, total: total?.toFixed() ?? null, remaining });
      }
      const next = result.meta.next_page;
      if (next === null) return Array.from(invoices.values());
      if (next !== page + 1 || next > 100) throw new Error("Pagination Qonto incomplète.");
      page = next;
    }
  }
}
