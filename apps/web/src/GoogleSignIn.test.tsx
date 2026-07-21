import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { GoogleSignIn } from "./GoogleSignIn.js";

test("uses only the public Web client ID and one-time nonce before exchanging the GIS credential", async () => {
  const user = userEvent.setup();
  const onAuthenticated = vi.fn();
  let credentialCallback: ((response: { credential: string }) => void) | undefined;
  const initialize = vi.fn((configuration: {
    callback: (response: { credential: string }) => void;
  }) => {
    credentialCallback = configuration.callback;
  });
  const renderButton = vi.fn((element: HTMLElement) => {
    const button = document.createElement("button");
    button.textContent = "Continue with Google";
    button.addEventListener("click", () =>
      credentialCallback?.({ credential: "signed-development-id-token" }),
    );
    element.append(button);
  });
  window.google = {
    accounts: { id: { initialize, renderButton, revoke: vi.fn() } },
  };

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          clientId: "public-web-client.apps.googleusercontent.com",
          transaction: "transaction-value-that-is-at-least-32-characters",
          nonce: "one-time-nonce-value-that-is-at-least-32-characters",
          csrfToken: "csrf-token-value-that-is-at-least-32-characters",
          expiresAt: "2026-07-18T10:05:00.000Z",
        }),
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          person: {
            id: "8eb944de-8c6c-4f1d-8c47-cd1ffce4eef7",
            displayName: "Google Person",
            email: "person@example.test",
          },
          organization: null,
          member: null,
          googleProfile: { subject: "stable-sub", avatarUrl: null },
        }),
        { status: 201 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<GoogleSignIn onAuthenticated={onAuthenticated} />);
  await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

  expect(initialize).toHaveBeenCalledWith({
    client_id: "public-web-client.apps.googleusercontent.com",
    nonce: "one-time-nonce-value-that-is-at-least-32-characters",
    auto_select: false,
    callback: expect.any(Function),
  });
  expect(initialize.mock.calls[0]![0]).not.toHaveProperty("scope");
  expect(initialize.mock.calls[0]![0]).not.toHaveProperty("client_secret");
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/auth/google/session");
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({
    transaction: "transaction-value-that-is-at-least-32-characters",
    nonce: "one-time-nonce-value-that-is-at-least-32-characters",
    csrfToken: "csrf-token-value-that-is-at-least-32-characters",
    credential: "signed-development-id-token",
  });
  expect(localStorage).toHaveLength(0);
});
