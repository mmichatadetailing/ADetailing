import { expect, test } from "@playwright/test";

test("un virement pour deux mensualités n’ajoute ni troisième charge ni arrondi aux tarifs", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-20T12:00:00Z"));
  await page.addInitScript(() => {
    const expenses = [36071,12215].map((amount,i) => ({id:"split-"+i,organizationId:"demo",locationId:"demo",date:"2026-01-01",allocatedMonth:"2026-01",
      family:"fixed",category:"Véhicule",supplier:"Exemple",description:["Camion test","Assurance test"][i],recurrence:"monthly",amountIncludingTax:amount,paid:true,
      settlements:[{id:"s"+i,bankTransactionId:"one-transfer",paidAt:"2026-11-03",month:"2026-11",splitLeg:i+1,amount,cashDelta:i===0?214:0}]}));
    localStorage.setItem("adetailing-pilotage-demo-v1",JSON.stringify({version:1,state:{expenses,payments:[]}}));
  });
  await page.goto("/finances?mois=2026-11");
  await expect(page.getByText("Réglée · virement groupé",{exact:true})).toHaveCount(2);
  const totals = page.getByLabel("Virements groupés du mois");
  await expect(totals).toContainText(/485\s*€ sortis de Qonto pour 482,86\s*€/);
  await expect(totals).toContainText(/Écart de trésorerie : 2,14\s*€/);
  await page.getByLabel("Mois analysé").fill("2026-12");
  await expect(totals).toHaveCount(0);
});

test("le résultat suit la période sans boîte de validation Qonto, sur ordinateur comme sur mobile", async ({ page }) => {
  const bankCalls: string[] = [];
  page.on("request", req => { if (new URL(req.url()).pathname.startsWith("/api/integrations/qonto")) bankCalls.push(req.url()); });
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  await page.addInitScript(() => {
    const base = {organizationId:"demo",locationId:"demo",date:"2026-11-03",allocatedMonth:"2026-11",family:"fixed",category:"Véhicule",supplier:"Test",paid:true};
    const expenses = [
      ...[36071,12215].map((amount,i) => ({...base,id:"split-"+i,description:["Camion","Assurance"][i],recurrence:"monthly",amountIncludingTax:amount,
        settlements:[{id:"leg-"+i,bankTransactionId:"transfer",month:"2026-11",paidAt:"2026-11-03",amount,splitLeg:i+1,cashDelta:i===0?214:0}]})),
      {...base,id:"paid",description:"Charge ponctuelle réglée",recurrence:"one_off",amountIncludingTax:85311},
      {...base,id:"cash-expense",description:"Produits réglés en liquide",recurrence:"one_off",amountIncludingTax:10000,paymentMethod:"Espèces"},
      {...base,id:"planned",description:"Charge prévue non réglée",recurrence:"one_off",amountIncludingTax:20000,paid:false},
    ];
    const payments = [{id:"service",amount:160000,paidAt:"2026-11-03",method:"Virement",maintenanceContractId:"entretien"},
      {id:"cash",amount:16100,paidAt:"2026-11-04",method:"Espèces"}, {id:"oct",amount:2000,paidAt:"2026-10-15",method:"Espèces"}];
    localStorage.setItem("adetailing-pilotage-demo-v1",JSON.stringify({version:1,state:{expenses,payments,objectives:[{id:"obj",month:"2026-11",revenueTarget:400000}]}}));
  });
  await page.goto("/dashboard");
  const indicators = page.getByRole("region",{name:"Indicateurs de la période"});
  const cards = indicators.getByRole("link");
  await expect(cards.nth(0)).toHaveAccessibleName(/^Encaissements enregistrés/);
  await expect(cards.nth(0)).toContainText(/1\s?781\s*€/);
  await expect(cards.nth(1)).toHaveAccessibleName(/^Objectif annuel/);
  await page.getByRole("combobox",{name:"Période analysée"}).selectOption("month:2026-11");
  await expect(cards.nth(0)).toContainText(/1\s?761\s*€/);
  await expect(cards.nth(1)).toHaveAccessibleName(/^Objectif du mois/);
  await expect(cards.nth(1)).toContainText("40 %");
  await expect(cards.nth(1)).toHaveAttribute("href","/parametres#objectifs-chiffre-affaires");
  await expect(cards.nth(2)).toHaveAccessibleName(/^Résultat enregistré/);
  await expect(cards.nth(2)).toContainText(/325,03\s*€/);
  await expect(cards.nth(3)).toHaveAccessibleName(/^Charges d’activité réglées/);
  await expect(cards.nth(3)).toContainText(/1\s?435,97\s*€/);
  await expect(cards.nth(3)).toContainText(/dont 100\s*€ en espèces/);
  for (const label of ["Encaissements enregistrés","Résultat enregistré","Charges d’activité réglées"])
    await expect(page.getByText(label,{exact:true})).toHaveCount(1);
  await expect(indicators.getByRole("link",{name:/^(CA encaissé|Flux de trésorerie estimé|Charges prévues)/})).toHaveCount(0);
  await expect(indicators.getByRole("region",{name:"Trésorerie actuelle"})).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await cards.nth(3).click();
  await expect(page).toHaveURL(/\/finances\?mois=2026-11$/);
  await page.getByLabel("Mois analysé").fill("2026-09");
  await expect(page.getByRole("heading", {name:/Résultat d’activité · septembre 2026/i})).toBeVisible();
  await expect(page.getByText("Charges d’activité réglées", {exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:/valider l’intégration|rapprocher/i})).toHaveCount(0);
  await page.goto("/banque");
  await expect(page.getByRole("heading", {name:"Journal bancaire"})).toBeVisible();
  await expect(page.getByText("Le journal bancaire est disponible en mode connecté.")).toBeVisible();
  expect(bankCalls).toEqual([]);
});

