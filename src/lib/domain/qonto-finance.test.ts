import { describe, expect, it } from "vitest";
import { bankCashSummary, bankFlow, expenseCategory, recordedActivity } from "./qonto-finance";
import { qontoAutomationDecision } from "./qonto-automation";
import { expenseForecast, expenseMonthSummary, projectedExpenseAmountForMonth, paidExpenseAmountForMonth } from "./calculations";
import type { BankCandidate, BankTransaction } from "./banking";

const tx: BankTransaction = { id:"tx",remote_id:"123",account_name:"Principal",label:"Prestation",counterparty:"Camille Bernard",reference:"",
  amount_cents:10000,currency:"EUR",side:"credit",status:"completed",settled_at:"2026-09-15T12:00:00Z",emitted_at:"2026-09-15T12:00:00Z",
  operation_type:"transfer",reconciliation:"unmatched",payment_id:null,expense_id:null,expense_month:null,created_entry:false,ignored_reason:null };
const debit: BankTransaction = {...tx,side:"debit",amount_cents:3000,operation_type:"direct_debit",label:"Prélèvement"};
const expense: BankCandidate = { id:"charge",key:"charge:09",kind:"expense",month:"2026-09",label:"Abonnement",date:"2026-09-14",amount:2500,identities:[debit.counterparty],recurringSupplier:debit.counterparty };
const context = {transactions:[debit], candidates:[expense], clients:[], blockers:[]};
describe("résultat et suivi automatiques dans le logiciel", () => {
  it("sépare l’activité, les remboursements et les transferts sans compter les liens une deuxième fois", () => {
    const list: BankTransaction[] = [
      {...tx,reconciliation:"matched",payment_id:"p"},debit,{...tx,amount_cents:500,operation_type:"card"},
      {...debit,label:"Remboursement client",amount_cents:1200}, {...tx,label:"Remboursement prêt"},
      {...tx,operation_type:"internal_transfer"}, {...tx,status:"reversed"}, {...debit,status:"pending"}, {...debit,expense_family:"personal"},
      {...debit,expense_family:"investment"}, {...tx,label:"Versement Stripe",amount_cents:7800},
      {...tx,counterparty:"Virement SEPA",amount_cents:200}, {...tx,reconciliation:"ignored",ignored_reason:"Apport"},
      {...tx,settled_at:"2026-09-30T22:30:00Z",amount_cents:1500}
    ];
    expect(bankCashSummary(list,"2026-09")).toEqual({receipts:8800,expenses:2500,result:6300,unallocatedCredits:8000,bookedRefunds:{customer:0,supplier:0}});
    expect(bankCashSummary(list,"2026-10").result).toBe(1500);
    expect(bankCashSummary(list,"2026").result).toBe(7800);
  });
  it("tous moyens : additionne espèces et virement une fois, soustrait les règlements confirmés mais pas le prévisionnel", () => {
    const charge = {date:"2026-09-15",paid:true,amountIncludingTax:3000,recurrence:"one_off" as const,family:"fixed" as const};
    const real = {id:"s",month:"2026-08",paidAt:"2026-09-02",amount:2400,bankTransactionId:"qonto"};
    const refund = {...tx,operation_type:"card",amount_cents:500,posting_kind:"ignored" as const,automated_at:"2026-09-16"};
    const {bookedRefunds} = bankCashSummary([refund],"2026-09");
    expect(recordedActivity([{paidAt:"2026-09-02",amount:10000},{paidAt:"2026-09-15",amount:3000}],[
      charge,{...charge,recurrence:"monthly"}, {...charge,recurrence:"annual",settlements:[real]}, {...charge,family:"investment"}, {...charge,paid:false}
    ],"2026-09",bookedRefunds,new Date("2026-09-30T12:00:00Z"))).toEqual({received:13000,spent:4900,result:8100});
  });
  it("traite une paie et des frais bancaires en dépenses, pas comme des ventes ou financements", () => {
    expect(qontoAutomationDecision({...debit,label:"Salaire septembre"}, {...context,candidates:[]})).toEqual({action:"expense",category:"Personnel & cotisations"});
    expect(expenseCategory({...debit,operation_type:"qonto_fee"})).toBe("Frais bancaires");
    expect(bankFlow({...debit,label:"achat PayPal"})).toBe("expense");
  });
  it("accepte un prélèvement variable unique, pas une carte ni deux abonnements ou deux débits concurrents", () => {
    expect(qontoAutomationDecision(debit,context)).toEqual({action:"match",kind:"expense",id:"charge",month:"2026-09",variableDebit:true});
    expect(qontoAutomationDecision({...debit,operation_type:"card",label:"Carte"},context).action).not.toBe("match");
    expect(qontoAutomationDecision(debit,{...context,candidates:[expense,{...expense,id:"other"}]}).action).toBe("defer");
    expect(qontoAutomationDecision(debit,{...context,transactions:[debit,{...debit,id:"other"}]}).action).toBe("defer");
  });
  it("un acompte ou règlement tardif ne crée pas une seconde prestation si la référence de facture est explicite", () => {
    const incoming = {...tx,reference:"Acompte facture FAC-2026-19"};
    const invoice: BankCandidate = { ...expense,kind:"invoice",date:"2026-07-01",amount:20000,documentReference:"FAC-2026-19",identities:["Camille Bernard","FAC-2026-19"] };
    expect(qontoAutomationDecision(incoming,{...context,candidates:[invoice],transactions:[incoming]})).toEqual({action:"match",kind:"invoice",id:"charge"});
  });
  it("le montant réellement prélevé remplace uniquement l’échéance réglée, au mois du débit en trésorerie", () => {
    const charges = [{date:"2026-08-30",recurrence:"monthly" as const,paid:false,amountIncludingTax:2500,settlements:[{id:"s",month:"2026-09",amount:3000,paidAt:"2026-10-01",bankTransactionId:"tx"}]}];
    const now = new Date("2026-10-15T12:00:00Z");
    expect(expenseMonthSummary(charges,"2026-09",now)).toMatchObject({total:3000,paid:3000,due:0});
    expect(projectedExpenseAmountForMonth(charges,"2026-09")).toBe(3000);
    expect(paidExpenseAmountForMonth(charges,"2026-09",now)).toBe(0);
    expect(paidExpenseAmountForMonth(charges,"2026-10",now)).toBe(3000);
    expect(expenseForecast(charges,"2026-08",3).map((o) => o.total)).toEqual([2500,3000,2500]);
  });
  it.each([214,-12286,2914,0])("sépare les deux charges et l’unique sortie bancaire, écart %i centimes", (cashDelta) => {
    const asOf = new Date("2026-09-30T12:00:00Z");
    const charges = [36071,12215].map((amount,i) => ({family:"fixed" as const,date:"2026-08-01",recurrence:"monthly" as const,paid:true,amountIncludingTax:amount,
      settlements:[{id:String(i),bankTransactionId:"tx",month:"2026-09",paidAt:"2026-09-03",amount,splitLeg:i+1,cashDelta:i===0 ? cashDelta : 0}]}));
    const source: BankTransaction = {...tx,side:"debit",reference:"Prêt du fourgon",monthly_split_rule_id:"rule",split_cash_delta_cents:cashDelta,reconciliation:"matched",amount_cents:48286+cashDelta};
    expect(bankCashSummary([source],"2026-09",asOf.getTime()).expenses).toBe(48286+cashDelta);
    expect(paidExpenseAmountForMonth(charges,"2026-09",asOf)).toBe(48286+cashDelta);
    expect(recordedActivity([],charges,"2026-09",undefined,asOf).spent).toBe(48286);
    expect(expenseMonthSummary(charges,"2026-09",asOf)).toMatchObject({total:48286,paid:48286,due:0,upcoming:0});
    expect(projectedExpenseAmountForMonth(charges,"2026-10")).toBe(48286);
  });
});
