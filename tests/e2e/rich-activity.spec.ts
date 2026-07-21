import { expect, test, type Page } from "@playwright/test";

import { signedGoogleFixture } from "./google-auth-fixture.js";

async function installGoogleFixture(page: Page) {
  await page.exposeFunction("signRichActivityGoogleFixture", (nonce: string) =>
    signedGoogleFixture({ nonce, subject: "rich-activity-playwright" }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.google={accounts:{id:{initialize(c){window.__richGis=c},renderButton(p){const b=document.createElement('button');b.textContent='Continue with Google';b.onclick=async()=>window.__richGis.callback({credential:await window.signRichActivityGoogleFixture(window.__richGis.nonce)});p.append(b)},revoke(_h,cb){cb()}}}}`,
    }),
  );
}

test("rich-v1 activity pages the full Seeded volume and keeps provenance visible", async ({ page }) => {
  await installGoogleFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("New Organization name").fill("Rich Activity Organization");
  await page.getByRole("button", { name: "Create Organization" }).click();
  await expect(page.getByLabel("Active Organization")).toBeVisible();
  await page.getByRole("button", { name: "Import rich-v1 Example pack — 12 members, 480 Sessions" }).click();
  await expect(page.getByRole("status", { name: "Example pack import status" })).toContainText("480 Seeded Sessions", { timeout: 30_000 });

  await page.getByRole("checkbox", { name: "Include clearly labelled Seeded examples" }).check();
  await expect(page.getByRole("navigation", { name: "Activity pagination" })).toContainText("Page 1 · 480 Sessions");
  const next = page.getByRole("button", { name: "Next activity page" });
  await next.click();
  await expect(page.getByRole("navigation", { name: "Activity pagination" })).toContainText("Page 2 · 480 Sessions");
  for (let pageNumber = 3; pageNumber <= 20; pageNumber += 1) {
    await next.click();
    await expect(page.getByRole("navigation", { name: "Activity pagination" })).toContainText(`Page ${pageNumber} · 480 Sessions`);
  }
  await expect(next).toBeDisabled();

  const sessionRow = page.getByRole("button", { name: /Seeded-rich-v1|Example/i }).first();
  await sessionRow.focus();
  await expect(sessionRow).toBeFocused();
  await sessionRow.press("Enter");
  await expect(page.getByRole("region", { name: "Session summary" })).toContainText("Seeded Example");
  await expect(page.getByRole("region", { name: "Session summary" })).toContainText("Coverage");
  await expect(page.getByRole("region", { name: "Linear execution timeline" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const timelineNode = page.locator(".linear-timeline li > button").first();
  await expect(timelineNode).toBeVisible();
  const reducedMotion = await timelineNode.evaluate((node) => {
    const duration = getComputedStyle(node).transitionDuration.split(",")[0]?.trim() ?? "0s";
    return {
      requested: matchMedia("(prefers-reduced-motion: reduce)").matches,
      durationMs: duration.endsWith("ms")
        ? Number.parseFloat(duration)
        : Number.parseFloat(duration) * 1_000,
    };
  });
  expect(reducedMotion.requested).toBe(true);
  expect(reducedMotion.durationMs).toBeLessThanOrEqual(0.01);

  await page.setViewportSize({ width: 390, height: 844 });
  const shell = await page.getByRole("region", { name: "Session investigation" }).boundingBox();
  const inspector = await page.getByRole("region", { name: "Evidence inspector" }).boundingBox();
  expect(shell?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(390);
  expect(inspector?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(shell?.width ?? 0);
  await expect(page.getByRole("region", { name: "Evidence inspector" })).toBeVisible();
}, 180_000);
