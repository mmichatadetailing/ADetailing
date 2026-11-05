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
