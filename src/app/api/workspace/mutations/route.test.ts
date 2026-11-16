import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: () => true }));
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({ organizationId: "9ab3b420-1829-40fb-887b-5bb2373cfc4b", locationId: "loc", user: { id: "user" }, role: "partner" });
});

function query(data: unknown) {
  return Object.assign(Promise.resolve({ data, error: null }), {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), single: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockReturnThis(),
  });
}

it("rejette une écriture envoyée depuis une entreprise qui n’est plus active", async () => {
  const response = await POST(new Request("https://app.test/api/workspace/mutations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      action: "updateObjective", month: "2026-11", revenueTarget: 10000, expectedOrganizationId: "0dd4b2fd-855f-421b-8ca4-890b7b04f9ad",
    }),
  }));
  expect(response.status).toBe(409);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

const entityId = "9ab3b420-1829-40fb-887b-5bb2373cfc4b";
const optimisticId = "0dd4b2fd-855f-421b-8ca4-890b7b04f9ad";
it.each([
  {
    action: "addPayment", input: { paymentId: optimisticId, invoiceId: entityId, amount: 10000, method: "Virement", paidAt: "2026-01-01T10:00:00Z" },
    reads: [{ total_including_tax_cents: 10000 }, []], trailing: false,
  },
  {
    action: "addInterventionPayment", input: { paymentId: optimisticId, interventionId: entityId, amount: 10000, method: "Virement", paidAt: "2026-01-01T10:00:00Z" },
    reads: [{ id: entityId, status: "completed", invoice_id: null, maintenance_contract_id: null }, [{ revenue_allocated_cents: 10000 }], []], trailing: false,
  },
  {
    action: "addService", input: { serviceId: optimisticId, name: "Entretien", kind: "subscription", pricingMode: "custom", category: "Entretien", targetDurationMinutes: 60, targetProductCost: 0, prices: [{ label: "Tarif", amount: 10000, maximumAmount: 10000 }] },
    reads: [{ id: entityId }, []], trailing: true,
  },
  {
    action: "duplicateService", input: { serviceId: entityId, copyId: optimisticId },
    reads: [{ id: entityId, name: "Entretien", kind: "subscription", display_order: 0, service_prices: [] }], trailing: false,
  },
])("conserve l’identifiant local lors de $action pour permettre une modification immédiate", async ({ action, input, reads, trailing }) => {
  for (const data of reads) mocks.from.mockReturnValueOnce(query(data));
  const inserted = query({ id: optimisticId });
  mocks.from.mockReturnValueOnce(inserted);
  if (trailing) mocks.from.mockReturnValueOnce(query(null));
  const response = await POST(new Request("https://app.test/api/workspace/mutations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...input }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, id: optimisticId });
  expect(inserted.insert).toHaveBeenCalledWith(expect.objectContaining({ id: optimisticId, organization_id: entityId }));
});
