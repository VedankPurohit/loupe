import { type FormEvent, useEffect, useState } from "react";

import type { AuthenticatedSessionResponse } from "@workspace/contracts";

type View =
  | { kind: "loading" }
  | { kind: "bootstrap" }
  | { kind: "established" }
  | { kind: "session"; session: AuthenticatedSessionResponse }
  | { kind: "error"; message: string };

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessionResponse = await fetch("/api/v1/session");
      if (sessionResponse.ok) {
        const session = (await sessionResponse.json()) as AuthenticatedSessionResponse;
        if (!cancelled) setView({ kind: "session", session });
        return;
      }

      const statusResponse = await fetch("/api/v1/bootstrap/status");
      if (!statusResponse.ok) {
        if (!cancelled) {
          setView({
            kind: "error",
            message: "The server is not ready. Check PostgreSQL and try again.",
          });
        }
        return;
      }
      const status = (await statusResponse.json()) as { required: boolean };
      if (!cancelled) {
        setView(status.required ? { kind: "bootstrap" } : { kind: "established" });
      }
    })().catch(() => {
      if (!cancelled) {
        setView({
          kind: "error",
          message: "The application could not reach the server.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/bootstrap/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: data.get("code"),
          organization: { name: data.get("organizationName") },
          administrator: { displayName: data.get("displayName") },
        }),
      });
      const body = await readJson(response);
      if (response.ok) {
        setView({ kind: "session", session: body as AuthenticatedSessionResponse });
      } else {
        const error = body as { error?: { message?: string } } | undefined;
        setFormError(
          error?.error?.message ?? "The Bootstrap code could not be redeemed.",
        );
      }
    } catch {
      setFormError("The application could not reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">◉</span>
        <span>Loupe</span>
      </header>

      {view.kind === "loading" && <p className="status">Connecting to the server…</p>}

      {view.kind === "bootstrap" && (
        <section className="card" aria-labelledby="bootstrap-title">
          <p className="eyebrow">First-time setup</p>
          <h1 id="bootstrap-title">Establish your Organization</h1>
          <p className="lede">
            Use the single-use Bootstrap code printed by the server to create the
            first Administrator.
          </p>
          <form onSubmit={redeem}>
            <label>
              Organization name
              <input name="organizationName" autoComplete="organization" required />
            </label>
            <label>
              Your display name
              <input name="displayName" autoComplete="name" required />
            </label>
            <label>
              Bootstrap code
              <input name="code" autoComplete="off" spellCheck={false} required />
            </label>
            {formError && <p role="alert" className="error">{formError}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Organization"}
            </button>
          </form>
        </section>
      )}

      {view.kind === "session" && (
        <section className="card" aria-labelledby="welcome-title">
          <p className="eyebrow">Organization ready</p>
          <h1 id="welcome-title">Welcome, {view.session.member.displayName}</h1>
          <div className="identity-row">
            <div>
              <span className="detail-label">Organization</span>
              <strong>{view.session.organization.name}</strong>
            </div>
            <div>
              <span className="detail-label">Role</span>
              <strong className="role">Administrator</strong>
            </div>
          </div>
          <p className="lede">
            Your authenticated browser session is active. Agent-session views
            will appear here as capture is connected.
          </p>
        </section>
      )}

      {view.kind === "established" && (
        <section className="card">
          <h1>This Organization is already established</h1>
          <p className="lede">Open this application from an authenticated browser.</p>
        </section>
      )}

      {view.kind === "error" && (
        <section className="card" role="alert">
          <h1>Unable to start</h1>
          <p className="error">{view.message}</p>
        </section>
      )}
    </main>
  );
}
