import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { DeviceDiagnostics } from "./DeviceDiagnostics.js";

const device = {
  id: "11111111-1111-4111-8111-111111111111",
  memberId: "22222222-2222-4222-8222-222222222222",
  name: "Operator Mac",
  health: "healthy" as const,
  lastSeenAt: "2026-07-18T08:00:02.000Z",
  createdAt: "2026-07-18T07:00:00.000Z",
  capturePolicy: {
    version: 1,
    ordinaryRedactionEnabled: true,
    demoCanaryEnabled: false,
  },
};

test("installation health names missing prerequisites without coding-only cards", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          deviceId: device.id,
          installationHealth: [
            {
              kind: "installation_health",
              verificationId: "setup-verification-20260718",
              sourceEventId: "33333333-3333-4333-8333-333333333333",
              verificationTime: "2026-07-18T08:00:01.000Z",
              serverEndpoint: { state: "not_observed", value: null },
              hookTrust: { state: "not_observed", value: null },
              relay: { state: "not_observed", value: null },
              queue: { state: "not_observed", pending: null, poisoned: null },
              deliveryAcknowledgement: {
                state: "acknowledged",
                acknowledgedAt: "2026-07-18T08:00:02.000Z",
              },
              missingPrerequisites: [
                {
                  code: "SERVER_ENDPOINT_NOT_OBSERVED",
                  name: "Server endpoint",
                  action:
                    "Rerun setup verification with a current installer to record the server endpoint.",
                },
                {
                  code: "HOOK_TRUST_NOT_OBSERVED",
                  name: "Hook trust",
                  action:
                    "Verify the installed hooks are trusted, then rerun setup verification.",
                },
                {
                  code: "RELAY_STATE_NOT_OBSERVED",
                  name: "Relay state",
                  action: "Start or restart the relay, then rerun setup verification.",
                },
                {
                  code: "QUEUE_STATE_NOT_OBSERVED",
                  name: "Delivery queue state",
                  action:
                    "Inspect the relay queue and retry delivery before rerunning setup verification.",
                },
              ],
              problems: [],
              links: {
                self: `/api/v1/devices/${device.id}/diagnostics`,
                sourceEvent:
                  "/api/v1/source-events/33333333-3333-4333-8333-333333333333",
              },
              nextAction: {
                kind: "rerun_setup_verification",
                label: "Rerun setup verification after repair",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );

  render(<DeviceDiagnostics devices={[device]} />);

  const region = await screen.findByRole("region", {
    name: "Device diagnostics",
  });
  expect(within(region).getByRole("heading", { name: "Operator Mac" })).toBeVisible();
  expect(within(region).getByText("Installation health")).toBeVisible();
  expect(within(region).getByText("Delivery acknowledged")).toBeVisible();
  expect(within(region).getAllByText("Not observed")).toHaveLength(4);
  expect(
    within(region).getByRole("heading", { name: "Missing prerequisites" }),
  ).toBeVisible();
  expect(within(region).getByText("Verify the installed hooks are trusted, then rerun setup verification."))
    .toBeVisible();
  expect(
    within(region).getByRole("link", { name: "Inspect preserved verification evidence" }),
  ).toHaveAttribute(
    "href",
    "/api/v1/source-events/33333333-3333-4333-8333-333333333333",
  );
  expect(
    within(region).getByRole("button", {
      name: "Rerun setup verification after repair",
    }),
  ).toBeEnabled();

  for (const codingOnlyCard of [
    "Repository",
    "Model",
    "Token",
    "Context",
    "Tool",
    "MCP",
    "Skill",
  ]) {
    expect(within(region).queryByRole("heading", { name: codingOnlyCard })).not.toBeInTheDocument();
  }
});

test("a diagnostic request error offers a scoped retry", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Device diagnostics are temporarily unavailable. Check PostgreSQL and retry.",
            },
          }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({ deviceId: device.id, installationHealth: [] }),
        { status: 200 },
      );
    }),
  );

  render(<DeviceDiagnostics devices={[device]} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Device diagnostics are temporarily unavailable. Check PostgreSQL and retry.",
  );
  await user.click(
    screen.getByRole("button", { name: "Retry Operator Mac diagnostics" }),
  );

  expect(await screen.findByText("No setup verification received yet.")).toBeVisible();
  expect(screen.getByText("Run setup verification, then retry diagnostics.")).toBeVisible();
  expect(attempts).toBe(2);
});
