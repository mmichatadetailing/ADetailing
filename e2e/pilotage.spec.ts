import { expect, test } from "@playwright/test";

test("la fenêtre Ajouter reste entièrement accessible", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter" });
  await expect(dialog).toBeVisible();
  const desktopBox = await dialog.boundingBox();
  expect(desktopBox?.y).toBeGreaterThanOrEqual(0);
  expect((desktopBox?.y ?? 0) + (desktopBox?.height ?? 0)).toBeLessThanOrEqual(721);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Ajouter" })).toBeVisible();
  await page.getByRole("button", { name: "Créer la demande" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Créer la demande" })).toBeVisible();
});

test("parcours prospect jusqu’au dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Bonjour Melvyn/i })).toBeVisible();
  await page.getByRole("button", { name: /Ajouter/i }).click();
  await page.getByLabel("Nom du prospect").fill("Prospect E2E");
  await page.getByLabel("Téléphone").fill("0611223344");
  await page.getByLabel("Véhicule").fill("Volvo XC40");
  await page.getByLabel("Prestation envisagée").fill("Formule 2");
  await page.getByLabel("Estimation (€)").fill("350");
  await page.getByRole("button", { name: "Créer la demande" }).click();
  await page.goto("/commercial");
  await expect(page.getByText("Prospect E2E")).toBeVisible();
});
