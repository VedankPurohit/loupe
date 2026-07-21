import { expect, test } from "@playwright/test";

test("a visitor can orient on the public homepage and reach safe setup paths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/v1/bootstrap/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ required: false }),
    }),
  );
  await page.route("**/api/v1/auth/google/transactions", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Google sign-in is not configured in this browser test." } }),
    }),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /see the work\. keep the proof\./i })).toBeVisible();
  await expect(page.getByText(/capture support is versioned and bounded/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Setup guidance", exact: true })).toHaveAttribute("href", "/guide.html");
  await expect(page.getByRole("link", { name: "Source repository" })).toHaveAttribute(
    "href",
    "https://github.com/VedankPurohit/loupe",
  );
  await expect(page.getByRole("region", { name: /start with Google/i })).toBeVisible();
  await expect(page.getByLabel("Google sign-in")).toBeAttached();
  await expect(page.getByRole("link", { name: /Google sign-in setup guidance/i })).toBeVisible();
  await page.getByRole("link", { name: /I have an Invite code/i }).click();
  await expect(page.getByRole("heading", { name: "Redeem your Invite code" })).toBeVisible();
});
