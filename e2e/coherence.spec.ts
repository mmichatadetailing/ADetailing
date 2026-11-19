import { expect, test } from "@playwright/test";

test("un entretien prépayé garde ses six visites et son paiement après rechargement", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-16T08:00:00Z"));
  await page.goto("/entretiens");
  await page.getByRole("button", { name: "Nouvel entretien" }).click();
  const form = page.getByRole("dialog", { name: "Créer un entretien mensuel" });
  await form.getByLabel("Nom du contrat").fill("Forfait audit six mois");
  await form.getByLabel("Rythme de paiement").selectOption("prepaid");
  await form.getByLabel("Première visite").fill("");
  await expect(form).toBeVisible();
  await form.getByLabel("Première visite").fill("2026-11-16");
  await form.getByLabel("Montant TTC pour 6 mois (€)").fill("600");
  await form.getByRole("button", { name: "Créer le forfait de 6 mois" }).click();
  await expect(form).not.toBeVisible();

  await page.getByRole("button", { name: "Saisir un paiement hors synchronisation" }).click();
  const payment = page.getByRole("dialog", { name: "Enregistrer l’encaissement" });
  await expect(payment.getByLabel("Date du paiement")).toHaveValue("2026-11-16");
  await payment.getByRole("button", { name: "Valider l’encaissement" }).click();
  await expect(payment).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("Forfait audit six mois", { exact: true }).first()).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("adetailing-pilotage-demo-v1")!).state);
  const contract = state.maintenanceContracts.find((item: { title: string }) => item.title === "Forfait audit six mois");
  expect(contract).toBeTruthy();
  expect(state.interventions.filter((item: { maintenanceContractId?: string }) => item.maintenanceContractId === contract.id)).toHaveLength(6);
  expect(state.maintenanceBillingPeriods.filter((item: { contractId: string }) => item.contractId === contract.id)).toHaveLength(1);
  expect(state.payments.filter((item: { maintenanceContractId?: string }) => item.maintenanceContractId === contract.id)).toHaveLength(1);
  expect(state.payments.find((item: { maintenanceContractId?: string }) => item.maintenanceContractId === contract.id).paidAt).toBe("2026-11-16T08:00:00.000Z");

  await page.getByRole("button", { name: "Modifier le paiement", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Modifier l’encaissement" });
  await edit.getByLabel("Date du paiement").fill("2026-11-15");
  await edit.getByRole("button", { name: "Valider l’encaissement" }).click();
  await expect(edit).not.toBeVisible();
  await page.getByRole("button", { name: "Annuler le paiement", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Annuler cet encaissement ?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirmer l’annulation" }).click();
  await expect(page.getByRole("button", { name: "Saisir un paiement hors synchronisation" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Saisir un paiement hors synchronisation" })).toBeVisible();
});

test("la fenêtre Ajouter protège les saisies lors d’une fermeture ou d’un changement de formulaire", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Ajouter" });
  await form.getByLabel("Formule ou prestation").fill("Brouillon à conserver");
  page.once("dialog", (dialog) => dialog.dismiss());
  await form.getByRole("button", { name: "Client", exact: true }).click();
  await expect(form.getByLabel("Formule ou prestation")).toHaveValue("Brouillon à conserver");
  page.once("dialog", (dialog) => dialog.dismiss());
  await form.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(form).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(form).toBeHidden();
});

test("la messagerie conserve un brouillon distinct par conversation sans requête bancaire ou serveur en démo", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/messages")) requests.push(request.url()); });
  await page.goto("/inbox");
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Brouillon pour toute l’équipe");
  const threads = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Fils de discussion" }) });
  await threads.getByRole("button", { name: /Range Rover/ }).click();
  await expect(draft).toHaveValue("");
  await draft.fill("Consigne privée pour ce dossier");
  await threads.getByRole("button", { name: /Général ADetailing/ }).click();
  await expect(draft).toHaveValue("Brouillon pour toute l’équipe");
  expect(requests).toEqual([]);
});
