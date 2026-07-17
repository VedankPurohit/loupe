import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";
import { openDeliveryQueue } from "@workspace/relay";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function sourceEvent(id: string): SourceEvent {
  const rawPayload = {
    session_id: "session-probe-001",
    turn_id: "turn-probe-001",
    hook_event_name: "UserPromptSubmit",
    future_additive_field: { nested: [true, 7, "<unknown-string-redacted>"] },
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "UserPromptSubmit" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-17T10:36:29.354Z",
    capturedAt: "2026-07-17T10:36:29.400Z",
    capturePath: "hook:UserPromptSubmit",
    rawPayload,
    canonicalObservations: [
      {
        kind: "turn_observed",
        sessionId: "session-probe-001",
        turnId: "turn-probe-001",
        evidence: { stability: ["documented", "observed"], derivation: "exact" },
      },
    ],
    adapter: {
      status: "adapted",
      capabilities: {
        sessions: { availability: "exact_when_emitted", stability: "documented" },
        turns: { availability: "exact_when_emitted", stability: "documented" },
      },
    },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

describe.sequential("durable source-event delivery through /api/v1", () => {
  const testDatabase = createTestDatabase("source_event_delivery");
  const sqlitePath = join(tmpdir(), `delivery-${randomUUID()}.sqlite`);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let browserCookie: string;
  let deviceCredential: string;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    let bootstrapCode: string | undefined;
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    baseUrl = address;
    const bootstrap = await fetch(`${baseUrl}/api/v1/bootstrap/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: bootstrapCode,
        organization: { name: "Reliable Systems" },
        administrator: { displayName: "Barbara Liskov" },
      }),
    });
    browserCookie = bootstrap.headers.getSetCookie()[0]!.split(";", 1)[0]!;
    const grant = await fetch(`${baseUrl}/api/v1/device-enrollment-grants`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: browserCookie },
      body: JSON.stringify({ deviceName: "Barbara's Mac" }),
    });
    const enrollment = await fetch(`${baseUrl}/api/v1/device-enrollments/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: (await grant.json() as { grant: string }).grant }),
    });
    deviceCredential = (await enrollment.json() as { credential: string }).credential;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
    await rm(sqlitePath, { force: true });
  });

  it("survives queue restart and treats a replayed acknowledged batch as one immutable event", async () => {
    const event = sourceEvent(randomUUID());
    let queue = openDeliveryQueue({ databasePath: sqlitePath });
    expect(queue.record(event)).toEqual({ eventId: event.id, status: "pending" });
    queue.close();

    queue = openDeliveryQueue({ databasePath: sqlitePath });
    expect(queue.pending()).toHaveLength(1);
    const delivery = await queue.deliverOnce({ baseUrl, deviceCredential });
    expect(delivery).toMatchObject({ sent: 1, acknowledged: 1, retrying: 0, poisoned: 0 });
    expect(queue.pending()).toEqual([]);

    const replay = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      results: [{ eventId: event.id, status: "duplicate" }],
    });

    const conflictingPayload = { ...event.rawPayload, turn_id: "turn-conflict" };
    const conflict = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        batchId: randomUUID(),
        events: [
          {
            ...event,
            rawPayload: conflictingPayload,
            payloadHash: `sha256:${createHash("sha256")
              .update(JSON.stringify(conflictingPayload))
              .digest("hex")}`,
          },
        ],
      }),
    });
    expect(await conflict.json()).toMatchObject({
      results: [
        {
          eventId: event.id,
          status: "rejected",
          retryable: false,
          code: "SOURCE_EVENT_DEDUPLICATION_CONFLICT",
        },
      ],
    });

    const olderEvent = {
      ...sourceEvent(randomUUID()),
      occurredAt: "2026-07-17T09:00:00.000Z",
    };
    const outOfOrder = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [olderEvent] }),
    });
    expect(await outOfOrder.json()).toMatchObject({
      results: [{ eventId: olderEvent.id, status: "accepted" }],
    });

    const inspected = await fetch(`${baseUrl}/api/v1/source-events/${event.id}`, {
      headers: { cookie: browserCookie },
    });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({
      ...event,
      receivedAt: expect.any(String),
      delivery: { deviceId: expect.any(String), batchId: expect.any(String) },
    });
    queue.close();
  });

  it("isolates a permanent poison event while acknowledging valid evidence in the same batch", async () => {
    const queue = openDeliveryQueue({ databasePath: sqlitePath });
    const poison = {
      ...sourceEvent(randomUUID()),
      schemaVersion: "999",
    } as unknown as SourceEvent;
    const valid = sourceEvent(randomUUID());
    queue.record(poison);
    queue.record(valid);

    const result = await queue.deliverOnce({ baseUrl, deviceCredential });
    expect(result).toEqual({ sent: 2, acknowledged: 1, retrying: 0, poisoned: 1 });
    expect(queue.pending()).toMatchObject([
      {
        event: { id: poison.id },
        state: "poisoned",
        attempts: 1,
        lastError: "SOURCE_EVENT_UNSUPPORTED_SCHEMA_VERSION",
      },
    ]);

    const next = await queue.deliverOnce({ baseUrl, deviceCredential });
    expect(next.sent).toBe(0);
    queue.close();
  });
});
