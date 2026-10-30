import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

import {
  adaptCodexObservation,
  createCodexSourceEvent,
  type CodexSource,
} from "@workspace/agent-adapter";
import { DeviceCapturePolicyResponseSchema } from "@workspace/contracts";

import {
  openDeliveryQueue,
  redactCaptureInput,
  type CaptureInput,
} from "./index.js";
import { readSetupState, writeSetupState } from "./setup.js";
import {
  listActiveSessionIds,
  recordLocalSessionActivity,
  runOrganizationStandardSyncDaemon,
} from "./standard-sync.js";

export async function recordCodexPayload(options: {
  stateDir: string;
  source: CodexSource;
  producerEvent: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}): Promise<string> {
  const state = await readSetupState(options.stateDir);
  const now = new Date().toISOString();
  recordLocalSessionActivity({
    databasePath: join(options.stateDir, "relay.sqlite"),
    producerEvent: options.producerEvent,
    payload: options.payload,
    observedAt: now,
  });
  const input: CaptureInput = {
    id: randomUUID(),
    source: "prompt",
    content: JSON.stringify(options.payload),
    sourcePath: "$",
    capturedAt: now,
  };
  const redacted = redactCaptureInput(
    input,
    state.policy,
    Buffer.from(state.fingerprintKey, "base64url"),
  );
  const adapted = adaptCodexObservation({
    source: options.source,
    // The real detected producer version; "unknown" downgrades honestly
    // instead of fabricating validated 0.144.5 fidelity.
    producer: { name: "codex", version: state.codexVersion ?? "unknown" },
    producerEvent: options.producerEvent,
    occurredAt: options.occurredAt ?? now,
    capturedAt: now,
    capturePath:
      options.source === "codex_hook"
        ? `hook:${options.producerEvent}`
        : `otlp:${options.producerEvent}`,
    payload: JSON.parse(redacted.content) as Record<string, unknown>,
  });
  const event = createCodexSourceEvent({
    id: input.id,
    adapted,
    redaction: {
      policyVersion: state.policy.version,
      applied: redacted.redactions.length > 0,
      evidence: redacted.redactions,
    },
  });
  const queue = openDeliveryQueue({ databasePath: join(options.stateDir, "relay.sqlite") });
  try {
    queue.record(event);
  } finally {
    queue.close();
  }
  return event.id;
}

/** Records a bounded setup check without leaving a synthetic Session active. */
export async function recordSetupVerification(options: {
  stateDir: string;
  sessionId?: string;
}): Promise<string[]> {
  const sessionId = options.sessionId ?? `setup-verification-${Date.now()}`;
  const startId = await recordCodexPayload({
    stateDir: options.stateDir,
    source: "codex_hook",
    producerEvent: "SessionStart",
    payload: {
      hook_event_name: "SessionStart",
      session_id: sessionId,
      source: "startup",
    },
  });
  const stopId = await recordCodexPayload({
    stateDir: options.stateDir,
    source: "codex_hook",
    producerEvent: "Stop",
    payload: {
      hook_event_name: "Stop",
      session_id: sessionId,
      source: "setup_verification_complete",
    },
  });
  // The verification Session is relay-synthetic and genuinely over, so clear
  // its local liveness directly; a real Codex root Stop never implies that.
  recordLocalSessionActivity({
    databasePath: join(options.stateDir, "relay.sqlite"),
    producerEvent: "SessionEnd",
    payload: { session_id: sessionId },
  });
  return [startId, stopId];
}
export async function deliverPendingOnce(options: {
  stateDir: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ sent: number; acknowledged: number; retrying: number; poisoned: number }> {
  const state = await readSetupState(options.stateDir);
  if (!state.credential) {
    throw new Error("DEVICE_DISCONNECTED: no active Device credential is configured.");
  }
  const queue = openDeliveryQueue({ databasePath: join(options.stateDir, "relay.sqlite") });
  try {
    return await queue.deliverOnce({
      baseUrl: state.serverUrl,
      deviceCredential: state.credential,
      fetch: options.fetch,
    });
  } finally {
    queue.close();
  }
}

export async function refreshCapturePolicy(options: {
  stateDir: string;
  fetch?: typeof globalThis.fetch;
}): Promise<void> {
  const state = await readSetupState(options.stateDir);
  if (!state.credential) return;
  const response = await (options.fetch ?? globalThis.fetch)(
    `${state.serverUrl}/api/v1/device/capture-policy`,
    { headers: { authorization: `Bearer ${state.credential}` } },
  );
  if (!response.ok) throw new Error(`CAPTURE_POLICY_HTTP_${response.status}`);
  state.policy = DeviceCapturePolicyResponseSchema.parse(await response.json());
  await writeSetupState(state);
}

async function requestBody(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OTLP payload must be an object.");
  }
  return parsed as Record<string, unknown>;
}

