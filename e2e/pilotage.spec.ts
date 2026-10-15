import { expect, test } from "@playwright/test";

test("la fenêtre Ajouter reste utilisable sur tous les écrans", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Ajouter" });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize();
  await expect.poll(async () => {
    const box = await dialog.boundingBox();
    return Math.ceil((box?.y ?? 0) + (box?.height ?? 0));
  }).toBeLessThanOrEqual(viewport?.height ?? 10_000);

  const submit = dialog.getByRole("button", { name: "Créer et ouvrir la prestation" });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
});

test("un contact professionnel sans téléphone se crée puis se modifie", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Ajouter" });
  await addDialog.getByRole("button", { name: "Client", exact: true }).click();
  await addDialog.getByLabel("Type").selectOption("business");
  await addDialog.getByLabel("Société", { exact: true }).fill("Entreprise E2E");
  await addDialog.getByRole("button", { name: "Créer le client" }).click();

  await page.goto("/clients");
  await expect(page.getByText("Entreprise E2E", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Modifier Entreprise E2E" }).click();

  const editDialog = page.getByRole("dialog", { name: "Modifier le contact" });
  await editDialog.getByLabel("Ville").fill("Orange");
  await editDialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await editDialog.getByLabel("Marque").fill("Renault");
  await editDialog.getByLabel("Modèle").fill("Kangoo");
  await editDialog.getByLabel("Immatriculation").fill("AA-123-BB");
  await editDialog.getByRole("button", { name: "Enregistrer les modifications" }).click();

  await expect(page.getByText("Renault Kangoo", { exact: true })).toBeVisible();
});

test("une prestation créée s’ouvre directement en modification", async ({ page }) => {
  await page.goto("/prestations");
  await page.getByRole("button", { name: "Ajouter une prestation" }).click();
  const addDialog = page.getByRole("dialog", { name: "Ajouter" });
  await addDialog.getByLabel("Formule ou prestation").fill("Prestation E2E");
  await addDialog.getByLabel("Prix final prévu (€)").fill("150");
  await addDialog.getByRole("button", { name: "Créer et ouvrir la prestation" }).click();

  await expect(page).toHaveURL(/\/prestations\?intervention=.*&edit=1/);
  const detailDialog = page.getByRole("dialog", { name: "Prestation E2E" });
  await expect(detailDialog.getByLabel("Titre de la prestation")).toHaveValue("Prestation E2E");
  await expect(detailDialog.getByRole("button", { name: "Enregistrer toutes les modifications" })).toBeVisible();
});

test("un paiement lié à une facture peut être daté, modifié puis annulé", async ({ page }) => {
  await page.goto("/prestations");
  await page.getByPlaceholder("Client, véhicule, immatriculation, prestation…").fill("Mini Cooper");
  await page.getByRole("button", { name: /Formule 2 — Mini Cooper S/ }).first().click();

  const dialog = page.getByRole("dialog", { name: "Formule 2 — Mini Cooper S" });
  await dialog.getByRole("button", { name: /Modifier le paiement du/ }).click();
  await dialog.locator('input[type="date"]').last().fill("2026-07-16");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();

  await dialog.getByRole("button", { name: /Modifier le paiement du/ }).click();
  await expect(dialog.locator('input[type="date"]').last()).toHaveValue("2026-07-16");
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await dialog.getByRole("button", { name: /Marquer non payé le paiement du/ }).click();
  await dialog.getByRole("button", { name: "Confirmer", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /Modifier le paiement du/ })).toHaveCount(0);
});

test("la recherche ouvre directement la fiche du véhicule trouvé", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Rechercher partout/ }).click();

  const searchDialog = page.getByRole("dialog", { name: "Recherche globale" });
  await searchDialog.getByPlaceholder("Nom, téléphone, immatriculation, numéro…").fill("AA-123-AA");
  await searchDialog.getByRole("link", { name: /Mini Cooper S/ }).click();

  await expect(page).toHaveURL(/\/clients\?client=.*&vehicle=.*/);
  const clientDialog = page.getByRole("dialog", { name: "Camille Bernard" });
  await expect(clientDialog).toBeVisible();
  await expect(clientDialog.getByText("Mini Cooper S", { exact: true })).toBeVisible();
  await expect(clientDialog.getByText("AA-123-AA · Citadine", { exact: true })).toBeVisible();
});
