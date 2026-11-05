import ExcelJS from "exceljs";
import type { AppData, Payment } from "@/lib/domain/types";
import type { TeamInvitation } from "@/lib/supabase/data";
import { clientRevenueMetrics, grossMargin, paymentStatusForInvoice } from "@/lib/domain/calculations";
import { buildDashboardChartData } from "@/lib/domain/dashboard-charts";
import { getInterventionWorkflow } from "@/lib/domain/intervention-workflow";
import { interventionStatusLabels, invoiceStatusLabels, leadStageLabels, paymentStatusLabels, quoteStatusLabels } from "@/lib/domain/labels";
import { memberRoleDisplayLabel } from "@/lib/domain/member-roles";

type Row = Record<string, unknown>;
const without = (record: object, keys: string[]): Row => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
const moneyKeys = new Set(["billingAmount", "amount", "maximumAmount", "estimatedAmount", "unitPrice", "discount", "netAmount", "revenueAllocated", "productCost", "travelCost", "otherDirectCosts", "depositAmount", "amountIncludingTax", "amountExcludingTax", "vatAmount", "priceIncludingTax", "expectedMonthlyRevenue", "revenueTarget", "averageBasketTarget", "hourlyMarginTarget", "targetProductCost", "targetTravelCost", "targetHourlyMargin", "totalExcludingTax", "totalTax", "totalIncludingTax"]);
const moneyFormat = '#,##0.00 "€";[Red]-#,##0.00 "€"';
const labels: Record<string, string> = {
  id: "Identifiant", organizationId: "ID entreprise", locationId: "ID établissement", createdAt: "Création", updatedAt: "Modification", legacyId: "ID historique", legacyRow: "Ligne historique",
  clientName: "Client", contractName: "Contrat", memberName: "Collaborateur", interventionName: "Prestation", clientId: "ID client", serviceId: "ID formule", invoiceId: "ID facture", quoteId: "ID devis", vehicleId: "ID véhicule", ownerId: "ID responsable", maintenanceContractId: "ID entretien", maintenanceBillingPeriodId: "ID échéance", interventionId: "ID prestation", contractId: "ID contrat",
  firstName: "Prénom", lastName: "Nom", company: "Société", email: "E-mail", phone: "Téléphone", address: "Adresse", postalCode: "Code postal", city: "Ville", kind: "Type", source: "Source d’acquisition", notes: "Notes", nextAction: "Prochaine action", archivedAt: "Archivage", siret: "SIRET", vatNumber: "N° TVA",
  make: "Marque", model: "Modèle", registration: "Immatriculation", format: "Catégorie véhicule", year: "Année", color: "Couleur", mileage: "Kilométrage", initialCondition: "État initial",
  name: "Nom", title: "Intitulé", status: "État", startAt: "Début", endAt: "Fin", vehicleFormat: "Catégorie véhicule", maintenancePeriod: "Mois de visite", plannedDurationMinutes: "Durée prévue (min)", actualDurationMinutes: "Durée réelle (min)", preparationMinutes: "Préparation (min)", cleanupMinutes: "Rangement (min)", productCost: "Coût produits (€)", travelCost: "Coût déplacement (€)", otherDirectCosts: "Autres coûts directs (€)", depositAmount: "Acompte prévu (€)", checklistDone: "Tâches réalisées", checklistTotal: "Tâches prévues",
  label: "Libellé", quantity: "Quantité", revenueAllocated: "Valeur réalisée / analytique (€)", plannedMinutes: "Temps prévu (min)", actualMinutes: "Temps réel (min)", memberId: "ID collaborateur",
  billingFrequency: "Rythme de paiement", billingAmount: "Montant par échéance (€)", termMonths: "Durée payée (mois)", renewalReminderDays: "Relance avant fin (jours)", vehicleCount: "Nombre de véhicules", firstVisitOn: "Date d’ancrage", visitDay: "Jour mensuel d’ancrage", preferredStartTime: "Heure habituelle", assignedMemberIds: "Collaborateurs affectés", endsOn: "Fin du contrat", generatedThrough: "Planifié jusqu’au", periodStart: "Mois couvert", dueOn: "Date d’échéance", paidAt: "Date d’encaissement", paymentMethod: "Moyen de paiement", amount: "Montant (€)", method: "Moyen de paiement", reference: "Référence",
  date: "Date de première échéance", endsAt: "Fin de validité", seriesId: "ID série", replacesExpenseId: "ID ancien tarif", family: "Famille", category: "Catégorie", supplier: "Fournisseur", description: "Description", amountIncludingTax: "Montant TTC (€)", amountExcludingTax: "Montant HT (€)", vatAmount: "TVA (€)", vatRecoverable: "TVA récupérable", recurrence: "Fréquence", allocatedMonth: "Mois de rattachement", paid: "Paiement automatique / effectué",
  number: "Numéro", issuedAt: "Émission", dueAt: "Échéance", totalExcludingTax: "Total HT (€)", totalTax: "Total TVA (€)", totalIncludingTax: "Total TTC (€)", validUntil: "Valable jusqu’au", acceptedAt: "Acceptation", nextFollowUpAt: "Relance", paymentTerms: "Conditions de paiement", sourceFileName: "Fichier source", expectedPaymentMethod: "Paiement prévu", paymentStatus: "État du paiement", designation: "Désignation", unitPrice: "Prix unitaire (€)", discount: "Remise (€)", netAmount: "Montant net (€)", vatRateBasisPoints: "Taux TVA",
  pricingMode: "Logique tarifaire", clientDescription: "Description client", internalDescription: "Description interne", targetDurationMinutes: "Durée cible (min)", targetProductCost: "Coût produits cible (€)", targetTravelCost: "Coût déplacement cible (€)", targetHourlyMargin: "Marge horaire cible (€)", active: "Actif", displayOrder: "Ordre", aliases: "Autres libellés", recommendedWorkers: "Collaborateurs conseillés", photosRequired: "Photos demandées", minimumVehicleCount: "Véhicules minimum", maximumVehicleCount: "Véhicules maximum", maximumAmount: "Montant maximum (€)",
  role: "Rôle affiché", profileId: "ID compte", initials: "Initiales", weeklyCapacityMinutes: "Disponibilité hebdo (min)", month: "Mois", revenueTarget: "Objectif encaissé (€)", interventionTarget: "Objectif prestations", averageBasketTarget: "Panier moyen cible (€)", hourlyMarginTarget: "Marge horaire cible (€)", reviewTarget: "Objectif avis", note: "Note",
  priority: "Priorité", priceIncludingTax: "Prix TTC (€)", expectedTimeGainMinutes: "Gain de temps prévu (min)", expectedMonthlyRevenue: "Revenu mensuel prévu (€)", commissionedAt: "Mise en service", prospectName: "Prospect", vehicleLabel: "Véhicule", serviceLabel: "Prestation envisagée", estimatedAmount: "Montant estimé (€)", stage: "Étape", requestedAt: "Demande", nextActionAt: "Date prochaine action", lostReason: "Motif de perte",
  allDay: "Toute la journée", memberIds: "Participants", location: "Lieu", authorId: "ID auteur", body: "Message", sentAt: "Envoi", editedAt: "Modification message", deletedAt: "Suppression", readBy: "Lu par", channel: "Canal", entityType: "Type de dossier", entityId: "ID dossier", actorId: "ID auteur", occurredAt: "Date", receivedAt: "Réception", rating: "Note sur 5", comment: "Commentaire", url: "Lien", contentAuthorized: "Contenu autorisé", expiresAt: "Expiration", revokedAt: "Révocation", memberIdInvitation: "ID membre invité",
};

