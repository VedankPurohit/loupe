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
});
