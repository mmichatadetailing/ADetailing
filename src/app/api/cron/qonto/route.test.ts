import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/integrations/qonto-sync", () => ({ syncQonto: mocks.sync }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); });
it("refuse un cron sans secret sans lire les comptes bancaires", async () => {
  vi.stubEnv("CRON_SECRET", "a".repeat(32));
  expect((await GET(new Request("https://app.test/api/cron/qonto"))).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
it("ne permet pas de contourner le secret avec un faux en-tête", async () => {
  vi.stubEnv("CRON_SECRET", "a".repeat(32));
  expect((await GET(new Request("https://app.test/api/cron/qonto", { headers: { authorization: `Bearer ${"b".repeat(32)}` } }))).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
it("synchronise les connexions actives avec le secret du planificateur", async () => {
  vi.stubEnv("CRON_SECRET", "a".repeat(32));
  const query = { select: () => query, eq: vi.fn(() => query), order: () => query, limit: async () => ({ data: [{ organization_id: "org" }], error: null }) };
  const db = { from: () => query };
  mocks.admin.mockReturnValue(db);
  mocks.sync.mockResolvedValue({ imported: 1, reconciled: 0 });
  const response = await GET(new Request("https://app.test/api/cron/qonto", { headers: { authorization: `Bearer ${"a".repeat(32)}` } }));
  expect(response.status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("enabled", true);
  expect(mocks.sync).toHaveBeenCalledWith(db, "org", expect.any(Number));
  expect(await response.json()).toEqual({ synchronized: 1, failed: 0 });
  vi.unstubAllEnvs();
});
