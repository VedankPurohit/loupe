import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adaptCodexObservation,
  createCodexSourceEvent,
} from "@workspace/agent-adapter";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("Organization projection concurrency", () => {
  const testDatabase = createTestDatabase("projection_concurrency");
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
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const bootstrap = await fetch(`${baseUrl}/api/v1/bootstrap/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: bootstrapCode,
        organization: { name: "Concurrent Projection Lab" },
        administrator: { displayName: "Leslie Lamport" },
      }),
    });
    browserCookie = bootstrap.headers.getSetCookie()[0]!.split(";", 1)[0]!;
    const grantResponse = await fetch(`${baseUrl}/api/v1/device-enrollment-grants`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: browserCookie },
      body: JSON.stringify({ deviceName: "Concurrent Device" }),
    });
    const grant = (await grantResponse.json()) as { grant: string };
    const enrollment = await fetch(`${baseUrl}/api/v1/device-enrollments/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: grant.grant }),
    });
    deviceCredential = ((await enrollment.json()) as { credential: string }).credential;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("preserves every event when public ingestion requests cross a release barrier", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const turnIds = Array.from({ length: 12 }, (_, index) => `concurrent-turn-${index}`);
    const requests = turnIds.map(async (turnId, index) => {
      const occurredAt = new Date(
        Date.parse("2026-07-17T13:00:00.000Z") + index * 1_000,
      ).toISOString();
      const raw = {
        source: "codex_hook" as const,
        producer: { name: "codex" as const, version: "0.144.5" },
        producerEvent: "UserPromptSubmit",
        occurredAt,
        capturedAt: occurredAt,
        capturePath: "hook:UserPromptSubmit",
        payload: {
          hook_event_name: "UserPromptSubmit",
          session_id: "concurrent-session",
          turn_id: turnId,
        },
      };
      const event = createCodexSourceEvent({
        id: randomUUID(),
        adapted: adaptCodexObservation(raw),
        redaction: { policyVersion: 1, applied: false, evidence: [] },
      });
      await barrier;
      return fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${deviceCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
      });
    });
    release();
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: turnIds.length }, () => 200),
    );

    const inspected = await fetch(
      `${baseUrl}/api/v1/sessions/concurrent-session`,
      { headers: { cookie: browserCookie } },
    );
    expect(inspected.status).toBe(200);
    const detail = (await inspected.json()) as { turns: Array<{ id: string }> };
    expect(detail.turns.map((turn) => turn.id).sort()).toEqual([...turnIds].sort());
  });
});
