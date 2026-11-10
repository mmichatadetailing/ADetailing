import { afterEach, expect, it, vi } from "vitest";
import { QontoClient } from "./qonto-client";
afterEach(() => vi.unstubAllGlobals());
it("utilise seulement GET côté Qonto et le bon en-tête d’authentification", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ organization: { id: "org", legal_name: "Entreprise", bank_accounts: [{ iban: "FR123", name: "Principal", currency: "EUR" }] } })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await new QontoClient("identifiant", "cle-secrete").organization();
  expect(result.accounts[0]?.id).toBe("FR123");
  expect(fetchMock).toHaveBeenCalledWith("https://thirdparty.qonto.com/v2/organization", expect.objectContaining({ method: "GET", headers: { Authorization: "identifiant:cle-secrete", Accept: "application/json" }, redirect: "error", cache: "no-store" }));
});
it("demande tous les statuts pour suivre les annulations et la pagination", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transactions: [], meta: { next_page: 2, total_pages: 2 } })));
  vi.stubGlobal("fetch", fetchMock);
  await new QontoClient("id", "secret").transactions({ id: "bank", iban: "FR123", name: "Compte", currency: "EUR" }, "2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z", 1);
  const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
  expect(url.searchParams.getAll("status[]")).toEqual(["pending", "completed", "declined", "reversed"]);
  expect(url.searchParams.get("updated_at_from")).toBe("2026-09-01T00:00:00Z");
  expect(url.searchParams.get("sort_by")).toBe("updated_at:asc");
});
it("n’expose jamais le corps d’une erreur Qonto ou les identifiants", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret et corps privé", { status: 401 })));
  await expect(new QontoClient("login", "secret").organization()).rejects.toThrow("Qonto refuse l’accès");
});

it("lit toutes les pages de factures clients, imports compris, et dédoublonne sur l’identifiant", async () => {
  const invoice = { id: "q1", organization_id: "org", number: "F-1", status: "unpaid", due_date: "2026-11-09", issue_date: "2026-11-02", client: { first_name: "Ada", last_name: "Martin", email: "private@qonto.test" }, currency: "EUR", total_amount: { value: "150.10", currency: "EUR" }, amount_paid: { value: "50.03", currency: "EUR" }, invoice_url: "https://pay.qonto.com/private" };
  const json = (client_invoices: object[], next_page: number | null) => new Response(JSON.stringify({ client_invoices, meta: { next_page } }));
  const fetchMock = vi.fn().mockResolvedValueOnce(json([invoice], 2)).mockResolvedValueOnce(json([invoice, { id: "q2", status: "draft", due_date: null, total_amount_cents: null }], null));
  vi.stubGlobal("fetch", fetchMock);
  const result = await new QontoClient("login", "secret").clientInvoices("org");
  expect(result).toEqual([
    { id: "q1", number: "F-1", status: "unpaid", dueDate: "2026-11-09", issueDate: "2026-11-02", clientName: "Ada Martin", currency: "EUR", total: "150.1", remaining: "100.07" },
    { id: "q2", number: null, status: "draft", dueDate: null, issueDate: null, clientName: null, currency: null, total: null, remaining: null },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [index, [url, request]] of fetchMock.mock.calls.entries()) {
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v2/client_invoices");
    expect(parsed.searchParams.get("page")).toBe(String(index + 1));
    expect(parsed.searchParams.get("exclude_imported")).toBe("false");
    expect(request).toMatchObject({ method: "GET", headers: { Authorization: "login:secret" }, cache: "no-store" });
  }
});

it("ne renvoie pas une liste partielle si Qonto répète la page ou renvoie une autre organisation", async () => {
  const client = new QontoClient("login", "secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ client_invoices: [], meta: { next_page: 1 } }))));
  await expect(client.clientInvoices("org")).rejects.toThrow("Pagination Qonto incomplète");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ client_invoices: [{ id: "q1", organization_id: "other", status: "unpaid" }], meta: { next_page: null } }))));
  await expect(client.clientInvoices("org")).rejects.toThrow("Organisation Qonto incohérente");
});
