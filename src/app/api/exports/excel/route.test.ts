import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), load: vi.fn(), export: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.requireWorkspace, canManageBusiness: (role: string) => role === "partner" || role === "admin" }));
vi.mock("@/lib/supabase/data", () => ({ loadSupabaseAppData: mocks.load }));
vi.mock("@/lib/export/workbook", () => ({ exportWorkspaceExcel: mocks.export }));
vi.mock("@/lib/integrations/qonto-context", () => ({ qontoContext: async () => ({ transactions: [] }) }));
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());
it("refuse l’export à un employé avant de lire les données", async () => {
  mocks.requireWorkspace.mockResolvedValue({ role: "employee", user: { id: "employee" } });
  expect((await GET()).status).toBe(403);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.export).not.toHaveBeenCalled();
});
it("demande une reconnexion lorsque la session a expiré", async () => {
  mocks.requireWorkspace.mockRejectedValue(new Error("Authentification requise."));
  expect((await GET()).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("charge toutes les pages autorisées et désactive le cache du téléchargement", async () => {
  const user = { id: "partner" };
  mocks.requireWorkspace.mockResolvedValue({ role: "partner", user });
  mocks.load.mockResolvedValue({ data: {}, invitations: [] });
  mocks.export.mockResolvedValue(new Uint8Array([80, 75]));
  const response = await GET();
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith({}, user, { allRows: true });
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
});
