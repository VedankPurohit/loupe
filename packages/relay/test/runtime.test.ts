import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { openDeliveryQueue } from "../src/index.js";
import {
  recordCodexPayload,
  recordSetupVerification,
  splitOtlpEnvelope,
} from "../src/runtime.js";
import { listActiveSessionIds } from "../src/standard-sync.js";

describe("relay capture runtime", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("redacts a real hook payload before recording its source event in SQLite", async () => {
    const stateDir = join(tmpdir(), `relay-runtime-${randomUUID()}`);
    roots.push(stateDir);
    await mkdir(stateDir, { recursive: true });
    const secret = `sk-${"S".repeat(40)}`;
    await writeFile(join(stateDir, "setup-state.json"), JSON.stringify({
      version: 1,
      codexVersion: "0.144.5",
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      credential: "device_test",
      fingerprintKey: Buffer.alloc(32, 7).toString("base64url"),
      policy: { version: 1, ordinaryRedactionEnabled: true, demoCanaryEnabled: false },
    }));

    const id = await recordCodexPayload({
      stateDir,
      source: "codex_hook",
      producerEvent: "UserPromptSubmit",
      payload: { session_id: "session-1", turn_id: "turn-1", prompt: `use ${secret}` },
    });
    const queue = openDeliveryQueue({ databasePath: join(stateDir, "relay.sqlite") });
    const item = queue.pending().find(({ event }) => event.id === id);
    expect(item?.event.rawPayload).toEqual({
      session_id: "session-1",
      turn_id: "turn-1",
      prompt: "use [REDACTED:openai_api_key]",
    });
    expect(item?.event.redaction.applied).toBe(true);
    expect(item?.event.producer).toMatchObject({ name: "codex", version: "0.144.5" });
    expect(item?.event.adapter.status).not.toBe("downgraded");
    queue.close();
  });

  it("stamps the real detected Codex version and downgrades unknown producers honestly", async () => {
    const stateDir = join(tmpdir(), `relay-runtime-${randomUUID()}`);
    roots.push(stateDir);
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "setup-state.json"), JSON.stringify({
      version: 1,
      codexVersion: "0.139.0",
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      credential: "device_test",
      fingerprintKey: Buffer.alloc(32, 7).toString("base64url"),
      policy: { version: 1, ordinaryRedactionEnabled: true, demoCanaryEnabled: false },
    }));

    const id = await recordCodexPayload({
      stateDir,
      source: "codex_hook",
      producerEvent: "UserPromptSubmit",
      payload: { session_id: "session-v", turn_id: "turn-v", prompt: "hello" },
    });
    const queue = openDeliveryQueue({ databasePath: join(stateDir, "relay.sqlite") });
    const item = queue.pending().find(({ event }) => event.id === id);
    expect(item?.event.producer).toMatchObject({ name: "codex", version: "0.139.0" });
    expect(item?.event.adapter.status).toBe("downgraded");
    expect(item?.event.rawPayload).toMatchObject({ session_id: "session-v" });
    queue.close();
  });

  it("splits an OTLP export into one source record per log record or span", () => {
    const logs = splitOtlpEnvelope("logs", {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    { key: "event.name", value: { stringValue: "codex.sse_event" } },
                    { key: "event.timestamp", value: { stringValue: "2026-07-17T12:00:00Z" } },
                    { key: "input_token_count", value: { stringValue: "14542" } },
                  ],
                },
                {
                  attributes: [
                    { key: "event.name", value: { stringValue: "codex.api_request" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      producerEvent: "codex.sse_event",
      occurredAt: "2026-07-17T12:00:00Z",
    });
    expect(logs[0]?.payload).toHaveProperty("log_record");
    expect(logs[1]?.producerEvent).toBe("codex.api_request");

    const traces = splitOtlpEnvelope("traces", {
      resourceSpans: [
        { scopeSpans: [{ spans: [{ name: "codex.request" }, { name: "turn" }] }] },
      ],
    });
    expect(traces.map((record) => record.producerEvent)).toEqual(["codex.request", "turn"]);
    expect(traces[0]?.payload).toHaveProperty("span");

    // Unrecognizable bodies fall back to one whole-envelope event.
    expect(splitOtlpEnvelope("logs", { unexpected: true })).toEqual([
      { producerEvent: "otlp.logs", payload: { unexpected: true } },
    ]);
  });

  it("closes setup verification lifecycle so mandatory standards are not deferred", async () => {
    const stateDir = join(tmpdir(), `relay-runtime-${randomUUID()}`);
    roots.push(stateDir);
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "setup-state.json"), JSON.stringify({
      version: 1,
      codexVersion: "0.144.5",
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      credential: "device_test",
      fingerprintKey: Buffer.alloc(32, 7).toString("base64url"),
      policy: { version: 1, ordinaryRedactionEnabled: true, demoCanaryEnabled: false },
    }));

    const eventIds = await recordSetupVerification({
      stateDir,
      sessionId: "setup-verification-test",
    });

    expect(eventIds).toHaveLength(2);
    expect(listActiveSessionIds({ databasePath: join(stateDir, "relay.sqlite") })).toEqual([]);
  });
});