// Une date Excel ne possède pas de fuseau : on inscrit l’heure civile de Paris.
export function excelDate(value: string): Date | null {
  const parsed = new Date(value.length === 7 ? `${value}-01T12:00:00Z` : value.length === 10 ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (value.length <= 10) return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(parsed).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}

function cellValue(key: string, value: unknown): ExcelJS.CellValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return moneyKeys.has(key) ? value / 100 : key.endsWith("BasisPoints") ? value / 10_000 : value;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/.test(value)) return excelDate(value) ?? value;
    // Reste un texte, même si une saisie commence par =, +, - ou @.
    return value.slice(0, 32_767);
  }
  return JSON.stringify(value);
}

function rowsSheet(book: ExcelJS.Workbook, name: string, records: Row[], preferred: string[]) {
  const keys = [...new Set([...preferred, ...records.flatMap(Object.keys)])].filter((key) => !["organizationId", "locationId"].includes(key));
  const sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }], properties: { tabColor: { argb: "FFF9734F" } } });
  sheet.mergeCells(1, 1, 1, Math.max(keys.length, 2));
  sheet.getCell("A1").value = name;
  sheet.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF172033" } };
  sheet.getRow(1).height = 32;
  sheet.getCell("A2").value = { text: "Retour à la synthèse", hyperlink: "#'Synthèse'!A1" };
  sheet.getCell("A2").font = { color: { argb: "FFC94C22" }, underline: true };
  sheet.getRow(4).values = keys.map((key) => name === "Charges" && key === "paidAt" ? "Date de décaissement" : labels[key] ?? key);
  sheet.getRow(4).height = 36;
  sheet.getRow(4).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEDD5" } }; cell.font = { bold: true, color: { argb: "FF172033" } }; cell.alignment = { wrapText: true, vertical: "middle" }; });
  records.forEach((record, index) => {
    const row = sheet.addRow(keys.map((key) => cellValue(key, record[key])));
    row.height = 32;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const key = keys[column - 1] ?? "";
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF172033" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      if (moneyKeys.has(key) || key.endsWith("(€)")) cell.numFmt = moneyFormat;
      else if (key.endsWith("BasisPoints")) cell.numFmt = "0.0%";
      else if (cell.value instanceof Date) cell.numFmt = key === "month" || key === "periodStart" || key === "maintenancePeriod" ? "mmm yyyy" : /T/.test(String(record[key])) ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy";
    });
  });
  keys.forEach((key, index) => { sheet.getColumn(index + 1).width = /notes|Description|description|body|comment/.test(key) ? 48 : /Id$|^id$/.test(key) ? 38 : 25; });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, records.length + 4), column: keys.length } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return sheet;
}

