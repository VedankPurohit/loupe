import { useCallback, useEffect, useState } from "react";

import type { EnrolledDevice } from "@workspace/contracts";

import "./device-diagnostics.css";

type Observation<T> = {
  state: "observed" | "not_observed";
  value: T | null;
};

type InstallationHealth = {
  kind: "installation_health";
  verificationId: string;
  sourceEventId: string;
  verificationTime: string;
  serverEndpoint: Observation<string>;
  hookTrust: Observation<"trusted" | "managed" | "untrusted" | "modified">;
  relay: Observation<"running" | "stopped">;
  queue: {
    state: "observed" | "not_observed";
    pending: number | null;
    poisoned: number | null;
  };
  deliveryAcknowledgement: {
    state: "acknowledged";
    acknowledgedAt: string;
  };
  missingPrerequisites: Array<{
    code: string;
    name: string;
    action: string;
  }>;
  problems: Array<{
    code: string;
    name: string;
    action: string;
  }>;
  links: { self: string; sourceEvent: string };
  nextAction: {
    kind:
      | "rerun_setup_verification"
      | "repair_hook_trust"
      | "restart_relay"
      | "drain_delivery_queue";
    label: string;
  };
};

type DeviceDiagnosticsResponse = {
  deviceId: string;
  installationHealth: InstallationHealth[];
};

type DiagnosticState =
  | { kind: "loading" }
  | { kind: "loaded"; value: DeviceDiagnosticsResponse }
  | { kind: "error"; message: string };

async function diagnosticsFor(deviceId: string): Promise<DeviceDiagnosticsResponse> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/devices/${encodeURIComponent(deviceId)}/diagnostics`,
    );
  } catch {
    throw new Error(
      "Device diagnostics could not reach the server. Check the connection and retry.",
    );
  }
  const body = (await response.json().catch(() => undefined)) as
    | DeviceDiagnosticsResponse
    | { error?: { message?: string } }
    | undefined;
  if (!response.ok) {
    throw new Error(
      body && "error" in body && body.error?.message
        ? body.error.message
        : `Device diagnostics failed (${response.status}). Check the server and retry.`,
    );
  }
  return body as DeviceDiagnosticsResponse;
}

function fact(value: string | number | null, state: "observed" | "not_observed") {
  if (state === "not_observed" || value === null) return "Not observed";
  return String(value).replaceAll("_", " ");
}

function InstallationHealthCard({
  health,
  onRetry,
}: {
  health: InstallationHealth;
  onRetry: () => void;
}) {
  return (
    <article className="installation-health" aria-labelledby={`verification-${health.sourceEventId}`}>
      <header>
        <div>
          <p className="eyebrow">Installation health</p>
          <h4 id={`verification-${health.sourceEventId}`}>
            Verification {health.verificationId}
          </h4>
        </div>
        <strong className="diagnostic-proof">Delivery acknowledged</strong>
      </header>

      <dl className="diagnostic-facts">
        <div>
          <dt>Verified</dt>
          <dd>{new Date(health.verificationTime).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Server endpoint</dt>
          <dd>{fact(health.serverEndpoint.value, health.serverEndpoint.state)}</dd>
        </div>
        <div>
          <dt>Hook trust</dt>
          <dd>{fact(health.hookTrust.value, health.hookTrust.state)}</dd>
        </div>
        <div>
          <dt>Relay</dt>
          <dd>{fact(health.relay.value, health.relay.state)}</dd>
        </div>
        <div>
          <dt>Delivery queue</dt>
          <dd>
            {health.queue.state === "observed"
              ? `${health.queue.pending ?? 0} pending · ${health.queue.poisoned ?? 0} poisoned`
              : "Not observed"}
          </dd>
        </div>
        <div>
          <dt>Acknowledged</dt>
          <dd>
            {new Date(
              health.deliveryAcknowledgement.acknowledgedAt,
            ).toLocaleString()}
          </dd>
        </div>
      </dl>

      {health.missingPrerequisites.length > 0 && (
        <section className="diagnostic-repair" aria-labelledby={`missing-${health.sourceEventId}`}>
          <h5 id={`missing-${health.sourceEventId}`}>Missing prerequisites</h5>
          <ul>
            {health.missingPrerequisites.map((prerequisite) => (
              <li key={prerequisite.code}>
                <strong>{prerequisite.name}</strong>
                <span>{prerequisite.action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {health.problems.length > 0 && (
        <section className="diagnostic-repair" aria-labelledby={`problems-${health.sourceEventId}`}>
          <h5 id={`problems-${health.sourceEventId}`}>Repair required</h5>
          <ul>
            {health.problems.map((problem) => (
              <li key={problem.code}>
                <strong>{problem.name}</strong>
                <span>{problem.action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer>
        <button className="secondary-button" type="button" onClick={onRetry}>
          {health.nextAction.label}
        </button>
        <a href={health.links.sourceEvent}>
          Inspect preserved verification evidence
        </a>
      </footer>
    </article>
  );
}

function DeviceDiagnostic({ device }: { device: EnrolledDevice }) {
  const [state, setState] = useState<DiagnosticState>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "loaded", value: await diagnosticsFor(device.id) });
    } catch (cause) {
      setState({
        kind: "error",
        message:
          cause instanceof Error
            ? cause.message
            : "Device diagnostics failed. Check the server and retry.",
      });
    }
  }, [device.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="device-diagnostic" aria-labelledby={`diagnostic-device-${device.id}`}>
      <div className="device-diagnostic-heading">
        <div>
          <span className="detail-label">Enrolled device</span>
          <h3 id={`diagnostic-device-${device.id}`}>{device.name}</h3>
        </div>
        <span className={`health health-${device.health}`}>
          {device.health === "healthy" ? "Connected" : "Revoked"}
        </span>
      </div>

      {state.kind === "loading" && <p role="status">Loading installation health…</p>}
      {state.kind === "error" && (
        <div role="alert" className="error operation-error">
          <span>{state.message}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Retry {device.name} diagnostics
          </button>
        </div>
      )}
      {state.kind === "loaded" && state.value.installationHealth.length === 0 && (
        <div className="diagnostic-empty">
          <strong>No setup verification received yet.</strong>
          <span>Run setup verification, then retry diagnostics.</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Retry {device.name} diagnostics
          </button>
        </div>
      )}
      {state.kind === "loaded" &&
        state.value.installationHealth.map((health) => (
          <InstallationHealthCard
            health={health}
            key={health.sourceEventId}
            onRetry={() => void load()}
          />
        ))}
    </section>
  );
}

export function DeviceDiagnostics({ devices }: { devices: EnrolledDevice[] }) {
  return (
    <section
      className="card settings-card device-diagnostics"
      aria-labelledby="device-diagnostics-title"
      aria-label="Device diagnostics"
    >
      <p className="eyebrow">Capture proof</p>
      <h2 id="device-diagnostics-title">Device diagnostics</h2>
      <p className="lede">
        Setup acknowledgements are operational evidence. They stay separate from
        coding activity, search, and comparisons.
      </p>
      {devices.map((device) => (
        <DeviceDiagnostic device={device} key={device.id} />
      ))}
      {devices.length === 0 && (
        <div className="diagnostic-empty">
          <strong>No Device is enrolled.</strong>
          <span>Enroll a Device before running setup verification.</span>
        </div>
      )}
    </section>
  );
}