test("une dépense en espèces peut être créée, puis datée au mois du règlement sans doublon", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  await page.addInitScript(() => {
    const key = "adetailing-pilotage-demo-v1";
    if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify({version:1,state:{expenses:[],payments:[]}}));
  });
  await page.goto("/finances?registre=charges&mois=2026-11");
  await page.getByRole("button",{name:/Prévoir une charge ou saisir hors banque/}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date de la dépense").fill("2026-11-08");
  await dialog.getByLabel("Catégorie").fill("Produits");
  await dialog.getByLabel("Fournisseur").fill("Magasin test");
  await dialog.getByLabel("Description").fill("Nettoyant payé en liquide");
  await dialog.getByLabel("Montant TTC (€)").fill("42.50");
  await dialog.getByLabel(/Moyen de paiement/).selectOption("Espèces");
  await dialog.getByRole("button",{name:"Enregistrer la dépense"}).click();
  const item = page.getByRole("listitem").filter({hasText:"Nettoyant payé en liquide"});
  await expect(item).toContainText("Réglée · espèces");
  const charges = page.locator("dl").filter({has:page.getByText("Charges d’activité réglées",{exact:true})});
  await expect(charges).toContainText(/dont 42,50\s*€ en espèces/);
  await item.getByRole("button",{name:"Modifier",exact:true}).click();
  await dialog.getByLabel("Date du règlement").fill("2026-10-30");
  await dialog.getByRole("button",{name:"Enregistrer les modifications"}).click();
  await expect(charges.locator("dd")).toHaveText(/^0\s*€/);
  await page.getByLabel("Mois analysé").fill("2026-10");
  await expect(charges).toContainText(/dont 42,50\s*€ en espèces/);
  await expect(item).toHaveCount(1);
});

test("juin : les anciens encaissements, même en espèces sans prestation, alimentent le résultat et les objectifs", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-19T12:00:00Z"));
  await page.addInitScript(() => {
    const expenses=[{id:"cash",organizationId:"demo",locationId:"demo",family:"variable",category:"Produits",description:"Achats en espèces",recurrence:"one_off",
      date:"2026-06-19",allocatedMonth:"2026-06",paid:true,paymentMethod:"Espèces",amountIncludingTax:3000,amountExcludingTax:3000,vatAmount:0}];
    const payments=[{id:"pre",amount:9000,paidAt:"2026-06-23T21:59:59Z",method:"Espèces",reference:"Historique juin"},
      {id:"may",amount:2000,paidAt:"2026-05-02",method:"Chèque",invoiceId:"ancienne-facture"}];
    localStorage.setItem("adetailing-pilotage-demo-v1",JSON.stringify({version:1,state:{expenses,payments,interventions:[],objectives:[{id:"obj",month:"2026-06",revenueTarget:20000}]}}));
  });
  await page.goto("/dashboard");
  const period=page.getByRole("combobox",{name:"Période analysée"});
  const cards=page.getByRole("region",{name:"Indicateurs de la période"});
  await expect(cards.getByRole("link",{name:/^Encaissements enregistrés/})).toContainText(/110\s*€/);
  await period.selectOption("month:2026-06");
  await expect(cards.getByRole("link",{name:/^Objectif du mois/})).toBeVisible();
  await expect(cards.getByRole("link",{name:/^Encaissements enregistrés/})).toContainText(/90\s*€/);
  await expect(cards.getByRole("link",{name:/^Objectif du mois/})).toContainText("45 %");
  await expect(cards.getByRole("link",{name:/^Résultat enregistré/})).toContainText(/60\s*€/);
  await expect(cards.getByRole("link",{name:/^Charges d’activité réglées/})).toContainText(/dont 30\s*€ en espèces/);
  await expect(page.getByText("Historique juin",{exact:true})).toBeVisible();
  await period.selectOption("year:2026");
  await expect(cards.getByRole("link",{name:/^Encaissements enregistrés/})).toContainText(/110\s*€/);
  await expect(cards.getByRole("link",{name:/^Objectif annuel/})).toContainText("55 %");
  await page.goto("/finances?mois=2026-06");
  await expect(page.locator("dl").filter({has:page.getByText("Charges d’activité réglées",{exact:true})})).toContainText(/dont 30\s*€ en espèces/);
});

