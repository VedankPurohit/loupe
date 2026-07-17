import { type FormEvent, useEffect, useState } from "react";

import type {
  AuthenticatedSessionResponse,
  CapturePolicy,
  EnrolledDevice,
} from "@workspace/contracts";

import { SessionInspector } from "./SessionInspector.js";

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
  const [devices, setDevices] = useState<EnrolledDevice[]>([]);
  const [deviceError, setDeviceError] = useState<string>();
  const [enrollmentGrant, setEnrollmentGrant] = useState<string>();
  const [inviteCode, setInviteCode] = useState<string>();
  const [inviteError, setInviteError] = useState<string>();
  const [examplePackStatus, setExamplePackStatus] = useState<string>();

  async function loadDevices() {
    const response = await fetch("/api/v1/devices");
    if (!response.ok) {
      setDeviceError("Enrolled devices could not be loaded.");
      return;
    }
    const body = (await response.json()) as { devices: EnrolledDevice[] };
    setDevices(body.devices);
    setDeviceError(undefined);
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

  async function createEnrollmentGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeviceError(undefined);
    setEnrollmentGrant(undefined);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/device-enrollment-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceName: data.get("deviceName") }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      const error = body as { error?: { message?: string } } | undefined;
      setDeviceError(
        error?.error?.message ?? "The enrollment grant could not be created.",
      );
      return;
    }
    setEnrollmentGrant((body as { grant: string }).grant);
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(undefined);
    setInviteCode(undefined);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresInHours: Number(data.get("expiresInHours")) }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      const error = body as { error?: { message?: string } } | undefined;
      setInviteError(error?.error?.message ?? "The Invite code could not be created.");
      return;
    }
    setInviteCode((body as { code: string }).code);
  }

  async function importExamplePack() {
    setExamplePackStatus("Importing the versioned starter pack…");
    const response = await fetch(
      "/api/v1/administration/example-packs/starter-v1/import",
      { method: "POST" },
    );
    const body = await readJson(response);
    if (!response.ok) {
      const error = body as { error?: { message?: string } } | undefined;
      setExamplePackStatus(
        error?.error?.message ?? "The Example data pack could not be imported.",
      );
      return;
    }
    const result = body as { imported: boolean; sessionIds: string[] };
    setExamplePackStatus(
      `${result.imported ? "Imported" : "Already imported"} starter-v1: ${result.sessionIds.join(", ")}. Every record is permanently labelled Seeded/Example.`,
    );
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
        setFormError(error?.error?.message ?? "The Invite code could not be redeemed.");
        return;
      }
      setView({ kind: "session", session: body as AuthenticatedSessionResponse });
      await loadDevices();
    } catch {
      setFormError("The application could not reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePolicy(
    deviceId: string,
    change: Partial<Pick<CapturePolicy, "ordinaryRedactionEnabled" | "demoCanaryEnabled">>,
  ) {
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
    const response = await fetch(`/api/v1/devices/${deviceId}/capture-policy`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
    if (!response.ok) {
      setDeviceError("The capture policy could not be updated.");
      await loadDevices();
      return;
    }
    const capturePolicy = (await response.json()) as CapturePolicy;
    setDevices((current) =>
      current.map((device) =>
        device.id === deviceId ? { ...device, capturePolicy } : device,
      ),
    );
  }

  async function revokeDevice(deviceId: string) {
    const response = await fetch(`/api/v1/devices/${deviceId}/revoke`, {
      method: "POST",
    });
    if (!response.ok) {
      setDeviceError("The Device credential could not be revoked.");
      return;
    }
    await loadDevices();
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
          </section>

          <SessionInspector member={view.session.member} />

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
              {inviteError && <p role="alert" className="error">{inviteError}</p>}
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
                {examplePackStatus && <output>{examplePackStatus}</output>}
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
            {deviceError && <p role="alert" className="error">{deviceError}</p>}
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
        </section>
      )}
    </main>
  );
}
