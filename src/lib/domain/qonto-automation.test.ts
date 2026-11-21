import { describe, expect, it } from "vitest";
import { qontoAutomationDecision } from "./qonto-automation";
import type { BankCandidate, BankTransaction } from "./banking";

const tx: BankTransaction = { id: "tx", remote_id: "remote", account_name: "Compte", label: "Nettoyage voiture", counterparty: "Camille Bernard", reference: "", amount_cents: 11000, currency: "EUR", side: "credit", status: "completed", settled_at: "2026-01-15T12:00:00Z", emitted_at: "2026-01-15T12:00:00Z", operation_type: "transfer", reconciliation: "unmatched", payment_id: null, expense_id: null, expense_month: null, created_entry: false, ignored_reason: null };
const candidate: BankCandidate = { key: "job:1", id: "job", kind: "intervention", label: "Prestation", identities: ["Camille Bernard"], amount: 11000, date: "2026-01-15" };
const context = { transactions: [tx], candidates: [] as BankCandidate[], clients: [], blockers: [] };
describe("intégration directe Qonto", () => {
  it("crée une prestation pour un nouveau nom bancaire et reconnaît un client existant", () => {
    expect(qontoAutomationDecision(tx, context)).toEqual({ action: "service", clientName: "Camille Bernard" });
    expect(qontoAutomationDecision(tx, { ...context, clients: [{ id: "client", names: ["Camille Bernard"] }] })).toMatchObject({ action: "service", clientId: "client" });
  });
  it("crée une charge pour un achat courant", () => expect(qontoAutomationDecision({ ...tx, side: "debit" }, context)).toMatchObject({ action: "expense" }));
  it("un ancien achat ponctuel ne bloque pas tous les futurs achats du fournisseur", () => {
    expect(qontoAutomationDecision({ ...tx, side: "debit" }, { ...context, candidates: [{ ...candidate, kind: "expense", date: "2025-01-01" }] })).toMatchObject({ action: "expense" });
  });
  it.each(["payment", "expense", "intervention", "invoice", "maintenance"] as const)("préfère la cible existante %s", (kind) => {
    const transaction = { ...tx, side: kind === "expense" ? "debit" as const : "credit" as const };
    expect(qontoAutomationDecision(transaction, { ...context, transactions: [transaction], candidates: [{ ...candidate, kind }] })).toMatchObject({ action: "match", kind });
  });
  it("ne décide pas entre deux cibles ou deux mouvements concurrents", () => {
    expect(qontoAutomationDecision(tx, { ...context, candidates: [candidate, { ...candidate, id: "other", key: "other" }] })).toMatchObject({ action: "defer" });
    expect(qontoAutomationDecision(tx, { ...context, transactions: [tx, { ...tx, id: "other" }], candidates: [candidate] })).toMatchObject({ action: "defer" });
  });
  it("ne duplique pas un acompte, un contrat ou un abonnement dont le montant a changé", () => {
    expect(qontoAutomationDecision(tx, { ...context, candidates: [{ ...candidate, amount: 22000 }] })).toMatchObject({ action: "defer" });
    expect(qontoAutomationDecision(tx, { ...context, blockers: [{ side: "credit", identities: [tx.counterparty] }] })).toMatchObject({ action: "defer" });
    expect(qontoAutomationDecision({ ...tx, side: "debit" }, { ...context, blockers: [{ side: "debit", identities: [tx.counterparty] }] })).toMatchObject({ action: "defer" });
  });
  it.each(["Apport en capital", "Remboursement achat", "Prêt"])("n’invente pas une vente ou charge pour %s", (label) => {
    expect(qontoAutomationDecision({ ...tx, label }, context)).toMatchObject({ action: "ignore" });
  });
  it("isole les virements internes et les crédits carte/intérêts", () => {
    expect(qontoAutomationDecision({ ...tx, operation_type: "internal_transfer" }, context)).toMatchObject({ action: "ignore" });
    expect(qontoAutomationDecision({ ...tx, operation_type: "card" }, context)).toMatchObject({ action: "ignore" });
    for (const label of ["Salaire", "Stripe", "SumUp"]) expect(qontoAutomationDecision({ ...tx, label }, context)).toMatchObject({ action: "defer" });
  });
  it("ne crée pas une identité fictive ou n’arbitre pas des homonymes", () => {
    expect(qontoAutomationDecision({ ...tx, counterparty: "" }, context)).toMatchObject({ action: "defer" });
    expect(qontoAutomationDecision(tx, { ...context, clients: [{ id: "a", names: [tx.counterparty] }, { id: "b", names: [tx.counterparty] }] })).toMatchObject({ action: "defer" });
  });
  it("reconnaît un crédit sur justificatif, mais ne confond pas un intermédiaire avec le client", () => {
    const credit = {...tx,operation_type:"check",counterparty:"",attachment_count:1};
    for (const payer of ["","Virement SEPA","Stripe"]) expect(qontoAutomationDecision({...credit,counterparty:payer},context)).toEqual({action:"service",unidentified:true,clientName:""});
    expect(qontoAutomationDecision({...credit,attachment_count:0},context).action).toBe("defer");
    expect(qontoAutomationDecision({...credit,counterparty:"Camille Bernard"},context)).toEqual({action:"service",clientName:"Camille Bernard"});
    for (const label of ["Virement interne","Apport en capital","Remboursement"]) expect(qontoAutomationDecision({...credit,label},context).action).toBe("ignore");
    expect(qontoAutomationDecision({...credit,status:"pending"},context).action).toBe("defer");
    expect(qontoAutomationDecision({...credit,side:"debit"},context).action).toBe("expense");
  });
  it("la déclaration sans justificatif rapproche d’abord le dossier du client, même si le nom est court", () => {
    const credit = {...tx,operation_type:"check",counterparty:"Stripe",attachment_count:0};
    const payer={id:"c",names:["Li"]};
    const ctx={...context,transactions:[credit],clients:[payer],candidates:[{...candidate,clientId:"c",identities:payer.names}]};
    expect(qontoAutomationDecision(credit,ctx,{clientId:"c"})).toEqual({action:"match",kind:"intervention",id:"job"});
    expect(qontoAutomationDecision(credit,ctx,{}).action).toBe("defer");
    expect(qontoAutomationDecision(credit,{...ctx,candidates:[]},{clientName:"Camille Bernard"})).toEqual({action:"service",clientName:"Camille Bernard"});
    expect(qontoAutomationDecision(credit,ctx,{clientId:"other-org"}).action).toBe("defer");
  });
});
