import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { loadInspectorFixture } from "./session-fixture.js";

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

test("an operator redeems Bootstrap and inspects a live resumable Session", async ({
  page,
  request,
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
  const { credential } = (await enrollment.json()) as { credential: string };

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

  const fixture = await loadInspectorFixture();
  const deliver = (events: typeof fixture.initial) =>
    request.post("/api/v1/device/source-event-batches", {
      headers: { authorization: `Bearer ${credential}` },
      data: { batchId: randomUUID(), events },
    });

  expect((await deliver(fixture.initial)).status()).toBe(200);
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Session inspector" }),
  ).toBeVisible();
  await expect(page.getByText("session-probe-001", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Root agent run", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Subagent run", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Unresolved parent", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("turn-probe-006", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Documented, observed · exact", { exact: true }).first()).toBeVisible();

  expect((await deliver(fixture.live)).status()).toBe(200);
  await expect(page.getByText("Resume", { exact: true }).last()).toBeVisible();

  await page.route("**/api/v1/live", (route) => route.abort("connectionrefused"));
  await page.reload();
  await expect(page.getByRole("status", { name: "Live updates" })).toContainText(
    "interrupted",
  );
  expect((await deliver(fixture.afterDisconnect)).status()).toBe(200);
  await page.unroute("**/api/v1/live");

  await expect(page.getByText("turn-probe-008", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("status", { name: "Live updates" })).toContainText(
    "connected",
  );
});
