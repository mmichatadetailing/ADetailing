import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: async () => ({ organizationId: "org", user: { id: "author" } }) }));
import { POST } from "./route";

it("autorise l’envoi sur une prestation affectée à un collaborateur pas encore inscrit", async () => {
  const chain = (result: unknown) => {
    const builder = { select: () => builder, eq: () => builder, is: () => builder, limit: () => builder,
      maybeSingle: async () => result, single: async () => result, then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === "conversations") return { ...chain({ data: null, error: null }), insert: () => chain({ data: { id: "conversation" }, error: null }) };
    if (table === "interventions") return chain({ data: { title: "Prestation" }, error: null });
    if (table === "intervention_workers") return chain({ data: [{ profile_id: null }, { profile_id: "member" }], error: null });
    if (table === "conversation_members") return { upsert: mocks.upsert };
    if (table === "messages") return { insert: () => chain({ data: { id: "message" }, error: null }) };
    throw new Error(`Unexpected table ${table}`);
  });
  const response = await POST(new Request("https://app.test/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    body: "Consigne", entityType: "intervention", entityId: "55a09664-14d8-4ff5-ac43-53623fdc2e4b",
  }) }));
  expect(response.status).toBe(201);
  expect(mocks.upsert.mock.calls[0]?.[0]).toEqual([
    { organization_id: "org", conversation_id: "conversation", profile_id: "author" },
    { organization_id: "org", conversation_id: "conversation", profile_id: "member" },
  ]);
});
