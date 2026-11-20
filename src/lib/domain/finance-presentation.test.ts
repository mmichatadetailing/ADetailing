import { describe, expect, it } from "vitest";
import { connectionState, expenseAccess, isEstimatedDebit, occurrenceState, registerState } from "./finance-presentation";
import { expenseOccurrencesForMonth } from "./calculations";
import { recordedActivity } from "./qonto-finance";
import { journalLinks } from "./journal-links";
import type { Expense } from "./types";

const expense: Expense = {id:"e", organizationId:"o", locationId:"l", createdAt:"2026-01-01", updatedAt:"2026-01-01", date:"2026-01-02", allocatedMonth:"2026-01", recurrence:"monthly", paid:true, family:"fixed", supplier:"S", category:"Assurance", description:"Abonnement", amountIncludingTax:36000, amountExcludingTax:36000, vatAmount:0, vatRecoverable:false};
const settlement = {id:"s", bankTransactionId:"bank", month:"2026-09", amount:37000, paidAt:"2026-09-04"};
const now = new Date("2026-09-10T12:00:00Z");
const occurrence = (e: Expense, month: string) => expenseOccurrencesForMonth([e], month, now)[0]!;

describe("finances : ce qui est confirmé, estimé ou simplement prévu", () => {
  it("affiche zéro et non moins zéro sur une période vide", () => {
    expect(recordedActivity([], [], "2026-09")).toEqual({received:0,spent:0,result:0});
  });
  it("ouvre seulement un dossier rattaché et visible, jamais un homonyme ni un ancien contrat supprimé", () => {
    const link = journalLinks({expenses:[{id:"charge",date:"2026-03-01"}],interventions:[{id:"dossier",invoiceId:"facture"}],
      payments:[{id:"vente",invoiceId:"facture"}, {id:"forfait",maintenanceBillingPeriodId:"periode"}, {id:"ancien",maintenanceBillingPeriodId:"archive"}],
      maintenanceContracts:[{id:"actif"},{id:"supprime",archivedAt:"2026-02-02"}],
      maintenanceBillingPeriods:[{id:"periode",contractId:"actif"},{id:"archive",contractId:"supprime"}]});
    const tx = {status:"completed",reconciliation:"matched" as const,expense_id:null,expense_month:null,payment_id:null};
    expect(link({...tx,expense_id:"charge",expense_month:"2026-09-01"})?.href).toBe("/finances?registre=charges&mois=2026-09#charge-charge");
    expect(link({...tx,payment_id:"vente"})?.href).toBe("/prestations?intervention=dossier");
    expect(link({...tx,payment_id:"forfait"})?.href).toBe("/entretiens#echeance-periode");
    expect(link({...tx,payment_id:"ancien"})).toBeUndefined();
    expect(link({...tx,expense_id:"invisible"})).toBeUndefined();
    expect(link({...tx,payment_id:"vente",reconciliation:"review"})).toBeUndefined();
  });
  it("ne transforme pas les prélèvements estimés en paiements ni les règlements de septembre en règlements d’août", () => {
    const e = {...expense, settlements:[settlement]};
    const aug = occurrence(e,"2026-08"), sep = occurrence(e,"2026-09"), oct = occurrence(e,"2026-10");
    expect(occurrenceState(aug).label).toBe("Prélèvement estimé");
    expect(isEstimatedDebit(aug)).toBe(true);
    expect(occurrenceState(sep).label).toBe("Réglée · Qonto");
    expect(isEstimatedDebit(sep)).toBe(false);
    expect(sep.amount).toBe(37000);
    expect(occurrenceState(oct).label).toBe("À venir");
    expect(occurrenceState(occurrence({...expense, paid:false},"2026-09")).label).toContain("non réglée");
    expect(occurrenceState(occurrence({...expense, recurrence:"one_off"},"2026-01")).label).toBe("Règlement enregistré");
    expect(registerState({...expense, recurrence:"one_off",date:"2026-11-20"},"2026-11","2026-11-19").label).toBe("À venir");
  });
  it("protège les montants bancaires mais permet la révision future d’un abonnement", () => {
    expect(expenseAccess({...expense, settlements:[settlement]})).toEqual({edit:true,remove:false});
    expect(expenseAccess({...expense, recurrence:"one_off", settlements:[settlement]})).toEqual({edit:false,remove:false});
    expect(expenseAccess({...expense, endsAt:"2026-08-31"})).toEqual({edit:false,remove:false});
    expect(expenseAccess(expense)).toEqual({edit:true,remove:true});
  });
  it("ne présente pas une connexion en erreur, partielle ou sans planification comme opérationnelle", () => {
    const connection = {connected:true,enabled:true,last_synced_at:"2026-09-10T08:00:00Z"};
    const status = (c: Parameters<typeof connectionState>[0], scheduled=true) => connectionState(c,true,scheduled,+now);
    expect(status(null).label).toBe("Non connecté");
    expect(status({...connection,enabled:false}).label).toBe("En pause");
    expect(status(connection,false).label).toBe("Configuration incomplète");
    expect(status({...connection,last_error:"Erreur"}).tone).toBe("rose");
    expect(status({...connection,posting_pending:true}).label).toBe("Import partiel");
    expect(status({...connection,last_synced_at:"2026-08-31"}).tone).toBe("amber");
    expect(status(connection).tone).toBe("emerald");
  });
});
