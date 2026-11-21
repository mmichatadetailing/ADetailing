import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), admin: vi.fn(), context: vi.fn(), rpc: vi.fn(), sync: vi.fn(), declare: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: (role: string) => ["partner", "admin"].includes(role) }));
vi.mock("@/lib/integrations/token-crypto", () => ({ tokenEncryptionKeyStatus: () => "valid", encryptToken: () => "encrypted" }));
vi.mock("@/lib/integrations/qonto-journal", () => ({ readQontoJournal: mocks.context }));
vi.mock("@/lib/integrations/qonto-sync", () => ({ syncQonto: mocks.sync }));
vi.mock("@/lib/integrations/qonto-automation", () => ({ declareQontoService: mocks.declare }));
import { GET, POST } from "./route";

const request = (input: object) => new Request("https://app.test/api/integrations/qonto", { method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" } });
beforeEach(() => { vi.clearAllMocks(); });
it("interdit la banque aux employés avant tout accès privilégié", async () => {
  mocks.workspace.mockResolvedValue({ role: "employee" });
  expect((await GET(new Request("https://app.test/api/integrations/qonto"))).status).toBe(403);
  for (const action of ["sync", "connect", "disconnect", "settings", "reconcile", "reconcile_group", "declare_service"]) expect((await POST(request({ action }))).status).toBe(403);
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("ne laisse le navigateur choisir ni l’entreprise ni la décision bancaire", async () => {
  const input={action:"declare_service",transactionId:"10000000-0000-4000-8000-000000000001",title:"Nettoyage",expectedAmount:9900,
    expectedSettledAt:"2026-09-20T12:00:00+00:00",expectedVersion:"2026-09-21T12:00:00Z"};
  mocks.workspace.mockResolvedValue({role:"partner",organizationId:"org",user:{id:"member"}});
  mocks.admin.mockReturnValue({rpc:mocks.rpc});
  mocks.declare.mockResolvedValue({kind:"service",interventionId:"job"});
  expect((await POST(request({...input,organizationId:"other",decision:{action:"expense"}}))).status).toBe(400);
  expect(mocks.declare).not.toHaveBeenCalled();
  expect(await (await POST(request(input))).json()).toEqual({kind:"service",interventionId:"job"});
  expect(mocks.declare).toHaveBeenCalledWith({rpc:mocks.rpc},"org","member",input);
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
  mocks.context.mockResolvedValue([]);
  const response = await GET(new Request("https://app.test/api/integrations/qonto"));
  expect(response.status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("organization_id", "org");
  const content = await response.text();
  expect(content).not.toContain("NEVER-EXPOSE");
  expect(content).not.toContain("FR001234567890");
  expect(content).toContain('"last4":"7890"');
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it.each(["reconcile","reconcile_group","settings"])("refuse la commande manuelle obsolète %s avant toute écriture", async (action) => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  expect((await POST(request({ action, enabled: true, autoIntake: false }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("sépare le résultat d’une période des lignes du journal", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { enabled: true }, error: null }) };
  mocks.admin.mockReturnValue({ from: () => query });
  mocks.context.mockResolvedValue([]);
  for (const period of ["2026", "2026-09"]) {
    const res = await GET(new Request("https://app.test/api/integrations/qonto?period=" + period));
    expect(await res.json()).toMatchObject({ summary: { result: 0 } });
    expect(mocks.context).toHaveBeenCalledWith(expect.anything(), "org", period);
  }
  expect((await GET(new Request("https://app.test/api/integrations/qonto?period=2026-13"))).status).toBe(400);
});
