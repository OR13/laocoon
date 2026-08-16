import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Not a test — a capture pass. Renders every page at a few widths so the
 * result can be looked at rather than reasoned about. The graph work in
 * `graph.spec.ts` passed every numeric check while the middle of the picture
 * was an unreadable pile of overlapping text; screenshots are how that was
 * found, so taking them is part of the workflow rather than a debugging step.
 */
const SHOTS = join(import.meta.dirname, "../../.git-ignored/survey");
mkdirSync(SHOTS, { recursive: true });

const ROUTES = ["/index.html", "/threads/", "/accuracy/", "/methodology/"];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1400);
}

for (const route of ROUTES) {
  const slug = route.replace(/[/.]/g, "_").replace(/^_+|_+$/g, "") || "home";

  test(`survey ${route} desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/${slug}-desktop.png`, fullPage: true });
  });

  test(`survey ${route} narrow`, async ({ page }) => {
    await page.setViewportSize({ width: 860, height: 900 });
    await page.goto(route);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/${slug}-narrow.png`, fullPage: true });
  });
}

test("survey home dark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/index.html");
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/home-dark.png`, fullPage: true });
});
