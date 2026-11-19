import { expect, test, type Locator } from "@playwright/test";

async function contrastRatio(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map((value) => value / 255);
    };
    const composite = (foreground: number[], background: number[]) => background.map((value, index) => foreground[index]! * foreground[3]! + value * (1 - foreground[3]!));
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    const background = ancestors.reduce((color, ancestor) => composite(rgba(getComputedStyle(ancestor).backgroundColor), color), [1, 1, 1]);
    const foreground = composite(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) => color.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const levels = [luminance(foreground), luminance(background)];
    return (Math.max(...levels) + .05) / (Math.min(...levels) + .05);
  });
}

test("le mode sombre se mémorise et reste lisible sur le dashboard et les formulaires", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Activer le mode sombre", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 17, 22)");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("adetailing-theme"))).toBe("dark");
  for (const card of await page.locator(".brand-kpi").all()) await expect(card).toHaveCSS("background-color", "rgb(24, 29, 37)");
  const action = page.getByRole("button", { name: "Ajouter", exact: true });
  expect(await contrastRatio(action)).toBeGreaterThanOrEqual(7);
  expect(await contrastRatio(page.locator(".brand-kpi .text-zinc-500").first())).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator(".recharts-cartesian-axis-tick-value").first()).toHaveCSS("fill", "rgb(169, 179, 195)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard-sombre.png"), fullPage: true });
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Ajouter", exact: true });
  await expect(dialog).toHaveCSS("background-color", "rgb(24, 29, 37)");
  const field = dialog.getByLabel("Formule ou prestation");
  await field.fill("Brouillon en mode sombre");
  expect(await contrastRatio(field)).toBeGreaterThanOrEqual(7);
  await page.screenshot({ path: testInfo.outputPath("formulaire-sombre.png") });
  await field.fill("");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Activer le mode clair", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activer le mode clair", exact: true }).click();
  await expect(page.locator(".brand-kpi").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await page.evaluate(() => localStorage.getItem("adetailing-theme"))).toBe("light");
  expect(errors).toEqual([]);
});

test("toutes les pages et les vues du planning conservent le mode sombre", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.setItem("adetailing-theme", "dark"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["dashboard", "prestations", "entretiens", "clients", "factures", "finances", "banque", "pilotage", "catalogue", "equipe", "parametres", "compte", "inbox", "planning"]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Activer le mode clair", exact: true })).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 17, 22)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), route).toBe(true);
    expect(await contrastRatio(page.getByRole("heading", { level: 1 }).first()), route).toBeGreaterThanOrEqual(7);
  }
  await page.getByRole("button", { name: /Choisir une date/ }).click();
  const picker = page.getByRole("dialog", { name: "Aller à une date", exact: true });
  const selected = picker.locator('[aria-pressed="true"]');
  expect(await contrastRatio(selected)).toBeGreaterThanOrEqual(7);
  if (!isMobile) {
    await selected.hover();
    await expect.poll(() => contrastRatio(selected)).toBeGreaterThanOrEqual(7);
  }
  // Navigate to the seeded appointments through the actual date picker; mocking
  // only the browser clock would disagree with the server-rendered dashboard.
  const now = new Date();
  const monthSteps = (now.getFullYear() - 2026) * 12 + now.getMonth() - 6;
  for (let step = 0; step < Math.abs(monthSteps); step++) {
    await picker.getByRole("button", { name: monthSteps > 0 ? "Mois précédent" : "Mois suivant", exact: true }).click();
  }
  await picker.getByRole("button", { name: "jeudi 30 juillet 2026", exact: true }).click();
  if (isMobile) await page.getByRole("combobox", { name: "Vue du planning", exact: true }).selectOption("month");
  else await page.getByRole("button", { name: "Mois", exact: true }).click();
  await expect(page.locator(".fc")).toBeVisible();
  await expect(page.locator(".fc-col-header-cell-cushion").first()).toHaveCSS("color", "rgb(169, 179, 195)");
  await expect(page.locator(".fc-event").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("planning-sombre.png") });
  if (isMobile) {
    await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeVisible();
  }
  const active = page.getByRole("navigation", { name: "Menu principal", exact: true }).locator('[aria-current="page"]');
  expect(await contrastRatio(active)).toBeGreaterThanOrEqual(4.5);
  await page.goto("/connexion");
  await expect(page.getByRole("img", { name: "ADetailing", exact: true })).toHaveCSS("filter", "brightness(0) invert(1)");
  await expect(page.getByRole("button", { name: "Activer le mode clair", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("le choix se synchronise entre onglets sans effacer un formulaire", async ({ page, context }) => {
  await page.goto("/dashboard");
  const other = await context.newPage();
  await other.goto("/dashboard");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const field = page.getByRole("dialog", { name: "Ajouter", exact: true }).getByLabel("Formule ou prestation");
  await field.fill("Prestation à conserver");
  await other.getByRole("button", { name: "Activer le mode sombre", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(field).toHaveValue("Prestation à conserver");
  await other.getByRole("button", { name: "Activer le mode clair", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(field).toHaveValue("Prestation à conserver");
  await other.close();
});

test("le bouton fonctionne même si le stockage est indisponible", async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key === "adetailing-theme") throw new DOMException("Bloqué", "SecurityError"); return getItem.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key === "adetailing-theme") throw new DOMException("Bloqué", "SecurityError"); setItem.call(this, key, value); };
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Activer le mode sombre", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Activer le mode clair", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("le thème enregistré est appliqué avant le chargement de React", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("adetailing-theme", "dark"));
  await page.route("**/_next/static/**/*.js*", (route) => route.abort());
  await page.goto("/connexion");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 17, 22)");
});

test("le changement de thème reste accessible sur un écran de 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Activer le mode sombre", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activer le mode clair", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Ajouter", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
