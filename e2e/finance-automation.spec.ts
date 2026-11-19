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
