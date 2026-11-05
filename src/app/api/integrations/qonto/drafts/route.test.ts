import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), rpc: vi.fn(), context: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, from: mocks.query }) }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: (role: string) => ["partner", "admin"].includes(role) }));
vi.mock("@/lib/integrations/qonto-context", () => ({ qontoContext: mocks.context }));
import { GET, POST } from "./route";

const draftId = "70000000-0000-4000-8000-000000000001";
const payload = { title: "Prestation proposée", performedOn: "2026-11-05", completed: true, revenue: 11000, durationMinutes: 0, notes: "", expenseDate: "2026-11-05", supplier: "", category: "", family: "variable", vatRateBasisPoints: 0 };
const request = (input: object) => new Request("https://app.test/api/integrations/qonto/drafts", { method: "POST", body: JSON.stringify(input) });
beforeEach(() => { vi.clearAllMocks(); });
it("refuse les lectures et mutations aux employés avant toute lecture financière", async () => {
  mocks.workspace.mockResolvedValue({ role: "employee" });
  expect((await GET(new Request("https://app.test/api/integrations/qonto/drafts"))).status).toBe(403);
  for (const action of ["save", "validate", "dismiss", "restore"]) expect((await POST(request({ action }))).status).toBe(403);
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("exige une session valide", async () => {
  mocks.workspace.mockRejectedValue(new Error("Authentification requise."));
  expect((await POST(request({ action: "dismiss", draftId }))).status).toBe(401);
});
it("filtre la liste sur l’entreprise active et évite une lecture complète inutile sans brouillons", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  const chain = { select: () => chain, eq: vi.fn(() => chain), order: () => chain, range: vi.fn(async () => ({ data: [], count: 0, error: null })) };
  mocks.query.mockReturnValue(chain);
  const response = await GET(new Request("https://app.test/api/integrations/qonto/drafts?side=debit&status=dismissed&page=2"));
  expect(response.status).toBe(200);
  expect(chain.eq).toHaveBeenCalledWith("organization_id", "org");
  expect(chain.eq).toHaveBeenCalledWith("side", "debit");
  expect(chain.eq).toHaveBeenCalledWith("status", "dismissed");
  expect(chain.range).toHaveBeenCalledWith(40, 59);
  expect(mocks.context).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it("transmet la validation à la fonction transactionnelle avec la session utilisateur", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  mocks.rpc.mockResolvedValue({ data: { interventionId: "job" }, error: null });
  const response = await POST(request({ action: "validate", draftId, expectedUpdatedAt: "2026-11-05T12:00:00Z", payload, expectedAmount: 11000, expectedSettledAt: "2026-11-05T12:00:00Z", targetKind: "new", confirmNew: true }));
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("manage_bank_draft", expect.objectContaining({ target_draft: draftId, action: "validate", details: expect.objectContaining({ expectedAmount: 11000, confirmNew: true }) }));
  expect(await response.json()).toEqual({ interventionId: "job" });
});
it("rejette une validation sans contrôle de version ou avec une somme invalide", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  expect((await POST(request({ action: "validate", draftId, payload, expectedAmount: -1, targetKind: "new", confirmNew: true }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("transmet le mois d’une échéance de charge dans un format de date PostgreSQL valide", async () => {
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "org" });
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  expect((await POST(request({ action: "validate", draftId, expectedUpdatedAt: "2026-11-05T12:00:00Z", payload, expectedAmount: 11000, expectedSettledAt: "2026-11-05T12:00:00Z", targetKind: "expense", targetId: draftId, month: "2026-11", confirmNew: false }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("manage_bank_draft", expect.objectContaining({ details: expect.objectContaining({ month: "2026-11-01" }) }));
});
