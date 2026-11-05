import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";

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

test("les pages principales s’ouvrent sans erreur ni débordement global", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["dashboard", "planning", "prestations", "entretiens", "clients", "documents", "finances", "banque", "pilotage", "catalogue", "equipe", "parametres", "compte", "inbox"]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajouter", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), route).toBe(true);
  }
  expect(errors).toEqual([]);
  await page.goto("/dashboard");
  await expect(page.locator(".recharts-surface")).toHaveCount(2);
  await expect(page.locator(".recharts-cartesian-axis-tick-value").first()).toBeVisible();
  expect(await page.locator(".recharts-wrapper").evaluateAll((charts) => charts.every((chart) => chart.getBoundingClientRect().width <= (chart.closest(".overflow-hidden")?.getBoundingClientRect().width ?? 0)))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard-audit.png"), fullPage: true });
});

test("les onglets Documents suivent les liens et le retour arrière", async ({ page }) => {
  await page.goto("/documents?tab=quotes");
  await page.getByRole("button", { name: /^Factures / }).click();
  await expect(page).toHaveURL(/tab=invoices/);
  await page.goBack();
  await expect(page).toHaveURL(/tab=quotes/);
  await expect(page.getByRole("heading", { name: "Devis Henrri" })).toBeVisible();
});

test("Échap ferme seulement la fenêtre la plus haute", async ({ page }) => {
  await page.goto("/clients?client=client-camille");
  // La recherche donne un identifiant réel, quel que soit le jeu de démo.
  await page.getByRole("button", { name: /Rechercher partout/ }).click();
  const search = page.getByRole("dialog", { name: "Recherche globale" });
  await search.getByRole("textbox").fill("Camille");
  await search.getByRole("link", { name: /Client Camille Bernard/ }).first().click();
  const client = page.getByRole("dialog", { name: "Camille Bernard" });
  await client.getByRole("button", { name: "Modifier la fiche" }).click();
  await expect(page.getByRole("dialog", { name: "Modifier le contact" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Modifier le contact" })).toHaveCount(0);
  await expect(client).toBeVisible();
});

test("l’export télécharge un classeur complet et lisible", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Exporter les données Excel", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Exporter les données Excel" });
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Télécharger le fichier Excel" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = testInfo.outputPath("export.xlsx");
  await download.saveAs(path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await readFile(path)).buffer);
  expect(book.worksheets[0]?.name).toBe("Synthèse");
  expect(book.getWorksheet("Clients")!.rowCount).toBeGreaterThan(4);
  expect(book.getWorksheet("Entretiens")).toBeDefined();
  expect(book.getWorksheet("Paiements")!.autoFilter).toBeTruthy();
  expect(book.getWorksheet("Paiements")!.getCell("F5").value).toEqual(expect.any(Number));
  await expect(dialog).not.toBeVisible();
});

test("le filtre mensuel reste utilisable si la saisie est effacée", async ({ page }) => {
  await page.goto("/finances");
  await page.getByLabel("Mois analysé").fill("");
  await expect(page.getByRole("heading", { name: "Finances", exact: true })).toBeVisible();
});

test("la navigation mobile se ferme au clavier et après un choix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toHaveCount(0);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await nav.getByRole("link", { name: "Entretiens mensuels" }).click();
  await expect(page).toHaveURL(/\/entretiens/);
  await expect(nav).toHaveCount(0);
});
