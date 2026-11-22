import { expect, it } from "vitest";
import { readAllPages } from "./pagination";
import { loadSupabaseAppData } from "./data";
import type { SupabaseClient, User } from "@supabase/supabase-js";

it("ne tronque pas un export de plus de mille lignes", async () => {
  const source = Array.from({ length: 1251 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const records = await readAllPages(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });
  expect(records).toEqual(source);
  expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});
it("n’exporte pas silencieusement un fichier incomplet après une erreur", async () => {
  await expect(readAllPages(async (from) => from === 0
    ? { data: Array.from({ length: 500 }, (_, id) => id), error: null }
    : { data: null, error: { message: "Lecture refusée" } })).rejects.toEqual({ message: "Lecture refusée" });
});

it("charge aussi les anciennes échéances et les nouveaux messages au-delà de mille lignes dans le logiciel, sans changer d’organisation", async () => {
  const dates = { created_at: "2026-10-01", updated_at: "2026-10-01" };
  const records = Array.from({ length: 1021 }, (_, i) => ({ ...dates, id: String(i), organization_id: "org", contract_id: "contrat", due_on: "2026-11-20", amount_cents: 100, body: String(i) }));
  const seen: string[] = [];
  const fake = { from(table: string) {
    const filters = new Map<string, unknown>();
    const orders: string[] = [];
    const query = {
      select: () => query, is: () => query, limit: () => query,
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      order(key: string) { orders.push(key); return query; },
      single: async () => ({ data: { current_organization_id: "org" }, error: null }),
      then(resolve: (r: unknown) => void) {
        resolve({ data: table === "organization_members" && filters.has("profile_id") ? [{ organization_id: "org", role: "employee" }] : [], error: null });
      },
      async range(from: number, to: number) {
        expect(filters.get("organization_id")).toBe("org");
        expect(orders.at(-1)).toBe("id");
        seen.push(table + ":" + from);
        return { data: ["maintenance_billing_periods", "messages"].includes(table) ? records.slice(from, to + 1) : [], error: null };
      },
    };
    return query;
  } };
  const result = await loadSupabaseAppData(fake as unknown as SupabaseClient, { id: "member" } as User);
  expect(result.data.maintenanceBillingPeriods).toHaveLength(1021);
  expect(result.data.messages.at(-1)?.body).toBe("1020");
  expect(seen).toEqual(expect.arrayContaining(["maintenance_billing_periods:1000", "messages:1000", "planning_events:0"]));
  expect(seen).not.toContain("activity_logs:0");
});
