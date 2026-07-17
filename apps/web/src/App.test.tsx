import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { App } from "./App.js";

test("a rejected enrollment operation shows an actionable operation-specific alert", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session")) {
      return new Response(JSON.stringify({
        organization: { id: "organization-1", name: "Acme" },
        member: { id: "member-1", displayName: "Ada", role: "member" },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/devices")) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    if (url.includes("/api/v1/organization/activity")) {
      return new Response(JSON.stringify({
        items: [],
        page: { total: 0, limit: 50, offset: 0 },
        aggregates: {
          activityStates: { live: 0, idle: 0, resumed: 0 },
          outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
          members: 0,
        },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/device-enrollment-grants")) {
      throw new TypeError("Failed to fetch");
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<App />);
  await screen.findByRole("heading", { name: "Welcome, Ada" });
  await user.type(screen.getByLabelText("Device name"), "Ada's Mac");
  await user.click(screen.getByRole("button", { name: "Create enrollment grant" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Creating an enrollment grant failed");
  expect(screen.getByRole("button", { name: "Try creating enrollment grant" })).toBeEnabled();
});
