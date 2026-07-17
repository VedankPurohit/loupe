import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SourceEvent } from "@workspace/contracts";

import { openDeliveryQueue } from "../src/index.js";

function event(): SourceEvent {
  const id = randomUUID();
  const rawPayload = { hook_event_name: "SessionStart", session_id: "session-1" };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "SessionStart" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-17T10:00:00.000Z",
    capturedAt: "2026-07-17T10:00:00.010Z",
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

describe("relay delivery queue", () => {
  const paths: string[] = [];

  afterEach(async () => {
    await Promise.all(paths.splice(0).map((path) => rm(path, { force: true })));
  });

  it("records before network and retries unacknowledged evidence after restart", async () => {
    const databasePath = join(tmpdir(), `delivery-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    const sourceEvent = event();
    let queue = openDeliveryQueue({ databasePath });

    queue.record(sourceEvent);
    expect(queue.pending()).toMatchObject([{ event: sourceEvent, attempts: 0 }]);
    const refused = await queue.deliverOnce({
      baseUrl: "http://127.0.0.1:1",
      deviceCredential: "device_test",
      now: new Date("2026-07-17T10:01:00.000Z"),
      fetch: async () => {
        throw new Error("NETWORK_REFUSED");
      },
    });
    expect(refused).toEqual({ sent: 1, acknowledged: 0, retrying: 1, poisoned: 0 });
    expect(queue.pending()).toMatchObject([
      { event: sourceEvent, attempts: 1, lastError: "NETWORK_REFUSED" },
    ]);
    queue.close();

    queue = openDeliveryQueue({ databasePath });
    const recovered = await queue.deliverOnce({
      baseUrl: "http://central.test",
      deviceCredential: "device_test",
      now: new Date("2026-07-17T10:02:00.000Z"),
      fetch: async (_input, init) => {
        const request = JSON.parse(init!.body as string) as { batchId: string };
        return new Response(
          JSON.stringify({
            batchId: request.batchId,
            results: [{ eventId: sourceEvent.id, status: "accepted" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(recovered).toEqual({ sent: 1, acknowledged: 1, retrying: 0, poisoned: 0 });
    expect(queue.pending()).toEqual([]);
    queue.close();
  });
});