export function buildExportWorkbook(data: AppData, options: { exportedAt?: Date; invitations?: TeamInvitation[] } = {}) {
  const reference = options.exportedAt ?? new Date();
  const book = new ExcelJS.Workbook();
  book.creator = "ADetailing";
  book.created = reference;
  book.calcProperties.fullCalcOnLoad = true;
  const summary = book.addWorksheet("Synthèse", { views: [{ state: "frozen", ySplit: 4 }], properties: { tabColor: { argb: "FF10B981" } } });
  summary.columns = [{ width: 37 }, { width: 28 }, { width: 80 }];
  summary.addRows([
    [data.settings.organizationName || "ADetailing", "Export des données"],
    ["Exporté le (heure de Paris)", excelDate(reference.toISOString())],
    ["Périmètre", "Entreprise active", "Données métier accessibles à votre compte, avec l’historique conservé dans l’application."],
    ["Indicateur", "Valeur", "Définition"],
    ["Encaissements reçus (€)", data.payments.reduce((sum, payment) => sum + payment.amount, 0) / 100, "Chaque paiement est compté une fois, y compris les forfaits d’entretien prépayés."],
    ["Prestations terminées", data.interventions.filter((item) => item.status === "completed").length],
    ["Contacts actifs", data.clients.filter((item) => !item.archivedAt).length],
    ["Contrats d’entretien actifs", data.maintenanceContracts.filter((item) => !item.archivedAt && item.status === "active").length],
    ["Utilisation", "Filtres sur chaque onglet", "Les en-têtes restent visibles. Les dates et montants sont triables et les identifiants relient les onglets."],
    ["À distinguer", "Encaissement et valeur des visites", "La valeur analytique d’une visite sert à la rentabilité, pas à ajouter un nouvel encaissement."],
    ["Charges récurrentes", "Deux vues complémentaires", "Charges contient les règles et anciens tarifs. Bilan mensuel déroule leurs échéances, sans multiplier les lignes source."],
    ["Confidentialité", "Fichier confidentiel", "Les messages exportés sont uniquement ceux que votre compte peut lire. Aucun mot de passe ni jeton de connexion n’est exporté."],
    ["Limites", "Export de consultation", "Les PDF, photos, événements Google et données définitivement supprimées ne sont pas inclus. Ce fichier n’est pas une sauvegarde restaurable."],
    [], ["Onglet", "Nombre de lignes", "Accès direct"],
  ]);
  summary.getCell("B2").numFmt = "dd/mm/yyyy hh:mm";
  summary.getCell("B5").numFmt = moneyFormat;
  const clients = new Map(data.clients.map((client) => [client.id, client.company || `${client.firstName} ${client.lastName}`.trim()]));
  const team = new Map(data.team.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]));
  const contracts = new Map(data.maintenanceContracts.map((contract) => [contract.id, contract]));
  const periods = new Map(data.maintenanceBillingPeriods.map((period) => [period.id, period]));
  const interventions = new Map(data.interventions.map((item) => [item.id, item]));
  const invoices = new Map(data.invoices.map((invoice) => [invoice.id, invoice]));
  const add = (name: string, records: Row[], keys: string[]) => {
    rowsSheet(book, name, records, keys);
    summary.addRow([name, records.length, { text: `Ouvrir ${name}`, hyperlink: `#'${name}'!A1` }]);
  };
  const paymentDetails = (payment: Payment) => {
    const contract = contracts.get(payment.maintenanceContractId ?? periods.get(payment.maintenanceBillingPeriodId ?? "")?.contractId ?? "");
    const intervention = payment.interventionId ? interventions.get(payment.interventionId) : payment.invoiceId ? data.interventions.find((item) => item.invoiceId === payment.invoiceId) : undefined;
    const invoice = invoices.get(payment.invoiceId ?? "");
    return { clientName: clients.get(contract?.clientId ?? intervention?.clientId ?? invoice?.clientId ?? "") ?? "Client non retrouvé", contractName: contract?.title, interventionName: intervention?.title, type: contract ? "Entretien" : invoice ? "Facture" : "Prestation", ...payment };
  };
  add("Paiements", data.payments.map(paymentDetails), ["paidAt", "clientName", "type", "contractName", "interventionName", "amount", "method"]);
  add("Clients", data.clients.map((client) => { const metrics = clientRevenueMetrics(client.id, data.invoices, data.interventions, data.payments, data.maintenanceContracts, data.maintenanceBillingPeriods); return { ...client, "Encaissé (€)": metrics.collected / 100, "Prestations réalisées (€)": metrics.revenue / 100 }; }), ["company", "firstName", "lastName", "email", "phone", "city"]);
  add("Véhicules", data.vehicles.map((vehicle) => ({ clientName: clients.get(vehicle.clientId), ...vehicle })), ["clientName", "make", "model", "registration", "format"]);
  add("Prestations", data.interventions.map((original) => { const item = original; const workflow = getInterventionWorkflow(original, invoices.get(item.invoiceId ?? ""), data.payments); return { clientName: clients.get(item.clientId), ...without(item, ["items", "workers"]), status: interventionStatusLabels[item.status], "Facturation": item.maintenanceContractId ? "Incluse dans le contrat" : "Prestation ponctuelle", "Reste à encaisser (€)": workflow.outstanding / 100, "Marge brute (€)": grossMargin(original) / 100 }; }), ["title", "clientName", "startAt", "endAt", "status"]);
  add("Lignes prestations", data.interventions.flatMap((item) => item.items.map((line) => ({ interventionName: item.title, interventionId: item.id, ...line }))), ["interventionName", "label", "quantity", "revenueAllocated"]);
  add("Affectations", data.interventions.flatMap((item) => item.workers.map((worker) => ({ interventionName: item.title, interventionId: item.id, memberName: team.get(worker.memberId), ...worker }))), ["interventionName", "memberName", "plannedMinutes", "actualMinutes"]);
  add("Entretiens", data.maintenanceContracts.map((contract) => ({ clientName: clients.get(contract.clientId), ...contract, assignedMemberIds: contract.assignedMemberIds.map((id) => team.get(id) ?? id), billingFrequency: ({ monthly: "Mensuel", annual: "Annuel", prepaid: "Paiement unique" })[contract.billingFrequency], status: ({ active: "Actif", paused: "En pause", ended: "Terminé" })[contract.status] })), ["title", "clientName", "billingFrequency", "billingAmount", "termMonths", "firstVisitOn", "endsOn"]);
  add("Échéances entretiens", data.maintenanceBillingPeriods.map((period) => ({ clientName: clients.get(contracts.get(period.contractId)?.clientId ?? ""), contractName: contracts.get(period.contractId)?.title, ...period, status: ({ due: "À encaisser", paid: "Encaissée", cancelled: "Annulée" })[period.status] })), ["clientName", "contractName", "dueOn", "amount", "status", "paidAt"]);
  add("Charges", data.expenses.map((expense) => ({ ...expense, recurrence: ({ monthly: "Mensuelle", annual: "Annuelle", one_off: "Ponctuelle" })[expense.recurrence], family: ({ fixed: "Fixe", variable: "Variable", investment: "Investissement", personal: "Personnel" })[expense.family] })), ["description", "supplier", "category", "date", "endsAt", "recurrence", "amountIncludingTax", "paid"]);
  add("Équipe", data.team.map((member) => ({ ...member, role: memberRoleDisplayLabel(member.role), "Droits administrateur": member.role === "admin" ? "Oui" : "Non" })), ["firstName", "lastName", "email", "role", "active", "weeklyCapacityMinutes"]);
  add("Formules", data.services.map((service) => without(service, ["prices"])), ["name", "kind", "category", "pricingMode", "active"]);
  add("Tarifs formules", data.services.flatMap((service) => service.prices.map((price) => ({ "Formule": service.name, serviceId: service.id, ...price }))), ["Formule", "label", "vehicleFormat", "minimumVehicleCount", "maximumVehicleCount", "amount", "maximumAmount"]);
  add("Devis", data.quotes.map((quote) => ({ clientName: clients.get(quote.clientId), ...without(quote, ["lines"]), status: quoteStatusLabels[quote.status] })), ["number", "clientName", "status", "issuedAt", "totalIncludingTax"]);
  add("Factures", data.invoices.map((invoice) => ({ clientName: clients.get(invoice.clientId), ...without(invoice, ["lines"]), status: invoiceStatusLabels[invoice.status], paymentStatus: paymentStatusLabels[paymentStatusForInvoice(invoice, data.payments, reference)] })), ["number", "clientName", "status", "paymentStatus", "issuedAt", "totalIncludingTax"]);
  add("Lignes documents", [...data.quotes.map((document) => ({ document, type: "Devis" })), ...data.invoices.map((document) => ({ document, type: "Facture" }))].flatMap(({ document, type }) => document.lines.map((line) => ({ type, "Document": document.number, "ID document": document.id, ...line }))), ["type", "Document", "designation", "quantity", "unitPrice", "netAmount"]);
  add("Objectifs", data.objectives.map((item) => ({ ...item })), ["month", "revenueTarget", "interventionTarget", "averageBasketTarget", "hourlyMarginTarget", "reviewTarget"]);
  add("Planning interne", data.planningEvents.map((event) => ({ ...event, memberIds: event.memberIds.map((id) => team.get(id) ?? id) })), ["title", "kind", "startAt", "endAt", "allDay", "memberIds"]);
  add("Investissements", data.assets.map((asset) => ({ ...asset })), ["name", "category", "status", "priceIncludingTax", "supplier"]);
  add("Demandes historiques", data.leads.map((lead) => ({ clientName: clients.get(lead.clientId ?? ""), ...lead, stage: leadStageLabels[lead.stage] })), ["prospectName", "company", "phone", "email", "stage", "estimatedAmount"]);
  add("Avis", data.reviews.map((review) => ({ clientName: clients.get(review.clientId), ...review })), ["clientName", "requestedAt", "receivedAt", "rating", "comment"]);
  add("Activité", data.activities.map((activity) => ({ memberName: team.get(activity.actorId), ...activity })), ["occurredAt", "memberName", "title", "description"]);
  add("Messages accessibles", data.messages.map((message) => ({ memberName: team.get(message.authorId), ...message, readBy: message.readBy.map((id) => team.get(id) ?? id) })), ["sentAt", "memberName", "channel", "body", "entityType", "entityId"]);
  add("Invitations", (options.invitations ?? []).map((invitation) => ({ ...invitation })), ["firstName", "lastName", "email", "role", "expiresAt", "acceptedAt"]);
  add("Paramètres", Object.entries(data.settings).map(([key, value]) => ({ "Paramètre": key, "Valeur": Array.isArray(value) ? value.join(", ") : key.endsWith("BasisPoints") ? Number(value) / 10_000 : /Cash|Target|Buffer/.test(key) && !/Review|Rating|Rate/.test(key) ? Number(value) / 100 : value })), ["Paramètre", "Valeur"]);
  const years = new Set([reference.getFullYear(), ...data.payments.map((item) => +item.paidAt.slice(0, 4)), ...data.objectives.map((item) => +item.month.slice(0, 4)), ...data.expenses.map((item) => +item.date.slice(0, 4)), ...data.interventions.flatMap((item) => item.startAt ? [+item.startAt.slice(0, 4)] : [])]);
  const monthly = [...years].filter((year) => Number.isFinite(year) && year >= 1900 && year <= 9999).sort().flatMap((year) => {
    const charts = buildDashboardChartData({ year, objectives: data.objectives, interventions: data.interventions, payments: data.payments, expenses: data.expenses, reference });
    return charts.revenue.map((point, index) => {
      const cash = charts.cashFlow[index]!; // Les deux séries ont les mêmes douze mois.
      return {
        "Mois": excelDate(point.key),
        "Objectif encaissé (€)": point.objective === null ? null : point.objective / 100,
        "CA encaissé (€)": point.collected / 100,
        "Reçus totaux (€)": cash.receipts / 100,
        "Charges prévues (€)": cash.expenses / 100,
        "Charges décaissées (€)": cash.paidExpenses / 100,
        "Cash-flow réel (€)": cash.actualCashFlow / 100,
      };
    });
  });
  const monthlySheet = rowsSheet(book, "Bilan mensuel", monthly, ["Mois", "Objectif encaissé (€)", "CA encaissé (€)", "Reçus totaux (€)", "Charges prévues (€)", "Charges décaissées (€)", "Cash-flow réel (€)"]);
  monthlySheet.getColumn(1).numFmt = "mmm yyyy";
  for (let column = 2; column <= 7; column++) monthlySheet.getColumn(column).numFmt = moneyFormat;
  summary.addRow(["Bilan mensuel", monthly.length, { text: "Ouvrir le bilan", hyperlink: "#'Bilan mensuel'!A1" }]);
  book.worksheets.forEach((sheet) => { sheet.properties.defaultRowHeight = 28; });
  summary.eachRow((row, index) => { row.height = index >= 9 && index <= 13 ? 46 : 30; row.eachCell((cell) => { cell.alignment = { vertical: "middle", wrapText: true }; cell.font = { name: "Calibri", size: 11, color: { argb: "FF172033" } }; }); });
  [1, 4, 15].forEach((index) => { summary.getRow(index).font = { bold: true, size: index === 1 ? 16 : 11, color: { argb: "FF172033" } }; summary.getRow(index).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEDD5" } }; });
  return book;
}

export async function exportWorkspaceExcel(data: AppData, options: Parameters<typeof buildExportWorkbook>[1] = {}) {
  const book = buildExportWorkbook(data, options);
  return book.xlsx.writeBuffer();
}
