import { expect, test, type Page } from "@playwright/test";

import { signedGoogleFixture } from "./google-auth-fixture.js";

async function installGoogleFixture(
  page: Page,
  subject: string,
) {
  const identity = { subject };
  await page.exposeFunction("signOrganizationGoogleFixture", (nonce: string) =>
    signedGoogleFixture({ nonce, subject: identity.subject }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.google = { accounts: { id: {
          initialize(configuration) { window.__organizationGis = configuration; },
          renderButton(parent) {
            const button = document.createElement("button");
            button.textContent = "Continue with Google";
            button.onclick = async () => {
              const credential = await window.signOrganizationGoogleFixture(window.__organizationGis.nonce);
              window.__organizationGis.callback({ credential });
            };
            parent.append(button);
          },
          revoke(_hint, callback) { callback(); }
        } } };
      `,
    }),
  );
  return {
    useSubject(nextSubject: string) {
      identity.subject = nextSubject;
    },
  };
}

test("an Administrator imports rich-v1 and membership navigation survives history, refresh, and an invalid deep link", async ({
  page,
}) => {
  const googleFixture = await installGoogleFixture(
    page,
    "organization-switching-person",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByText("No Organization memberships yet.")).toBeVisible();
  await page.getByLabel("New Organization name").fill("Playwright Organization A");
  await page.getByRole("button", { name: "Create Organization" }).click();
  await expect(page.getByLabel("Active Organization")).toHaveValue(/.+/);
  const organizationAMembership = await page.getByLabel("Active Organization").inputValue();

  await page
    .getByRole("button", {
      name: "Import rich-v1 Example pack — 12 members, 480 Sessions",
    })
    .click();
  const importStatus = page.getByRole("status", {
    name: "Example pack import status",
  });
  await expect(importStatus).toContainText(
    "12 Example members, 480 Seeded Sessions, 1,088 Turns, 864 Agent runs, and 3,104 detail records",
    { timeout: 30_000 },
  );
  await expect(importStatus).toContainText(
    "permanently labelled Seeded/Example",
  );

  await page.getByLabel("New Organization name").fill("Playwright Organization B");
  await page.getByRole("button", { name: "Create Organization" }).click();
  await expect.poll(() => page.getByLabel("Active Organization").inputValue()).not.toBe(
    organizationAMembership,
  );
  const organizationBMembership = await page.getByLabel("Active Organization").inputValue();

  await page.getByLabel("Active Organization").selectOption(organizationAMembership);
  await expect(page).toHaveURL(new RegExp(`membership=${organizationAMembership}`));
  await page.reload();
  await expect(page.getByLabel("Active Organization")).toHaveValue(
    organizationAMembership,
  );

  await page.goBack();
  await expect(page.getByLabel("Active Organization")).toHaveValue(
    organizationBMembership,
  );
  await page
    .getByRole("checkbox", { name: "Include clearly labelled Seeded examples" })
    .check();
  await expect(
    page.getByText("No Sessions match this evidence search."),
  ).toBeVisible();

  await page.goto("/?membership=00000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("alert")).toContainText(
    "Selecting the Organization failed",
  );
  await expect(page.getByRole("alert")).toContainText(
    "not available to this Person",
  );

  await page.getByRole("button", { name: "Create Invite code" }).click();
  const inviteOutput = page.locator('output[aria-label="Invite code"]');
  await expect(inviteOutput).toHaveText(/^invite_/);
  const revokedCode = await inviteOutput.textContent();
  await page.getByRole("button", { name: "Revoke Invite code" }).click();
  await expect(page.getByRole("button", { name: "Revoke Invite code" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Invite code" }).last().fill(revokedCode!);
  await page.getByRole("button", { name: "Redeem Invite" }).click();
  await expect(
    page.getByText("The Invite code is invalid, expired, revoked, or already used."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create Invite code" }).click();
  await expect(inviteOutput).toHaveText(/^invite_/);
  const activeInviteCode = await inviteOutput.textContent();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Redeem your Invite code" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Create or join another Organization")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", {
    name: "Playwright Organization A — Administrator",
  }).click();
  await expect(page).toHaveURL(new RegExp(`membership=${organizationAMembership}`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`membership=${organizationAMembership}`));
  await expect(page.getByLabel("Active Organization")).toHaveValue(
    organizationAMembership,
  );

  googleFixture.useSubject("organization-invited-person");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("No Organization memberships yet.")).toBeVisible();
  await page.getByRole("textbox", { name: "Invite code" }).fill(activeInviteCode!);
  await page.getByRole("button", { name: "Redeem Invite" }).click();
  await expect(page.getByLabel("Active Organization")).toContainText(
    "Playwright Organization B — Member",
  );
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Redeem your Invite code" })).toBeVisible();
});
