import { type FormEvent, useEffect, useState } from "react";

import type {
  AuthenticatedSessionResponse,
  CapturePolicy,
  EnrolledDevice,
} from "@workspace/contracts";

import { SessionInspector } from "./SessionInspector.js";
import { CandidateStandards } from "./CandidateStandards.js";

type View =
  | { kind: "loading" }
  | { kind: "bootstrap" }
  | { kind: "established" }
  | { kind: "session"; session: AuthenticatedSessionResponse }
  | { kind: "error"; message: string };

type RetryNotice = {
  message: string;
  retryLabel: string;
  retry: () => void | Promise<void>;
};

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The server could not be reached.");
  }
  const body = await readJson(response);
  if (!response.ok) {
    const error = body as { error?: { message?: string } } | undefined;
    throw new Error(error?.error?.message ?? `The server rejected the request (${response.status}).`);
  }
  return body as T;
}

function operationFailure(operation: string, cause: unknown) {
  const reason = cause instanceof Error ? cause.message : "The request did not complete.";
  return `${operation} failed. ${reason} Check the connection and try again.`;
}

function RetryAlert({ notice }: { notice: RetryNotice }) {
  return (
    <div role="alert" className="error operation-error">
      <span>{notice.message}</span>
      <button className="secondary-button" onClick={() => void notice.retry()} type="button">
        {notice.retryLabel}
      </button>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [devices, setDevices] = useState<EnrolledDevice[]>([]);
  const [deviceError, setDeviceError] = useState<RetryNotice>();
  const [enrollmentGrant, setEnrollmentGrant] = useState<string>();
  const [inviteCode, setInviteCode] = useState<string>();
  const [inviteError, setInviteError] = useState<RetryNotice>();
  const [examplePackStatus, setExamplePackStatus] = useState<string>();
  const [examplePackError, setExamplePackError] = useState<RetryNotice>();

  async function loadDevices() {
    try {
      const body = await requestJson<{ devices: EnrolledDevice[] }>("/api/v1/devices");
      setDevices(body.devices);
      setDeviceError(undefined);
    } catch (cause) {
      setDeviceError({
        message: operationFailure("Loading enrolled devices", cause),
        retryLabel: "Try loading devices again",
        retry: loadDevices,
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessionResponse = await fetch("/api/v1/session");
      if (sessionResponse.ok) {
        const session = (await sessionResponse.json()) as AuthenticatedSessionResponse;
        if (!cancelled) {
          setView({ kind: "session", session });
          await loadDevices();
        }
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
        await loadDevices();
      } else {
        const error = body as { error?: { message?: string } } | undefined;
        setFormError(error?.error?.message ?? "Redeeming the Bootstrap code failed. Check the code and try again.");
      }
    } catch (cause) {
      setFormError(operationFailure("Redeeming the Bootstrap code", cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function createEnrollmentGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createEnrollmentGrantFor(String(data.get("deviceName") ?? ""));
  }

  async function createEnrollmentGrantFor(deviceName: string) {
    setDeviceError(undefined);
    setEnrollmentGrant(undefined);
    try {
      const body = await requestJson<{ grant: string }>("/api/v1/device-enrollment-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceName }),
      });
      setEnrollmentGrant(body.grant);
    } catch (cause) {
      setDeviceError({
        message: operationFailure("Creating an enrollment grant", cause),
        retryLabel: "Try creating enrollment grant",
        retry: () => createEnrollmentGrantFor(deviceName),
      });
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createInviteFor(Number(data.get("expiresInHours")));
  }

  async function createInviteFor(expiresInHours: number) {
    setInviteError(undefined);
    setInviteCode(undefined);
    try {
      const body = await requestJson<{ code: string }>("/api/v1/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInHours }),
      });
      setInviteCode(body.code);
    } catch (cause) {
      setInviteError({
        message: operationFailure("Creating an Invite code", cause),
        retryLabel: "Try creating Invite code",
        retry: () => createInviteFor(expiresInHours),
      });
    }
  }

  async function importExamplePack() {
    setExamplePackStatus("Importing the versioned starter pack…");
    setExamplePackError(undefined);
    try {
      const result = await requestJson<{ imported: boolean; sessionIds: string[] }>(
        "/api/v1/administration/example-packs/starter-v1/import",
        { method: "POST" },
      );
      setExamplePackStatus(
        `${result.imported ? "Imported" : "Already imported"} starter-v1: ${result.sessionIds.join(", ")}. Every record is permanently labelled Seeded/Example.`,
      );
    } catch (cause) {
      setExamplePackStatus(undefined);
      setExamplePackError({
        message: operationFailure("Importing the Example data pack", cause),
        retryLabel: "Try importing starter-v1",
        retry: importExamplePack,
      });
    }
  }

  async function redeemInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/invites/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: data.get("inviteCode"),
          member: { displayName: data.get("displayName") },
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        const error = body as { error?: { message?: string } } | undefined;
        setFormError(error?.error?.message ?? "Redeeming the Invite code failed. Check the code and try again.");
        return;
      }
      setView({ kind: "session", session: body as AuthenticatedSessionResponse });
      await loadDevices();
    } catch (cause) {
      setFormError(operationFailure("Redeeming the Invite code", cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePolicy(
    deviceId: string,
    change: Partial<Pick<CapturePolicy, "ordinaryRedactionEnabled" | "demoCanaryEnabled">>,
  ) {
    const previousPolicy = devices.find((device) => device.id === deviceId)?.capturePolicy;
    setDevices((current) =>
      current.map((device) =>
        device.id === deviceId
          ? {
              ...device,
              capturePolicy: { ...device.capturePolicy, ...change },
            }
          : device,
      ),
    );
    try {
      const capturePolicy = await requestJson<CapturePolicy>(`/api/v1/devices/${deviceId}/capture-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });
      setDevices((current) => current.map((device) =>
        device.id === deviceId ? { ...device, capturePolicy } : device,
      ));
      setDeviceError(undefined);
    } catch (cause) {
      if (previousPolicy) {
        setDevices((current) => current.map((device) =>
          device.id === deviceId ? { ...device, capturePolicy: previousPolicy } : device,
        ));
      }
      setDeviceError({
        message: operationFailure("Updating the capture policy", cause),
        retryLabel: "Try updating capture policy",
        retry: () => updatePolicy(deviceId, change),
      });
    }
  }

  async function revokeDevice(deviceId: string) {
    try {
      await requestJson(`/api/v1/devices/${deviceId}/revoke`, { method: "POST" });
      await loadDevices();
    } catch (cause) {
      setDeviceError({
        message: operationFailure("Revoking the Device credential", cause),
        retryLabel: "Try revoking Device credential",
        retry: () => revokeDevice(deviceId),
      });
    }
  }

  async function logout() {
    setFormError(undefined);
    const response = await fetch("/api/v1/session/logout", { method: "POST" });
    if (!response.ok) {
      setFormError("The browser session could not be revoked. Try again.");
      return;
    }
    setDevices([]);
    setView({ kind: "established" });
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
        <>
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
                <strong className="role">
                  {view.session.member.role === "administrator"
                    ? "Administrator"
                    : "Member"}
                </strong>
              </div>
            </div>
            <p className="lede">
              Your authenticated browser session is active. Manage capture for
              your enrolled Macs below.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void logout()}
            >
              Log out
            </button>
            {formError && <p role="alert" className="error">{formError}</p>}
          </section>

          <SessionInspector member={view.session.member} />

          {view.session.member.role === "administrator" && <CandidateStandards />}

          {view.session.member.role === "administrator" && (
            <section className="card settings-card" aria-labelledby="invite-title">
              <p className="eyebrow">Members</p>
              <h2 id="invite-title">Invite an ordinary Member</h2>
              <form onSubmit={createInvite} className="grant-form">
                <label>
                  Expires in hours
                  <input
                    name="expiresInHours"
                    type="number"
                    min={1}
                    max={168}
                    defaultValue={24}
                    required
                  />
                </label>
                <button type="submit">Create Invite code</button>
              </form>
              {inviteCode && (
                <div className="grant-panel">
                  <span className="detail-label">Expiring, single-use Invite code</span>
                  <output aria-label="Invite code">{inviteCode}</output>
                  <p>Share it out of band. Redemption always creates a Member, never an Administrator.</p>
                </div>
              )}
              {inviteError && <RetryAlert notice={inviteError} />}
              <div className="grant-panel">
                <span className="detail-label">Explicit Example data</span>
                <p>
                  The idempotent starter-v1 pack uses a server-controlled path,
                  never a Device credential. Seeded Sessions stay excluded from
                  activity and aggregates until explicitly included.
                </p>
                <button type="button" onClick={() => void importExamplePack()}>
                  Import starter-v1 Example pack
                </button>
                {examplePackStatus && <output role="status">{examplePackStatus}</output>}
                {examplePackError && <RetryAlert notice={examplePackError} />}
              </div>
            </section>
          )}

          <section className="card settings-card" aria-labelledby="devices-title">
            <p className="eyebrow">Capture Settings</p>
            <h2 id="devices-title">Enrolled devices</h2>
            <form onSubmit={createEnrollmentGrant} className="grant-form">
              <label>
                Device name
                <input name="deviceName" required maxLength={120} />
              </label>
              <button type="submit">Create enrollment grant</button>
            </form>
            {enrollmentGrant && (
              <div className="grant-panel">
                <span className="detail-label">Short-lived, single-use grant</span>
                <output aria-label="Enrollment grant">{enrollmentGrant}</output>
                <p>
                  Exchange this grant during setup. It is not a browser session or
                  a Device credential.
                </p>
              </div>
            )}
            {deviceError && <RetryAlert notice={deviceError} />}
            <div className="device-list">
              {devices.map((device) => (
                <article className="device" key={device.id}>
                  <div className="device-heading">
                    <div>
                      <h3>{device.name}</h3>
                      <span className={`health health-${device.health}`}>
                        {device.health === "healthy" ? "Healthy" : "Revoked"}
                      </span>
                    </div>
                    <strong>Policy version {device.capturePolicy.version}</strong>
                  </div>
                  <p className="last-seen">
                    {device.lastSeenAt
                      ? `Last relay contact ${new Date(device.lastSeenAt).toLocaleString()}`
                      : "Awaiting first relay contact"}
                  </p>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={device.capturePolicy.ordinaryRedactionEnabled}
                      disabled={device.health === "revoked"}
                      onChange={(event) =>
                        void updatePolicy(device.id, {
                          ordinaryRedactionEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                    Ordinary high-confidence redaction
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={device.capturePolicy.demoCanaryEnabled}
                      disabled={device.health === "revoked"}
                      onChange={(event) =>
                        void updatePolicy(device.id, {
                          demoCanaryEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                    Demo redaction canary
                  </label>
                  {device.health !== "revoked" && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void revokeDevice(device.id)}
                    >
                      Revoke Device credential
                    </button>
                  )}
                </article>
              ))}
              {devices.length === 0 && (
                <p className="lede">No Macs are enrolled yet.</p>
              )}
            </div>
          </section>
        </>
      )}

      {view.kind === "established" && (
        <section className="card" aria-labelledby="invite-redeem-title">
          <p className="eyebrow">Join the Organization</p>
          <h1 id="invite-redeem-title">Redeem your Invite code</h1>
          <p className="lede">An Administrator can issue an expiring, single-use code for an ordinary Member.</p>
          <form onSubmit={redeemInvite}>
            <label>
              Your display name
              <input name="displayName" autoComplete="name" required />
            </label>
            <label>
              Invite code
              <input name="inviteCode" autoComplete="off" spellCheck={false} required />
            </label>
            {formError && <p role="alert" className="error">{formError}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Joining…" : "Join Organization"}
            </button>
          </form>
        </section>
      )}

      {view.kind === "error" && (
        <section className="card" role="alert">
          <h1>Unable to start</h1>
          <p className="error">{view.message}</p>
          <button type="button" onClick={() => window.location.reload()}>Try starting Loupe again</button>
        </section>
      )}
    </main>
  );
}
