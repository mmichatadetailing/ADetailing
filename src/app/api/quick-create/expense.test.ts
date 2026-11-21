import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), workspace: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({createSupabaseServerClient: async () => ({from:mocks.from})}));
vi.mock("@/lib/supabase/workspace", () => ({requireAuthenticatedWorkspace:mocks.workspace,canManageBusiness:(role:string) => role === "partner"}));
import { POST } from "./route";

const expense = {kind:"expense",date:"2026-09-30",family:"variable",recurrence:"one_off",category:"Produits",supplier:"Magasin",description:"Produits de nettoyage",paid:true,amountIncludingTax:4250,vatRateBasisPoints:2000};
const post = (changes: object) => POST(new Request("https://app.test/api/quick-create",{method:"POST",body:JSON.stringify({...expense,...changes})}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({role:"partner",organizationId:"org",locationId:"loc",user:{id:"partner"}});
  mocks.insert.mockReturnValue({select:() => ({single:async () => ({data:{id:"purchase"},error:null})})});
  mocks.from.mockReturnValue({insert:mocks.insert});
});
it("enregistre le paiement en espèces à sa date réelle dans le registre sans écriture en banque", async () => {
  expect((await post({paymentMethod:"Espèces",paidOn:"2026-10-01"})).status).toBe(201);
  expect(mocks.from.mock.calls).toEqual([["expenses"]]);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({organization_id:"org",expense_date:"2026-09-30",paid_at:"2026-10-01T12:00:00.000Z",payment_method:"Espèces",amount_including_tax_cents:4250}));
});
it.each([{}, {paid:false,paymentMethod:"Espèces"}, {recurrence:"monthly",paymentMethod:"Espèces"}])("ne présume pas du moyen de paiement (%o)", async (changes) => {
  expect((await post(changes)).status).toBe(201);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({payment_method:null}));
});
