import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), admin: vi.fn(), decrypt: vi.fn(), read: vi.fn(), eq: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: (role: string) => ["admin", "partner"].includes(role) }));
vi.mock("@/lib/integrations/token-crypto", () => ({ decryptToken: mocks.decrypt }));
import { GET } from "./route";

const request = () => new Request("https://app.test/api/integrations/qonto/invoices");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "local-org" });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.read });
  mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: mocks.eq }) }) });
  mocks.read.mockResolvedValue({ data: { credentials_encrypted: "private-ciphertext", enabled: true, remote_organization_id: "remote-org" }, error: null });
  mocks.decrypt.mockReturnValue(JSON.stringify({ login: "private-login", secret: "private-secret" }));
});
afterEach(() => vi.unstubAllGlobals());

it("refuse les employés et les sessions expirées avant la lecture des identifiants", async () => {
  mocks.workspace.mockResolvedValueOnce({ role: "employee" }).mockRejectedValueOnce(new Error("Authentification requise."));
  expect((await GET(request())).status).toBe(403);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.decrypt).not.toHaveBeenCalled();
});

it("ne contacte pas Qonto lorsque la connexion manque ou est en pause", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mocks.read.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { credentials_encrypted: "encrypted", enabled: false }, error: null });
  expect(await (await GET(request())).json()).toEqual({ state: "not_connected" });
  expect(await (await GET(request())).json()).toEqual({ state: "paused" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("consulte seulement les factures de l’entreprise active, sans exposer les secrets", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_invoices: [{ id: "q1", organization_id: "remote-org", status: "paid" }], meta: { next_page: null } }))));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith("organization_id", "local-org");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const payload = await response.json();
  expect(payload).toMatchObject({ state: "ready", invoices: [{ id: "q1", status: "paid" }], fetchedAt: expect.any(String) });
  expect(JSON.stringify(payload)).not.toContain("private-");
});

it("distingue le refus de Qonto d’une expiration de session interne", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-response", { status: 403 })));
  const response = await GET(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: expect.stringContaining("Qonto refuse l’accès") });
});
