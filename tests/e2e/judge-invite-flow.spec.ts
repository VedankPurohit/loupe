import { expect, test, type Page } from "@playwright/test";

import { signedGoogleFixture } from "./google-auth-fixture.js";

async function installOperatorGoogleFixture(page: Page) {
  await page.exposeFunction("signJudgeOperatorFixture", (nonce: string) =>
    signedGoogleFixture({ nonce, subject: "judge-readiness-operator" }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.google={accounts:{id:{initialize(c){window.__judgeGis=c},renderButton(p){const b=document.createElement('button');b.textContent='Continue with Google';b.onclick=async()=>window.__judgeGis.callback({credential:await window.signJudgeOperatorFixture(window.__judgeGis.nonce)});p.append(b)},revoke(_h,cb){cb()}}}}`,
    }),
  );
}

test("a judge enters a populated Organization with only a single-use Invite code", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installOperatorGoogleFixture(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("New Organization name").fill("Judge Readiness Organization");
  await page.getByRole("button", { name: "Create Organization" }).click();

  await page
    .getByRole("button", {
      name: "Import rich-v1 Example pack — 12 members, 480 Sessions",
    })
    .click();
  await expect(
    page.getByRole("status", { name: "Example pack import status" }),
  ).toContainText(
    "12 Example members, 480 Seeded Sessions, 1,088 Turns, 864 Agent runs, and 3,104 detail records",
    { timeout: 30_000 },
  );

  await page.getByRole("button", { name: "Create Invite code" }).click();
  const inviteCode = await page
    .locator('output[aria-label="Invite code"]')
    .textContent();
  expect(inviteCode).toMatch(/^invite_/);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose how you enter Loupe" }),
  ).toBeVisible();
  await expect(page.getByText("Path B · One-time Invite")).toBeVisible();

  await page.getByLabel("Your display name").fill("Hackathon Judge");
  await page.getByRole("textbox", { name: "Invite code" }).fill(inviteCode!);
  await page.getByRole("button", { name: "Join Organization" }).click();

  await expect(page.getByLabel("Active Organization")).toContainText(
    "Judge Readiness Organization — Member",
  );
  await page
    .getByRole("checkbox", { name: "Include clearly labelled Seeded examples" })
    .check();
  await expect(page.getByRole("navigation", { name: "Activity pagination" })).toContainText(
    "480 Sessions",
  );
  await expect(page.getByRole("region", { name: "Session summary" })).toBeVisible();
  await expect(page.getByText(/Seeded Session · rich-v1/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Linear execution timeline" }),
  ).toBeVisible();
  const timeline = page.getByRole("region", { name: "Linear execution timeline" });
  await timeline.locator("summary").first().click();
  await expect(
    timeline.getByText(/Server-controlled Example-pack evidence · rich-v1/).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByLabel("Your display name").fill("Second Judge");
  await page.getByRole("textbox", { name: "Invite code" }).fill(inviteCode!);
  await page.getByRole("button", { name: "Join Organization" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The Invite code is invalid, expired, revoked, or already used.",
  );
});