interface OtlpRecord {
  producerEvent: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

function otlpAttribute(record: unknown, wanted: string): string | undefined {
  const attributes = (record as { attributes?: unknown })?.attributes;
  if (!Array.isArray(attributes)) return undefined;
  for (const item of attributes) {
    const attribute = item as { key?: unknown; value?: Record<string, unknown> };
    if (attribute?.key !== wanted) continue;
    const scalar = attribute.value?.stringValue ?? attribute.value?.intValue;
    if (typeof scalar === "string" || typeof scalar === "number") return String(scalar);
  }
  return undefined;
}

/**
 * Codex 0.144.5 trace exports interleave meaningful spans with hundreds of
 * internal Rust tracing spans per session (append_items, receiving,
 * handle_responses, persist_rollout_items, ...). We keep `codex.*` spans, the
 * source-defined `turn` span, and any span carrying `turn.id`/`thread.id`
 * correlation attributes (see
 * .scratch/coding-agent-observability/research/codex-capture-contract.md).
 */
function isMeaningfulSpan(span: unknown, name: string): boolean {
  if (name.startsWith("codex.") || name === "turn") return true;
  return (
    otlpAttribute(span, "turn.id") !== undefined ||
    otlpAttribute(span, "thread.id") !== undefined
  );
}

/**
 * Splits a real OTLP export envelope into individual records so every source
 * event carries exactly one log record or span — the shape the adapter and
 * server projection consume. An unrecognizable body falls back to one
 * whole-envelope event rather than dropping evidence. Internal trace spans are
 * filtered, but never silently: each envelope's drops are disclosed in one
 * `otlp.traces.filtered` summary record listing span names and counts.
 */
export function splitOtlpEnvelope(
  kind: "logs" | "traces",
  body: Record<string, unknown>,
): OtlpRecord[] {
  const records: OtlpRecord[] = [];
  if (kind === "logs") {
    for (const resource of asArray(body.resourceLogs ?? body.resource_logs)) {
      const scopes = asArray(
        (resource as Record<string, unknown>).scopeLogs ??
          (resource as Record<string, unknown>).scope_logs,
      );
      for (const scope of scopes) {
        const logRecords = asArray(
          (scope as Record<string, unknown>).logRecords ??
            (scope as Record<string, unknown>).log_records,
        );
        for (const record of logRecords) {
          records.push({
            producerEvent: otlpAttribute(record, "event.name") ?? "otlp.logs",
            payload: { log_record: record as Record<string, unknown> },
            occurredAt: otlpAttribute(record, "event.timestamp"),
          });
        }
      }
    }
  } else {
    const droppedSpans = new Map<string, number>();
    for (const resource of asArray(body.resourceSpans ?? body.resource_spans)) {
      const scopes = asArray(
        (resource as Record<string, unknown>).scopeSpans ??
          (resource as Record<string, unknown>).scope_spans,
      );
      for (const scope of scopes) {
        for (const span of asArray((scope as Record<string, unknown>).spans)) {
          const rawName = (span as { name?: unknown }).name;
          const name = typeof rawName === "string" ? rawName : "";
          if (!isMeaningfulSpan(span, name)) {
            const key = name.length > 0 ? name : "(unnamed)";
            droppedSpans.set(key, (droppedSpans.get(key) ?? 0) + 1);
            continue;
          }
          records.push({
            producerEvent: name.length > 0 ? name : "otlp.traces",
            payload: { span: span as Record<string, unknown> },
          });
        }
      }
    }
    if (droppedSpans.size > 0) {
      records.push({
        producerEvent: "otlp.traces.filtered",
        payload: {
          filtered: {
            dropped_span_total: [...droppedSpans.values()].reduce((sum, count) => sum + count, 0),
            dropped_spans: Object.fromEntries(droppedSpans),
          },
        },
      });
    }
  }
  return records.length > 0
    ? records
    : [{ producerEvent: `otlp.${kind}`, payload: body }];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function createOtlpReceiver(options: { stateDir: string }): Server {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || (request.url !== "/v1/logs" && request.url !== "/v1/traces")) {
        response.writeHead(404).end();
        return;
      }
      const kind = request.url === "/v1/logs" ? "logs" : "traces";
      for (const record of splitOtlpEnvelope(kind, await requestBody(request))) {
        await recordCodexPayload({
          stateDir: options.stateDir,
          source: kind === "logs" ? "codex_otel_log" : "codex_otel_trace",
          producerEvent: record.producerEvent,
          payload: record.payload,
          occurredAt: record.occurredAt,
        });
      }
      response.writeHead(200, { "content-type": "application/json" }).end("{}\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : "capture failed";
      response.writeHead(400, { "content-type": "application/json" }).end(
        `${JSON.stringify({ error: message })}\n`,
      );
    }
  });
}

export async function runRelayDaemon(options: {
  stateDir: string;
  port?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const server = createOtlpReceiver({ stateDir: options.stateDir });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4318, "127.0.0.1", resolve);
  });
  const deliveryTimer = setInterval(() => {
    void deliverPendingOnce({ stateDir: options.stateDir }).catch(() => undefined);
  }, 1_000);
  const policyTimer = setInterval(() => {
    void refreshCapturePolicy({ stateDir: options.stateDir }).catch(() => undefined);
  }, 30_000);
  const state = await readSetupState(options.stateDir);
  const stopController = new AbortController();
  const standardSync = state.credential
    ? runOrganizationStandardSyncDaemon({
        installRoot: join(state.codexHome, "skills"),
        baseUrl: state.serverUrl,
        deviceCredential: state.credential,
        activeSessionIds: async () =>
          listActiveSessionIds({ databasePath: join(options.stateDir, "relay.sqlite") }),
        signal: stopController.signal,
      })
    : Promise.resolve();
  await new Promise<void>((resolve) => {
    const stop = () => {
      stopController.abort();
      resolve();
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    if (options.signal?.aborted) stop();
  });
  clearInterval(deliveryTimer);
  clearInterval(policyTimer);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await standardSync;
}
