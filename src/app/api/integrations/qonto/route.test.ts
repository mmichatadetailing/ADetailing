import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), admin: vi.fn(), context: vi.fn(), rpc: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: (role: string) => ["partner", "admin"].includes(role) }));
vi.mock("@/lib/integrations/token-crypto", () => ({ tokenEncryptionKeyStatus: () => "valid", encryptToken: () => "encrypted" }));
vi.mock("@/lib/integrations/qonto-context", () => ({ qontoContext: mocks.context }));
vi.mock("@/lib/integrations/qonto-sync", () => ({ syncQonto: mocks.sync }));
import { GET, POST } from "./route";

const request = (input: object) => new Request("https://app.test/api/integrations/qonto", { method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" } });
beforeEach(() => { vi.clearAllMocks(); });
it("interdit la banque aux employés avant tout accès privilégié", async () => {
  mocks.workspace.mockResolvedValue({ role: "employee" });
  expect((await GET(new Request("https://app.test/api/integrations/qonto"))).status).toBe(403);
  for (const action of ["sync", "connect", "disconnect", "settings", "reconcile"]) expect((await POST(request({ action }))).status).toBe(403);
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("exige une session valide", async () => {
  mocks.workspace.mockRejectedValue(new Error("Authentification requise."));
  expect((await POST(request({ action: "sync" }))).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("ne renvoie ni secret chiffré ni IBAN complet dans la réponse", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  const query = { select: () => query, eq: vi.fn(() => query), maybeSingle: async () => ({ data: { credentials_encrypted: "NEVER-EXPOSE", accounts: [{ name: "Principal", iban: "FR001234567890" }], enabled: true }, error: null }) };
  mocks.admin.mockReturnValue({ from: () => query });
  mocks.context.mockResolvedValue({ transactions: [], candidates: [] });
  const response = await GET(new Request("https://app.test/api/integrations/qonto"));
  expect(response.status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("organization_id", "org");
  const content = await response.text();
  expect(content).not.toContain("NEVER-EXPOSE");
  expect(content).not.toContain("FR001234567890");
  expect(content).toContain('"last4":"7890"');
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it("effectue le rapprochement avec la session de l’utilisateur, pas la clé administrateur", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  mocks.rpc.mockResolvedValue({ error: null });
  const response = await POST(request({ action: "reconcile", transactionId: "50000000-0000-4000-8000-000000000001", kind: "ignore", reason: "Virement interne" }));
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("reconcile_bank_transaction", expect.objectContaining({ target_kind: "ignore" }));
  expect(mocks.admin).not.toHaveBeenCalled();
});
