import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ transactions: vi.fn(), context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./token-crypto", () => ({ decryptToken: () => JSON.stringify({ login: "id", secret: "secret" }) }));
vi.mock("./qonto-client", () => ({ QontoClient: class { transactions = mocks.transactions; } }));
vi.mock("./qonto-context", () => ({ qontoContext: mocks.context }));
import { syncQonto } from "./qonto-sync";

function database(connection: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const chain = { eq: () => chain, or: () => chain, select: () => chain, maybeSingle: async () => ({ data: connection, error: null }), then: (resolve: (value: unknown) => void) => Promise.resolve({ error: null }).then(resolve) };
  const db = { rpc, from: () => ({ select: () => chain, update: (patch: Record<string, unknown>) => {
    updates.push(patch);
    return chain;
  } }) } as unknown as SupabaseClient;
  return { db, updates, rpc };
}
const connection = { credentials_encrypted: "encrypted", remote_organization_id: "qonto", accounts: [{ id: "bank", iban: "FR123", name: "Compte", currency: "EUR" }], cursor_at: "2026-09-01T00:00:00Z", import_since: "2026-09-01", window_to: "2026-09-08T00:00:00Z", account_index: 0, next_page: 1, auto_reconcile: false };
beforeEach(() => { vi.clearAllMocks(); });
it("ne lance aucun appel Qonto si une synchronisation possède déjà le verrou", async () => {
  expect((await syncQonto(database(null).db, "org")).busy).toBe(true);
  expect(mocks.transactions).not.toHaveBeenCalled();
});
it("enregistre les pages une à une et libère le verrou après une interruption", async () => {
  const { db, updates, rpc } = database(connection);
  mocks.transactions.mockResolvedValueOnce({ transactions: [], meta: { next_page: 2, total_pages: 2 } }).mockRejectedValueOnce(new Error("Limite Qonto atteinte"));
  await expect(syncQonto(db, "org")).rejects.toThrow("Limite Qonto");
  expect(rpc).toHaveBeenCalledWith("ingest_qonto_transactions", { target_org: "org", entries: [] });
  expect(updates).toContainEqual(expect.objectContaining({ next_page: 2, cursor_at: connection.cursor_at }));
  expect(updates.at(-1)).toEqual({ lease_token: null, lease_until: null });
});
it("reprend exactement la fenêtre et la page sauvegardées", async () => {
  const { db } = database({ ...connection, next_page: 4 });
  mocks.transactions.mockRejectedValueOnce(new Error("Pause du test"));
  await expect(syncQonto(db, "org")).rejects.toThrow("Pause du test");
  expect(mocks.transactions).toHaveBeenCalledWith(connection.accounts[0], connection.cursor_at, connection.window_to, 4);
});
it("termine les comptes, reprend 48 h et identifie les virements internes", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  try {
    const { db, updates, rpc } = database({ ...connection, enabled: true, cursor_at: "2026-11-04T12:00:00Z", window_to: "2026-11-05T12:00:00Z", accounts: [...connection.accounts, { id: "second", iban: "FR456", name: "Second", currency: "EUR" }] });
    mocks.transactions.mockResolvedValueOnce({ transactions: [{ id: "remote", amount_cents: 11000, currency: "EUR", side: "debit", status: "completed", settled_at: "2026-11-05T08:00:00Z", emitted_at: "2026-11-05T08:00:00Z", updated_at: "2026-11-05T08:00:00Z", operation_type: "transfer", transfer: { counterparty_account_number: "FR456" } }], meta: { next_page: null, total_pages: 1 } })
      .mockResolvedValueOnce({ transactions: [], meta: { next_page: null, total_pages: 1 } });
    expect(await syncQonto(db, "org")).toMatchObject({ pending: false, busy: false, imported: 1 });
    expect(mocks.transactions).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("ingest_qonto_transactions", expect.objectContaining({ entries: [expect.objectContaining({ operation_type: "internal_transfer" })] }));
    expect(updates).toContainEqual(expect.objectContaining({ cursor_at: "2026-11-03T12:00:00.000Z", window_to: null, account_index: 0 }));
  } finally { vi.useRealTimers(); }
});
