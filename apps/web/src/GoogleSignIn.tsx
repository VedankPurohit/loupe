import { useEffect, useRef, useState } from "react";

import type {
  GoogleAuthTransactionResponse,
  GoogleBrowserSessionResponse,
} from "@workspace/contracts";

type GoogleCredentialResponse = { credential: string };
type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize(configuration: {
        client_id: string;
        nonce: string;
        auto_select: false;
        callback(response: GoogleCredentialResponse): void;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: { type: "standard"; theme: "outline"; text: "continue_with" },
      ): void;
      revoke(hint: string, callback: () => void): void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

export function revokeGoogleIdentitySharing(hint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error("Google Identity Services is not available."));
      return;
    }
    window.google.accounts.id.revoke(hint, resolve);
  });
}

let googleScriptPromise: Promise<void> | undefined;

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services did not load."));
    document.head.append(script);
  });
  return googleScriptPromise;
}

async function errorDetail(response: Response): Promise<{
  code?: string;
  message: string;
}> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string; message?: string } }
    | undefined;
  return {
    code: body?.error?.code,
    message: body?.error?.message ?? "Google sign-in could not be completed.",
  };
}

export function GoogleSignIn({
  onAuthenticated,
}: {
  onAuthenticated(session: GoogleBrowserSessionResponse): void;
}) {
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [availability, setAvailability] = useState<
    "checking" | "ready" | "unavailable"
  >("checking");

  useEffect(() => {
    let active = true;
    void (async () => {
      setError(undefined);
      setAvailability("checking");
      const transactionResponse = await fetch(
        "/api/v1/auth/google/transactions",
        { method: "POST" },
      );
      if (!transactionResponse.ok) {
        const failure = await errorDetail(transactionResponse);
        if (failure.code === "GOOGLE_AUTH_NOT_CONFIGURED") {
          if (active) setAvailability("unavailable");
          return;
        }
        throw new Error(failure.message);
      }
      const transaction =
        (await transactionResponse.json()) as GoogleAuthTransactionResponse;
      await loadGoogleIdentityServices();
      if (!active || !window.google || !button.current) return;
      setAvailability("ready");
      window.google.accounts.id.initialize({
        client_id: transaction.clientId,
        nonce: transaction.nonce,
        auto_select: false,
        callback: (response) => {
          void (async () => {
            const sessionResponse = await fetch("/api/v1/auth/google/session", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                transaction: transaction.transaction,
                nonce: transaction.nonce,
                csrfToken: transaction.csrfToken,
                credential: response.credential,
              }),
            });
            if (!sessionResponse.ok) {
              throw new Error((await errorDetail(sessionResponse)).message);
            }
            const session =
              (await sessionResponse.json()) as GoogleBrowserSessionResponse;
            if (active) onAuthenticated(session);
          })().catch((cause: unknown) => {
            if (active) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Google sign-in could not be completed.",
              );
            }
          });
        },
      });
      button.current.replaceChildren();
      window.google.accounts.id.renderButton(button.current, {
        type: "standard",
        theme: "outline",
        text: "continue_with",
      });
    })().catch((cause: unknown) => {
      if (active) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Google sign-in is not available.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [onAuthenticated]);

  return (
    <div className="google-sign-in" data-availability={availability}>
      <div ref={button} aria-label="Google sign-in" />
      {availability === "checking" && !error && (
        <p className="google-checking" role="status">Checking Google sign-in…</p>
      )}
      {availability === "unavailable" && (
        <div
          aria-label="Google sign-in availability"
          className="google-unavailable"
          role="status"
        >
          <strong>Google sign-in isn’t enabled here.</strong>
          <span>Continue with a Bootstrap or Invite code. No Google account is required.</span>
          <a className="google-fallback" href="/guide.html">
            Configure Google sign-in
          </a>
        </div>
      )}
      {error && (
        <>
          <p role="alert" className="error">{error}</p>
          <a className="google-fallback" href="/guide.html">
            Troubleshoot Google sign-in
          </a>
        </>
      )}
    </div>
  );
}
