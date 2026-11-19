import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), admin: vi.fn(), decrypt: vi.fn(), read: vi.fn(), eq: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: (role: string) => ["admin", "partner"].includes(role) }));
vi.mock("@/lib/integrations/token-crypto", () => ({ decryptToken: mocks.decrypt }));
import { GET } from "./route";

const request = () => new Request("https://app.test/api/integrations/qonto/balance");
const organization = { id: "remote-org", bank_accounts: [{ iban: "private-iban", currency: "EUR", status: "active", balance_cents: 123456, authorized_balance_cents: 120000 }] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "local-org" });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.read });
  mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: mocks.eq }) }) });
  mocks.read.mockResolvedValue({ data: { credentials_encrypted: "private-ciphertext", enabled: true, remote_organization_id: "remote-org" }, error: null });
  mocks.decrypt.mockReturnValue(JSON.stringify({ login: "private-login", secret: "private-secret" }));
});
afterEach(() => vi.unstubAllGlobals());

it("réserve le solde aux associés/admins et refuse une session expirée avant toute lecture bancaire", async () => {
  mocks.workspace.mockResolvedValueOnce({ role: "employee" }).mockRejectedValueOnce(new Error("Authentification requise."));
  expect((await GET(request())).status).toBe(403);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.decrypt).not.toHaveBeenCalled();
});
it("respecte une connexion absente ou en pause sans appeler Qonto", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  mocks.read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { credentials_encrypted: "private", enabled: false } });
  expect(await (await GET(request())).json()).toEqual({ state: "not_connected" });
  expect(await (await GET(request())).json()).toEqual({ state: "paused" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("relit le solde de l’entreprise active sans cache ni données sensibles dans la réponse", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ organization })));
  vi.stubGlobal("fetch", fetchMock);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith("organization_id", "local-org");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body).toMatchObject({ state: "ready", balance: { balanceCents: 123456, availableCents: 120000, accountCount: 1 }, fetchedAt: expect.any(String) });
  expect(JSON.stringify(body)).not.toContain("private-");
  expect(fetchMock).toHaveBeenCalledWith("https://thirdparty.qonto.com/v2/organization?include_external_accounts=false", expect.objectContaining({ method: "GET", cache: "no-store", redirect: "error" }));
  await GET(request());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("ne retourne ni zéro ni solde partiel lorsqu’un compte est invalide ou appartient à une autre entreprise", async () => {
  for (const data of [{ ...organization, id: "other-org" }, { ...organization, bank_accounts: [{ ...organization.bank_accounts[0], balance_cents: null }] }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ organization: data }))));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining("n’a pas pu être actualisé") });
  }
});
it("distingue l’absence de compte du refus d’accès distant et des limites d’actualisation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ organization: { ...organization, bank_accounts: [] } })))
    .mockResolvedValueOnce(new Response("private-body", { status: 403 })).mockResolvedValueOnce(new Response("private-body", { status: 429 })));
  expect(await (await GET(request())).json()).toEqual({ state: "no_accounts" });
  const denied = await GET(request());
  expect(denied.status).toBe(502);
  expect(await denied.json()).toEqual({ error: expect.stringContaining("Qonto refuse l’accès au solde") });
  expect((await GET(request())).status).toBe(503);
});
it("masque les erreurs techniques de déchiffrement", async () => {
  mocks.decrypt.mockImplementation(() => { throw new Error("private-key"); });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-");
});
