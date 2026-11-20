import { expect, test } from "@playwright/test";

test("le résultat suit la période sans boîte de validation Qonto, sur ordinateur comme sur mobile", async ({ page }) => {
  const bankCalls: string[] = [];
  page.on("request", req => { if (new URL(req.url()).pathname.startsWith("/api/integrations/qonto")) bankCalls.push(req.url()); });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", {name:/Résultat d’activité ·/})).toBeVisible();
  await expect(page.getByText("Résultat enregistré", {exact:true})).toBeVisible();
  await page.getByRole("link", {name:/^Charges prévues/}).click();
  await expect(page).toHaveURL(/\/finances$/);
  await page.getByLabel("Mois analysé").fill("2026-09");
  await expect(page.getByRole("heading", {name:/Résultat d’activité · septembre 2026/i})).toBeVisible();
  await expect(page.getByText("Charges d’activité réglées", {exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:/valider l’intégration|rapprocher/i})).toHaveCount(0);
  await page.goto("/banque");
  await expect(page.getByRole("heading", {name:"Journal bancaire"})).toBeVisible();
  await expect(page.getByText("Le journal bancaire est disponible en mode connecté.")).toBeVisible();
  expect(bankCalls).toEqual([]);
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
