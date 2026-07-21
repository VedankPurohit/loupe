import { expect, test, type Page } from "@playwright/test";

import { signedGoogleFixture } from "./google-auth-fixture.js";

async function installGoogleFixture(page: Page) {
  await page.exposeFunction("signDashboardSurveillanceFixture", (nonce: string) =>
    signedGoogleFixture({ nonce, subject: "dashboard-surveillance" }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.google={accounts:{id:{initialize(c){window.__surveillanceGis=c},renderButton(p){const b=document.createElement('button');b.textContent='Continue with Google';b.onclick=async()=>window.__surveillanceGis.callback({credential:await window.signDashboardSurveillanceFixture(window.__surveillanceGis.nonce)});p.append(b)},revoke(_h,cb){cb()}}}}`,
    }),
  );
}

test("authenticated dashboard geometry stays contained across supported viewports", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installGoogleFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("New Organization name").fill("Dashboard Surveillance");
  await page.getByRole("button", { name: "Create Organization" }).click();
  await page.getByRole("button", { name: "Import rich-v1 Example pack — 12 members, 480 Sessions" }).click();
  await expect(page.getByRole("status", { name: "Example pack import status" })).toContainText("480 Seeded Sessions", { timeout: 30_000 });
  await page.getByRole("checkbox", { name: "Include clearly labelled Seeded examples" }).check();
  await expect(page.getByRole("navigation", { name: "Activity pagination" })).toContainText("480 Sessions");
  await expect(page.getByRole("region", { name: "Session summary" })).toBeVisible();
  await expect(page.locator(".execution-map")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Linear execution timeline" })).toHaveCount(1);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator(".investigation-shell").scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const navigation = document.querySelector(".app-nav");
      window.scrollBy(0, -(navigation?.getBoundingClientRect().height ?? 0) - 8);
    });
    const metrics = await page.evaluate(() => {
      const selectors = [
        ".investigation-shell",
        ".command-deck",
        ".organization-rail",
        ".map-stage",
        ".evidence-inspector",
        ".session-summary",
        ".organization-passport",
        ".session-secondary",
        ".organization-access-card",
      ];
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        boxes: Object.fromEntries(selectors.map((selector) => {
          const element = document.querySelector(selector);
          const rect = element?.getBoundingClientRect();
          return [selector, rect ? {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          } : null];
        })),
      };
    });
    console.log(`DASHBOARD_GEOMETRY_${viewport.width}=${JSON.stringify(metrics)}`);
    expect(metrics.document.scrollWidth).toBe(metrics.document.clientWidth);
    for (const [selector, box] of Object.entries(metrics.boxes)) {
      expect(box, `${selector} should render at ${viewport.width}px`).not.toBeNull();
      if (!box) continue;
      expect(box.left, `${selector} should not escape left at ${viewport.width}px`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${selector} should not escape right at ${viewport.width}px`).toBeLessThanOrEqual(metrics.document.clientWidth);
      expect(box.width, `${selector} should have positive width at ${viewport.width}px`).toBeGreaterThan(0);
    }

    const shell = metrics.boxes[".investigation-shell"];
    const rail = metrics.boxes[".organization-rail"];
    const map = metrics.boxes[".map-stage"];
    const inspector = metrics.boxes[".evidence-inspector"];
    const summary = metrics.boxes[".session-summary"];
    expect(shell && rail && map && inspector && summary).toBeTruthy();
    if (shell && rail && map && inspector && summary) {
      for (const [name, box] of [["rail", rail], ["map", map], ["inspector", inspector]] as const) {
        expect(box.left, `${name} left edge should stay inside shell`).toBeGreaterThanOrEqual(shell.left);
        expect(box.right, `${name} right edge should stay inside shell`).toBeLessThanOrEqual(shell.right);
      }
      expect(summary.left).toBeGreaterThanOrEqual(map.left);
      expect(summary.right).toBeLessThanOrEqual(map.right);
      if (viewport.width > 1100) {
        expect(Math.abs(rail.top - map.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(map.top - inspector.top)).toBeLessThanOrEqual(1);
        expect(rail.right).toBeLessThanOrEqual(map.left + 1);
        expect(map.right).toBeLessThanOrEqual(inspector.left + 1);
      } else {
        expect(rail.bottom).toBeLessThanOrEqual(map.top + 1);
        expect(map.bottom).toBeLessThanOrEqual(inspector.top + 1);
        expect(Math.abs(rail.width - map.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(map.width - inspector.width)).toBeLessThanOrEqual(1);
      }
    }

    // The passport, the secondary settings frame, and the Organization-access
    // footer must share one coherent set of outer edges rather than floating at
    // ragged, inconsistent centered widths.
    const passport = metrics.boxes[".organization-passport"];
    const secondary = metrics.boxes[".session-secondary"];
    const orgAccess = metrics.boxes[".organization-access-card"];
    expect(passport && secondary && orgAccess, "coherent frame sections should render").toBeTruthy();
    if (passport && secondary && orgAccess) {
      for (const [name, box] of [["secondary", secondary], ["orgAccess", orgAccess]] as const) {
        expect(Math.abs(box.left - passport.left), `${name} left edge should align with the passport at ${viewport.width}px`).toBeLessThanOrEqual(2);
        expect(Math.abs(box.right - passport.right), `${name} right edge should align with the passport at ${viewport.width}px`).toBeLessThanOrEqual(2);
      }
      // Every secondary card stays inside the secondary frame edges.
      const cardBoxes = await page.locator(".session-secondary > *").evaluateAll((cards) =>
        cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top) };
        }),
      );
      for (const card of cardBoxes) {
        expect(card.left, `secondary card should not escape frame left at ${viewport.width}px`).toBeGreaterThanOrEqual(secondary.left - 1);
        expect(card.right, `secondary card should not escape frame right at ${viewport.width}px`).toBeLessThanOrEqual(secondary.right + 1);
      }
      // Desktop packs settings cards into >=2 columns; narrow viewports stack them.
      const distinctLefts = new Set(cardBoxes.map((card) => card.left)).size;
      if (viewport.width > 1100) {
        expect(distinctLefts, "settings cards should form multiple columns on desktop").toBeGreaterThanOrEqual(2);
      } else {
        expect(distinctLefts, "settings cards should stack into one column when narrow").toBe(1);
      }
    }

    if (viewport.width === 390) {
      const navPositions = await page.locator(".app-nav > *").evaluateAll((items) => items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { left: Math.round(rect.left), top: Math.round(rect.top) };
      }));
      expect(new Set(navPositions.map(({ left }) => left)).size).toBe(2);
      expect(new Set(navPositions.map(({ top }) => top)).size).toBe(2);
    }
    if (viewport.width <= 1100) {
      const activityStrip = await page.locator(".session-stack").evaluate((strip) => {
        const cards = [...strip.querySelectorAll<HTMLElement>(".session-slip")];
        return {
          stripWidth: strip.getBoundingClientRect().width,
          firstCardWidth: cards[0]?.getBoundingClientRect().width ?? 0,
        };
      });
      const columns = viewport.width <= 520 ? 1 : viewport.width <= 800 ? 2 : 3;
      expect(Math.abs(activityStrip.firstCardWidth - activityStrip.stripWidth / columns)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `/tmp/loupe-dashboard-${viewport.width}.png` });
  }
  expect(pageErrors).toEqual([]);
});
