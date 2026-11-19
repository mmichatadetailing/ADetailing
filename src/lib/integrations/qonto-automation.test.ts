import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./qonto-context", () => ({ qontoContext: mocks.context }));
import { automateQonto } from "./qonto-automation";
const tx = { id: "tx", side: "debit", counterparty: "Fournisseur", label: "Achat", reference: "", status: "completed", operation_type: "card", amount_cents: 11000, currency: "EUR", reconciliation: "unmatched", settled_at: "2026-01-15T12:00:00Z" };
const context = { transactions: [tx], clients: [], candidates: [], blockers: [], drafts: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue(context); });
function database() {
  const rpc = vi.fn().mockResolvedValue({ data: { kind: "expense" }, error: null });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}
it("intègre les mouvements avec un contrôle du montant et de la date", async () => {
  const { rpc, db } = database();
  expect(await automateQonto(db, "org", "2026-01-01", Date.now() + 10000)).toMatchObject({ expenses: 1 });
  expect(rpc).toHaveBeenCalledWith("post_qonto_transaction", expect.objectContaining({ expected_amount: 11000, expected_settled_at: tx.settled_at, decision: { action: "expense", category: "Achats Qonto" } }));
});
it("conserve les brouillons déjà édités et l’historique antérieur", async () => {
  const { rpc, db } = database();
  await automateQonto(db, "org", "2026-02-01", Date.now() + 10000);
  mocks.context.mockResolvedValue({ ...context, drafts: [{ transaction: tx, status: "pending", created_at: "2026-01-15", updated_at: "2026-01-16" }] });
  await automateQonto(db, "org", "2026-01-01", Date.now() + 10000);
  expect(rpc).not.toHaveBeenCalledWith("post_qonto_transaction", expect.anything());
});
it("ne transforme jamais un rapprochement en échec en nouvelle création", async () => {
  const { rpc, db } = database();
  rpc.mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: null, error: { message: "Conflit" } });
  await expect(automateQonto(db, "org", "2026-01-01", Date.now() + 10000)).rejects.toThrow("retentées automatiquement");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["repair_qonto_postings", "post_qonto_transaction"]);
});
it("signale une migration manquante au lieu d’annoncer un succès", async () => {
  const { rpc, db } = database();
  rpc.mockResolvedValue({ data: null, error: { message: "Missing function" } });
  await expect(automateQonto(db, "org", "2026-01-01", Date.now() + 10000)).rejects.toThrow("Automatisation Qonto indisponible");
});
it("permet une reprise sans doublon si le budget est épuisé", async () => {
  const { rpc, db } = database();
  expect(await automateQonto(db, "org", "2026-01-01", Date.now() - 1)).toMatchObject({ pending: true, expenses: 0 });
  expect(rpc).not.toHaveBeenCalled();
});
