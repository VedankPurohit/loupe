import { expect, test } from "@playwright/test";

import { signedGoogleFixture } from "./google-auth-fixture.js";

test("the browser exchanges a GIS credential through the real Loupe API without Google API access", async ({
  page,
}) => {
  const exchangedBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/google/session")) {
      exchangedBodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.exposeFunction("signGoogleFixture", (nonce: string) =>
    signedGoogleFixture({ nonce }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.google = { accounts: { id: {
          initialize(configuration) { window.__loupeGisConfiguration = configuration; },
          renderButton(parent) {
            const button = document.createElement("button");
            button.textContent = "Continue with Google";
            button.onclick = async () => {
              const credential = await window.signGoogleFixture(window.__loupeGisConfiguration.nonce);
              window.__loupeGisConfiguration.callback({ credential });
            };
            parent.append(button);
          },
          revoke(hint, callback) {
            window.__loupeRevokedGoogleHint = hint;
            callback();
          }
        } } };
      `,
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(
    page.getByRole("heading", { name: "Welcome, Playwright Google Person" }),
  ).toBeVisible();
  const gisConfiguration = await page.evaluate(() =>
    (window as typeof window & {
      __loupeGisConfiguration: Record<string, unknown>;
    }).__loupeGisConfiguration,
  );
  expect(gisConfiguration).toMatchObject({
    client_id: "loupe-playwright.apps.googleusercontent.com",
    auto_select: false,
  });
  expect(gisConfiguration).not.toHaveProperty("scope");
  expect(gisConfiguration).not.toHaveProperty("client_secret");
  expect(exchangedBodies).toHaveLength(1);
  expect(exchangedBodies[0]).toMatchObject({
    transaction: expect.any(String),
    nonce: gisConfiguration.nonce,
    csrfToken: expect.any(String),
    credential: expect.stringMatching(/^eyJ/),
  });
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  await page.getByRole("button", { name: "Unlink Google" }).click();
  await expect(
    page.getByRole("button", { name: "Unlink Google" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __loupeRevokedGoogleHint: string })
          .__loupeRevokedGoogleHint,
    ),
  ).toBe("playwright@example.test");
});