test("les prévisions ouvrent le bon mois et le registre protège un débit importé", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-19T12:00:00Z"));
  await page.addInitScript(() => {
    const base = {id:"test-bank", organizationId:"demo", locationId:"demo", date:"2026-09-03", allocatedMonth:"2026-09", family:"fixed", category:"Location", supplier:"Exemple", description:"Charge bancaire test", amountIncludingTax:36000, amountExcludingTax:36000, vatAmount:0, vatRecoverable:false, recurrence:"one_off", paid:true};
    localStorage.setItem("adetailing-pilotage-demo-v1",JSON.stringify({version:1,state:{expenses:[
      {...base,settlements:[{id:"st",bankTransactionId:"bt",month:"2026-09",amount:36000,paidAt:"2026-09-03"}]},
      {...base,id:"schedule",recurrence:"monthly",description:"Prélèvement prévisionnel test",amountIncludingTax:12000},
    ]}}));
  });
  await page.goto("/finances?mois=2026-09");
  await expect(page.getByLabel("Mois analysé")).toHaveValue("2026-09");
  await expect(page.getByText("Réglée · Qonto",{exact:true})).toBeVisible();
  await expect(page.getByText("Prélèvement estimé",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Modifier",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Prévisions",exact:true}).click();
  await page.getByRole("button",{name:/Voir les échéances de Octobre 2026/i}).click();
  await expect(page.getByLabel("Mois analysé")).toHaveValue("2026-10");
  await expect(page.getByRole("button",{name:"Échéances du mois"})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Charges et matériel"}).click();
  const register = page.getByRole("list",{name:"Registre des charges"});
  const linked = register.getByRole("listitem").filter({hasText:"Charge bancaire test"});
  await expect(linked.getByText(/Réglée · Qonto/)).toBeVisible();
  await expect(linked.getByRole("button")).toHaveCount(0);
  await expect(register.getByRole("button",{name:"Modifier le tarif"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/finances?registre=charges&mois=2026-09#charge-test-bank");
  await expect(page.getByRole("button",{name:"Charges et matériel"})).toHaveAttribute("aria-pressed","true");
  await expect(linked).toHaveAttribute("data-linked","true");
  await expect(linked).toBeFocused();
  await expect(linked).toBeInViewport();
});

test("un encaissement Qonto se retrouve sur la prestation sans action de paiement ni suppression", async ({page}) => {
  await page.addInitScript(() => {
    const job = {id:"auto-job",clientId:"test-client",title:"Prestation synchronisée test",status:"completed",startAt:"2026-09-03T10:00:00Z",endAt:"2026-09-03T11:00:00Z",plannedDurationMinutes:60,workers:[],items:[{id:"test-line",label:"Nettoyage",quantity:1,revenueAllocated:9000}],productCost:0,travelCost:0,otherDirectCosts:0,checklistDone:0,checklistTotal:0,depositAmount:0};
    localStorage.setItem("adetailing-pilotage-demo-v1",JSON.stringify({version:1,state:{interventions:[job],payments:[{id:"receipt",interventionId:job.id,amount:9000,bankLinked:true,paidAt:"2026-09-03T11:00:00Z",method:"Virement"}]}}));
  });
  await page.goto("/prestations");
  await expect(page.getByText("Prestation synchronisée test",{exact:true})).toBeVisible();
  const filter = page.getByLabel("Filtrer les prestations");
  await filter.selectOption("to_collect");
  await expect(page.getByText("Aucune prestation dans cette vue")).toBeVisible();
  await filter.selectOption("qonto");
  await expect(page.getByText("Encaissée · Qonto",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Supprimer Prestation synchronisée test"})).toHaveCount(0);
  await page.getByRole("button",{name:/^Prestation synchronisée test/}).click();
  const dossier = page.getByRole("dialog");
  await expect(dossier.getByText("Qonto · lecture seule")).toBeVisible();
  await expect(dossier.getByText("Paiement manuel",{exact:true})).toHaveCount(0);
  await expect(dossier.getByRole("button",{name:/Marquer non payé|Valider le paiement/})).toHaveCount(0);
});
