import { expect, test } from "@playwright/test";

test("la charte ADetailing conserve des cartes claires et des actions contrastées", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("body")).toHaveCSS("font-family", /montserrat/i);
  await expect(page.locator("body")).toHaveCSS("background-image", "none");
  const indicators = page.getByRole("region", { name: "Indicateurs de la période" });
  const cards = indicators.locator(".brand-kpi");
  await expect(indicators.locator(".brand-kpi, .finance-metric")).toHaveCount(8);
  await expect(cards).toHaveCount(5);
  for (const card of await cards.all()) await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(indicators.getByRole("link", { name: /^Objectif/ }).locator(".brand-kpi")).toHaveAttribute("data-tone", "blue");
  await expect(indicators.getByRole("link", { name: /^Encaissements enregistrés/ }).locator("dl")).toHaveAttribute("data-tone", "teal");
  await expect(indicators.getByRole("button", { name: /^Charges de la période/ })).toHaveAttribute("data-tone", "blue");
  expect(new Set(await cards.evaluateAll((elements) => elements.map((element) => getComputedStyle(element, "::before").backgroundColor))).size).toBeGreaterThanOrEqual(4);
  const action = page.getByRole("button", { name: "Ajouter", exact: true });
  const contrast = await action.evaluate((button) => {
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map((part) => {
        const value = Number(part) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      const [red, green, blue] = rgb;
      if (red === undefined || green === undefined || blue === undefined) throw new Error(`Couleur RGB invalide : ${color}`);
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const style = getComputedStyle(button);
    const colors = [luminance(style.color), luminance(style.backgroundColor)];
    return (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png") });
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Ajouter", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("formulaire.png") });
});

test("la trésorerie complète la grille sans inventer de solde ni appeler Qonto en démonstration", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/integrations/qonto/balance")) requests.push(request.url()); });
  await page.goto("/dashboard");
  const treasury = page.getByRole("region", { name: "Trésorerie actuelle" });
  await expect(treasury).toBeVisible();
  await expect(treasury).toContainText("Disponible en mode connecté");
  await expect(treasury).not.toContainText("€");
  const period = page.locator("select").first();
  const previousYear = await period.locator("option").last().getAttribute("value");
  await period.selectOption(previousYear!);
  await expect(treasury).toContainText("Indépendant de la période");
  await expect(page.getByRole("region", { name: "Indicateurs de la période" }).locator(".brand-kpi, .finance-metric")).toHaveCount(8);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard-tresorerie.png"), fullPage: true });
});

test("la connexion utilise les ressources locales et un logo lisible sur chaque fond", async ({ page, isMobile }, testInfo) => {
  const remoteBrandRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("adetailingorange.fr")) remoteBrandRequests.push(request.url()); });
  await page.goto("/connexion");
  await page.evaluate(() => document.fonts.ready);
  const logo = page.getByRole("img", { name: "ADetailing", exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", "/brand/adetailing.svg");
  await expect(logo).toHaveCSS("filter", isMobile ? "brightness(0)" : "brightness(0) invert(1)");
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  if (!isMobile) await expect.poll(() => page.locator('img[alt=""]').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(remoteBrandRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("connexion.png") });
});

test("les repères de navigation restent cohérents sur ordinateur et mobile", async ({ page, isMobile }, testInfo) => {
  await page.goto("/planning");
  await expect(page.locator("#app-shell")).toHaveAttribute("data-tone", "blue");
  if (isMobile) await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "Menu principal", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Planning", exact: true })).toHaveAttribute("data-tone", "blue");
  await expect(menu.getByRole("link", { name: "Clients", exact: true })).toHaveAttribute("data-tone", "violet");
  const finances = menu.getByRole("link", { name: "Finances", exact: true });
  await expect(finances).toHaveAttribute("data-tone", "emerald");
  await finances.click();
  await expect(page.locator("#app-shell")).toHaveAttribute("data-tone", "emerald");
  const active = page.locator(isMobile ? '.mobile-nav-link[aria-current="page"]' : '.app-nav-link[aria-current="page"]');
  await expect(active).toHaveText("Finances");
  await expect(active).toHaveCSS("background-color", "rgb(234, 247, 240)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("navigation-finances.png") });
});
