import { expect, test } from "@playwright/test";

test("la charte ADetailing conserve des cartes claires et des actions contrastées", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("body")).toHaveCSS("font-family", /montserrat/i);
  await expect(page.locator("body")).toHaveCSS("background-image", "none");
  const cards = page.locator(".brand-kpi");
  await expect(cards).toHaveCount(7);
  for (const card of await cards.all()) await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const action = page.getByRole("button", { name: "Ajouter", exact: true });
  const contrast = await action.evaluate((button) => {
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map((part) => {
        const value = Number(part) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
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
