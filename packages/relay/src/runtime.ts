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
    producer: { name: "codex", version: "0.144.5" },
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

export function createOtlpReceiver(options: { stateDir: string }): Server {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || (request.url !== "/v1/logs" && request.url !== "/v1/traces")) {
        response.writeHead(404).end();
        return;
      }
      const kind = request.url === "/v1/logs" ? "logs" : "traces";
      await recordCodexPayload({
        stateDir: options.stateDir,
        source: kind === "logs" ? "codex_otel_log" : "codex_otel_trace",
        producerEvent: `otlp.${kind}`,
        payload: await requestBody(request),
      });
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
