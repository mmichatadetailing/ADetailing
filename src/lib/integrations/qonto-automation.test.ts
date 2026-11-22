import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./qonto-context", () => ({ qontoContext: mocks.context }));
import { automateQonto, declareQontoService } from "./qonto-automation";
const tx = { id: "tx", side: "debit", counterparty: "Fournisseur", label: "Achat", reference: "", status: "completed", operation_type: "card", amount_cents: 11000, currency: "EUR", reconciliation: "unmatched", settled_at: "2026-09-15T12:00:00Z" };
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
  await automateQonto(db, "org", "2026-10-01", Date.now() + 10000);
  mocks.context.mockResolvedValue({ ...context, drafts: [{ transaction: tx, status: "pending", created_at: "2026-01-15", updated_at: "2026-01-16" }] });
  await automateQonto(db, "org", "2026-01-01", Date.now() + 10000);
  expect(rpc).not.toHaveBeenCalledWith("post_qonto_transaction", expect.anything());
});
it("ne transforme jamais un rapprochement en échec en nouvelle création", async () => {
  const { rpc, db } = database();
  rpc.mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: null, error: { message: "Conflit" } });
  await expect(automateQonto(db, "org", "2026-01-01", Date.now() + 10000)).rejects.toThrow("retentées automatiquement");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["repair_qonto_postings", "refresh_qonto_subscriptions", "post_qonto_transaction"]);
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
it("retraite le justificatif ajouté à un crédit auparavant laissé au journal, pas les crédits bancaires seuls de l’historique interne", async () => {
  const {rpc,db} = database();
  rpc.mockImplementation(async (name) => ({data:name === "register_qonto_service_credit" ? {kind:"service"} : 0, error:null}));
  const credit={...tx,side:"credit",operation_type:"check",counterparty:"",posting_kind:"bank_only",attachment_count:1,remote_updated_at:"2026-09-17"};
  mocks.context.mockResolvedValue({...context,transactions:[credit,{...credit,id:"old",settled_at:"2026-06-23T10:00:00Z"}]});
  await automateQonto(db,"org","2026-01-01",Date.now()+10000);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["repair_qonto_postings","refresh_qonto_subscriptions","register_qonto_service_credit"]);
  expect(rpc).toHaveBeenCalledWith("register_qonto_service_credit",expect.objectContaining({target_org:"org",target_transaction:credit.id,expected_version:credit.remote_updated_at,decision:expect.objectContaining({action:"service",unidentified:true})}));
});
it("borne la déclaration à l’entreprise authentifiée et renvoie le même dossier lors d’une reprise", async () => {
  const {rpc,db}=database();
  const credit={...tx,side:"credit",operation_type:"income",counterparty:"Ada Martin",remote_updated_at:tx.settled_at};
  const input={transactionId:tx.id,title:"Formule",expectedAmount:tx.amount_cents,expectedVersion:tx.settled_at,expectedSettledAt:tx.settled_at};
  mocks.context.mockResolvedValue({...context,transactions:[]});
  await expect(declareQontoService(db,"org","user",input)).rejects.toThrow("introuvable");
  expect(rpc).not.toHaveBeenCalled();
  mocks.context.mockResolvedValue({...context,transactions:[credit]});
  rpc.mockResolvedValueOnce({data:{kind:"service",interventionId:"job"}}).mockResolvedValueOnce({data:{kind:"existing",interventionId:"job"}});
  expect(await declareQontoService(db,"org","user",input)).toEqual({kind:"service",interventionId:"job"});
  expect(rpc).toHaveBeenCalledWith("register_qonto_service_credit",expect.objectContaining({target_org:"org",actor_id:"user",expected_amount:11000,decision:{action:"service",clientName:"Ada Martin",title:"Formule"}}));
  mocks.context.mockResolvedValue({...context,transactions:[{...credit,reconciliation:"matched",payment_id:"pay"}]});
  expect(await declareQontoService(db,"org","user",input)).toEqual({kind:"existing",interventionId:"job"});
});
