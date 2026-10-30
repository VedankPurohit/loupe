import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { App } from "./App.js";

test("an unauthenticated visitor sees a useful public homepage and safe setup links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/session")) {
        return new Response(JSON.stringify({ organization: null, member: null }), {
          status: 401,
        });
      }
      if (url.endsWith("/api/v1/bootstrap/status")) {
        return new Response(JSON.stringify({ required: false }), { status: 200 });
      }
      if (url.endsWith("/api/v1/auth/google/transactions")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "GOOGLE_AUTH_NOT_CONFIGURED",
              message: "Google authentication is not configured for this deployment.",
            },
          }),
          { status: 503 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: /see the work\. keep the proof\./i }),
  ).toBeVisible();
  expect(screen.getByText(/capture support is versioned and bounded/i)).toBeVisible();
  expect(screen.getByRole("link", { name: /read setup guidance/i })).toHaveAttribute(
    "href",
    "/guide.html",
  );
  expect(screen.getByRole("link", { name: /source repository/i })).toHaveAttribute(
    "href",
    "https://github.com/VedankPurohit/loupe",
  );
  expect(
    screen.getByRole("heading", { name: /Google or a one-time code/i }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: /use an Invite code/i })).toBeVisible();
  expect(
    await screen.findByRole("status", { name: "Google sign-in availability" }),
  ).toHaveTextContent(/Bootstrap or Invite code/i);
});

test("a revoked browser session explains the next safe action", async () => {
  window.history.replaceState({}, "", "/?membership=revoked-member");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/session")) return new Response(null, { status: 401 });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );

  render(<App />);

  expect(await screen.findByRole("heading", { name: /loupe session ended/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /return to the public homepage/i })).toHaveAttribute(
    "href",
    "/",
  );
  window.history.replaceState({}, "", "/");
});
