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

const sessionId = "session-ledger-unprojected";
const sensitiveSentinel = "PRIVATE_CAPTURED_PROMPT_MUST_NOT_ESCAPE";

function preservedObservation(id: string): SourceEvent {
  const rawPayload = {
    log_record: {
      attributes: [
        {
          key: "conversation.id",
          value: { stringValue: sessionId },
        },
      ],
      body: sensitiveSentinel,
    },
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(rawPayload))
      .digest("hex")}`,
    source: "codex_otel_log",
    producer: {
      name: "codex",
      version: "0.144.5",
      event: "codex.response.started",
    },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-18T01:00:00.000Z",
    capturedAt: "2026-07-18T01:00:00.100Z",
    capturePath: "otel:log:codex.response.started",
    rawPayload,
    canonicalObservations: [],
    adapter: {
      status: "preserved",
      reason: "unmapped_event",
      capabilities: {},
    },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

function projectedObservation(id: string, projectedSessionId: string): SourceEvent {
  const rawPayload = {
    session_id: projectedSessionId,
    turn_id: "turn-ledger-projected",
    hook_event_name: "SessionStart",
    source: "startup",
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(rawPayload))
      .digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "SessionStart" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-18T01:05:00.000Z",
    capturedAt: "2026-07-18T01:05:00.100Z",
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [
      {
        kind: "turn_observed",
        sessionId: projectedSessionId,
        turnId: "turn-ledger-projected",
      },
    ],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

function preservedTraceObservation(id: string, traceSessionId: string): SourceEvent {
  const rawPayload = {
    span: {
      traceId: "0123456789abcdef0123456789abcdef",
      attributes: [
        { key: "thread.id", value: { stringValue: traceSessionId } },
        { key: "turn.id", value: { stringValue: "turn-ledger-trace" } },
      ],
      privateEvent: sensitiveSentinel,
    },
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(rawPayload))
      .digest("hex")}`,
    source: "codex_otel_trace",
    producer: { name: "codex", version: "0.144.5", event: "turn" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-18T01:02:00.000Z",
    capturedAt: "2026-07-18T01:02:00.100Z",
    capturePath: "otel:trace:turn",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "preserved", reason: "unmapped_event", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

describe.sequential("structural capture ledger through /api/v1", () => {
  const testDatabase = createTestDatabase("structural_capture_ledger");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let browserCookie: string;
  let deviceCredential: string;
  let analysisCredential: string;
  const queuePath = join(tmpdir(), `structural-ledger-${randomUUID()}.sqlite`);

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
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });

    const bootstrap = await fetch(`${baseUrl}/api/v1/bootstrap/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: bootstrapCode,
        organization: { name: "Capture Audit Example" },
        administrator: { displayName: "Audit Administrator" },
      }),
    });
    browserCookie = bootstrap.headers.getSetCookie()[0]!.split(";", 1)[0]!;

    const grant = await fetch(`${baseUrl}/api/v1/device-enrollment-grants`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: browserCookie },
      body: JSON.stringify({ deviceName: "Audit Device" }),
    });
    const enrollment = await fetch(`${baseUrl}/api/v1/device-enrollments/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: (await grant.json() as { grant: string }).grant,
      }),
    });
    deviceCredential = (await enrollment.json() as { credential: string })
      .credential;
    const analysis = await fetch(`${baseUrl}/api/v1/analysis-credentials`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: browserCookie },
      body: JSON.stringify({ name: "Capture audit" }),
    });
    analysisCredential = (await analysis.json() as { credential: string })
      .credential;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
    await rm(queuePath, { force: true });
  }, 30_000);

  it("shows an accepted but unprojected observation without captured content", async () => {
    const event = preservedObservation(randomUUID());
    const delivered = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
    });
    expect(delivered.status).toBe(200);

    const response = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${sessionId}`,
      { headers: { cookie: browserCookie } },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      scope: { kind: "session", sessionId },
      observations: [
        {
          observationId: expect.any(String),
          sourceEventId: event.id,
          sourceFamily: "codex_otel_log",
          producerVersion: "0.144.5",
          eventName: "codex.response.started",
          sourceIdentity: event.deduplicationKey,
          payloadHash: event.payloadHash,
          occurredAt: "2026-07-18T01:00:00.000Z",
          receivedAt: expect.any(String),
          acceptance: {
            disposition: "accepted",
            code: null,
          },
          adapter: {
            disposition: "preserved",
            reason: "unmapped_event",
          },
          fieldPresence: {
            sessionIdentity: true,
            turnIdentity: false,
            traceIdentity: false,
            gitContext: false,
            canonicalObservations: false,
          },
          projectionReferences: {
            sessions: [],
            turns: [],
            agentRuns: [],
            activityEpisodes: [],
            timeline: [],
          },
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(body)).not.toContain(sensitiveSentinel);
    expect(JSON.stringify(body)).not.toContain("rawPayload");
  });

  it("scopes an official nested OTel trace shape without exposing span content", async () => {
    const traceSessionId = "session-ledger-trace";
    const event = preservedTraceObservation(randomUUID(), traceSessionId);
    const delivered = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
    });
    expect(delivered.status).toBe(200);

    const response = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${traceSessionId}`,
      { headers: { cookie: browserCookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      observations: [
        {
          sourceEventId: event.id,
          sourceFamily: "codex_otel_trace",
          eventName: "turn",
          fieldPresence: {
            sessionIdentity: true,
            turnIdentity: true,
            traceIdentity: true,
            gitContext: false,
            canonicalObservations: false,
          },
          projectionReferences: {
            sessions: [],
            turns: [],
            agentRuns: [],
            activityEpisodes: [],
            timeline: [],
          },
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(body)).not.toContain(sensitiveSentinel);
    expect(JSON.stringify(body)).not.toContain("span");
  });

  it("reconciles a relay retry as a duplicate of one accepted Source event", async () => {
    const event = preservedObservation(randomUUID());
    const queue = openDeliveryQueue({ databasePath: queuePath });
    expect(queue.record(event)).toEqual({ eventId: event.id, status: "pending" });
    expect(await queue.deliverOnce({ baseUrl, deviceCredential })).toMatchObject({
      acknowledged: 1,
    });

    expect(queue.record(event)).toEqual({ eventId: event.id, status: "pending" });
    expect(await queue.deliverOnce({ baseUrl, deviceCredential })).toMatchObject({
      acknowledged: 1,
    });
    expect(queue.pending()).toEqual([]);

    const response = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${sessionId}`,
      { headers: { cookie: browserCookie } },
    );
    expect(response.status).toBe(200);
    const matching = (await response.json() as {
      observations: Array<{
        sourceEventId: string | null;
        sourceIdentity: string | null;
        acceptance: { disposition: string };
      }>;
    }).observations.filter(
      (observation) => observation.sourceIdentity === event.deduplicationKey,
    );
    expect(matching).toEqual([
      expect.objectContaining({
        sourceEventId: event.id,
        acceptance: { disposition: "accepted", code: null },
      }),
      expect.objectContaining({
        sourceEventId: event.id,
        acceptance: { disposition: "duplicate", code: null },
      }),
    ]);
    queue.close();
  });

  it("enumerates a Session without silently truncating ledger pages", async () => {
    const first = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${sessionId}&limit=1`,
      { headers: { cookie: browserCookie } },
    );
    expect(first.status).toBe(200);
    const firstPage = await first.json() as {
      observations: Array<{ observationId: string }>;
      nextCursor: string | null;
    };
    expect(firstPage.observations).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const second = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${sessionId}&limit=1&cursor=${firstPage.nextCursor}`,
      { headers: { cookie: browserCookie } },
    );
    expect(second.status).toBe(200);
    const secondPage = await second.json() as {
      observations: Array<{ observationId: string }>;
    };
    expect(secondPage.observations).toHaveLength(1);
    expect(secondPage.observations[0]!.observationId).not.toBe(
      firstPage.observations[0]!.observationId,
    );
  });

  it("retains a named rejection and limits the ledger to browser or Analysis readers", async () => {
    const event = preservedObservation(randomUUID());
    const rejected = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        batchId: randomUUID(),
        events: [{ ...event, payloadHash: `sha256:${"0".repeat(64)}` }],
      }),
    });
    expect(await rejected.json()).toMatchObject({
      results: [
        {
          eventId: event.id,
          status: "rejected",
          code: "SOURCE_EVENT_PAYLOAD_HASH_MISMATCH",
        },
      ],
    });

    const url = `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${sessionId}`;
    const anonymous = await fetch(url);
    expect(anonymous.status).toBe(401);
    const device = await fetch(url, {
      headers: { authorization: `Bearer ${deviceCredential}` },
    });
    expect(device.status).toBe(403);
    const analysis = await fetch(url, {
      headers: { authorization: `Bearer ${analysisCredential}` },
    });
    expect(analysis.status).toBe(200);
    expect((await analysis.json() as { observations: unknown[] }).observations)
      .toContainEqual(
        expect.objectContaining({
          sourceEventId: null,
          sourceIdentity: event.deduplicationKey,
          acceptance: {
            disposition: "rejected",
            code: "SOURCE_EVENT_PAYLOAD_HASH_MISMATCH",
          },
        }),
      );

    const maliciousMetadata = preservedObservation(randomUUID());
    maliciousMetadata.source = "codex_hook";
    maliciousMetadata.producer.version = sensitiveSentinel;
    maliciousMetadata.producer.event = sensitiveSentinel;
    maliciousMetadata.adapter.reason = sensitiveSentinel;
    maliciousMetadata.payloadHash = `sha256:${"0".repeat(64)}`;
    const maliciousRejection = await fetch(
      `${baseUrl}/api/v1/device/source-event-batches`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${deviceCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          batchId: randomUUID(),
          events: [maliciousMetadata],
        }),
      },
    );
    expect(maliciousRejection.status).toBe(200);
    const contentFree = await fetch(url, {
      headers: { authorization: `Bearer ${analysisCredential}` },
    });
    const contentFreeBody = await contentFree.json() as {
      observations: Array<{
        sourceIdentity: string | null;
        producerVersion: string | null;
        eventName: string | null;
        adapter: { reason: string | null };
      }>;
    };
    expect(contentFreeBody.observations).toContainEqual(
      expect.objectContaining({
        sourceIdentity: maliciousMetadata.deduplicationKey,
        producerVersion: null,
        eventName: null,
        adapter: expect.objectContaining({ reason: null }),
      }),
    );
    expect(JSON.stringify(contentFreeBody)).not.toContain(sensitiveSentinel);

    const receiptWindow = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?receivedFrom=2026-01-01T00%3A00%3A00.000Z&receivedTo=2027-01-01T00%3A00%3A00.000Z`,
      { headers: { authorization: `Bearer ${analysisCredential}` } },
    );
    expect(receiptWindow.status).toBe(200);
    expect(await receiptWindow.json()).toMatchObject({
      scope: {
        kind: "receipt_window",
        receivedFrom: "2026-01-01T00:00:00.000Z",
        receivedTo: "2027-01-01T00:00:00.000Z",
      },
      observations: expect.arrayContaining([
        expect.objectContaining({ sourceIdentity: event.deduplicationKey }),
      ]),
    });
  });

  it("links an accepted observation to its canonical projection references", async () => {
    const projectedSessionId = "session-ledger-projected";
    const event = projectedObservation(randomUUID(), projectedSessionId);
    const delivered = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
    });
    expect(delivered.status).toBe(200);

    const response = await fetch(
      `${baseUrl}/api/v1/structural-capture-ledger?sessionId=${projectedSessionId}`,
      { headers: { cookie: browserCookie } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      observations: [
        {
          sourceEventId: event.id,
          adapter: { disposition: "adapted", reason: null },
          projectionReferences: {
            sessions: [projectedSessionId],
            turns: ["turn-ledger-projected"],
            agentRuns: [`root:${projectedSessionId}`],
            activityEpisodes: [`activity:${event.id}`],
            timeline: [event.id],
          },
        },
      ],
    });
  });
});
