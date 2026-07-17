import { expect, test } from "@playwright/test";

test("an operator can retry when Bootstrap redemption cannot reach the server", async ({
  page,
}) => {
  await page.route("**/api/v1/bootstrap/redeem", (route) =>
    route.abort("connectionrefused"),
  );
  await page.goto("/");

  await page.getByLabel("Organization name").fill("Acme Engineering");
  await page.getByLabel("Your display name").fill("Ada Lovelace");
  await page
    .getByLabel("Bootstrap code")
    .fill("bootstrap_playwright_0123456789abcdefghijklmnopqrstuvwxyz");
  await page.getByRole("button", { name: "Create Organization" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "The application could not reach the server. Try again.",
  );
  await expect(
    page.getByRole("button", { name: "Create Organization" }),
  ).toBeEnabled();
});

test("an operator redeems the Bootstrap code and becomes the Administrator", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Establish your Organization" }),
  ).toBeVisible();
  await page.getByLabel("Organization name").fill("Acme Engineering");
  await page.getByLabel("Your display name").fill("Ada Lovelace");
  await page
    .getByLabel("Bootstrap code")
    .fill("bootstrap_playwright_0123456789abcdefghijklmnopqrstuvwxyz");
  await page.getByRole("button", { name: "Create Organization" }).click();

  await expect(
    page.getByRole("heading", { name: "Welcome, Ada Lovelace" }),
  ).toBeVisible();
  await expect(page.getByText("Acme Engineering")).toBeVisible();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Ada Lovelace" }),
  ).toBeVisible();

  await page.getByLabel("Device name").fill("Ada's MacBook Pro");
  await page.getByRole("button", { name: "Create enrollment grant" }).click();
  const grant = await page.getByLabel("Enrollment grant").textContent();
  expect(grant).toMatch(/^enroll_[A-Za-z0-9_-]+$/);
  const enrollment = await page.request.post(
    "/api/v1/device-enrollments/redeem",
    { data: { grant } },
  );
  expect(enrollment.status()).toBe(201);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ada's MacBook Pro" }),
  ).toBeVisible();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Policy version 1", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Ordinary high-confidence redaction"),
  ).toBeChecked();
  await expect(page.getByLabel("Demo redaction canary")).not.toBeChecked();

  await page.getByLabel("Demo redaction canary").check();
  await expect(page.getByText("Policy version 2", { exact: true })).toBeVisible();
});
