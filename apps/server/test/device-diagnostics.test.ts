import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adaptCodexObservation,
  createCodexSourceEvent,
  type CodexSourceObservation,
} from "@workspace/agent-adapter";
import type { SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

const setupSessionId = "setup-verification-20260718";
const realSessionId = "session-real-diagnostics-001";

function hookEvent(
  producerEvent: string,
  occurredAt: string,
  payload: Record<string, unknown>,
): SourceEvent {
  const observation: CodexSourceObservation = {
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5" },
    producerEvent,
    occurredAt,
    capturedAt: occurredAt,
    capturePath: `hook:${producerEvent}`,
    payload,
  };
  return createCodexSourceEvent({
    id: randomUUID(),
    adapted: adaptCodexObservation(observation),
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  });
}

describe.sequential("setup acknowledgement diagnostics through /api/v1", () => {
  const testDatabase = createTestDatabase("device_diagnostics");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let browserCookie: string;
  let analysisCredential: string;
  let deviceCredential: string;
  let deviceId: string;
  let setupAcknowledgementEventId: string;

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
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Diagnostics Lab" },
        administrator: { displayName: "Operator" },
      },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(201);
    browserCookie = bootstrap.cookies[0]!.name + "=" + bootstrap.cookies[0]!.value;
    const analysis = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: browserCookie },
      payload: { name: "Diagnostics acceptance" },
    });
    expect(analysis.statusCode, analysis.body).toBe(201);
    analysisCredential = analysis.json().credential;
    const grant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Operator Mac" },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: grant.json().grant },
    });
    deviceCredential = enrollment.json().credential;
    deviceId = enrollment.json().device.id;

    const setupStart = hookEvent("SessionStart", "2026-07-18T08:00:00.000Z", {
      hook_event_name: "SessionStart",
      session_id: setupSessionId,
      source: "startup",
    });
    const setupAcknowledgement = hookEvent("Stop", "2026-07-18T08:00:01.000Z", {
      hook_event_name: "Stop",
      session_id: setupSessionId,
      source: "setup_verification_complete",
    });
    setupAcknowledgementEventId = setupAcknowledgement.id;
    const events = [
      setupStart,
      setupAcknowledgement,
      hookEvent("SessionStart", "2026-07-18T09:00:00.000Z", {
        hook_event_name: "SessionStart",
        session_id: realSessionId,
        source: "startup",
      }),
      hookEvent("UserPromptSubmit", "2026-07-18T09:00:01.000Z", {
        hook_event_name: "UserPromptSubmit",
        session_id: realSessionId,
        turn_id: "turn-real-001",
      }),
      hookEvent("Stop", "2026-07-18T09:00:02.000Z", {
        hook_event_name: "Stop",
        session_id: realSessionId,
        turn_id: "turn-real-001",
      }),
    ];
    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${deviceCredential}` },
      payload: { batchId: randomUUID(), events },
    });
    expect(delivery.statusCode).toBe(200);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  }, 30_000);

  it("excludes setup acknowledgements from ordinary Organization activity", async () => {
    const activity = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity",
      headers: { cookie: browserCookie },
    });

    expect(activity.statusCode).toBe(200);
    expect(activity.json()).toMatchObject({
      items: [{ id: realSessionId, synthetic: { kind: "real" } }],
      page: { total: 1 },
      aggregates: { sessions: 1 },
    });
  });

  it("excludes setup acknowledgements from Session lists, search, and comparison", async () => {
    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: { authorization: `Bearer ${analysisCredential}` },
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions.map((session: { id: string }) => session.id)).toEqual([
      realSessionId,
    ]);

    const search = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?q=setup-verification-20260718",
      headers: { cookie: browserCookie },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({ items: [], page: { total: 0 } });

    const comparison = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { cookie: browserCookie },
      payload: {
        selections: [{ scope: "session", sessionId: setupSessionId }],
        claim: {
          kind: "pattern",
          statement: "Setup acknowledgement is coding evidence.",
          signals: [],
        },
      },
    });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json()).toMatchObject({
      subjects: [],
      completeness: {
        missing: [
          {
            selection: { scope: "session", sessionId: setupSessionId },
            reason: "SESSION_NOT_FOUND",
          },
        ],
      },
      claim: {
        status: "refused",
        refusal: { code: "INSUFFICIENT_REAL_TURN_EVIDENCE" },
      },
    });
  });

  it("exposes preserved setup evidence as explicit installation health", async () => {
    const diagnostics = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${deviceId}/diagnostics`,
      headers: { cookie: browserCookie },
    });

    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      deviceId,
      installationHealth: [
        {
          kind: "installation_health",
          verificationId: setupSessionId,
          sourceEventId: setupAcknowledgementEventId,
          verificationTime: "2026-07-18T08:00:01.000Z",
          serverEndpoint: { state: "not_observed", value: null },
          hookTrust: { state: "not_observed" },
          relay: { state: "not_observed" },
          queue: { state: "not_observed", pending: null, poisoned: null },
          deliveryAcknowledgement: {
            state: "acknowledged",
            acknowledgedAt: expect.any(String),
          },
          missingPrerequisites: [
            { code: "SERVER_ENDPOINT_NOT_OBSERVED", name: "Server endpoint" },
            { code: "HOOK_TRUST_NOT_OBSERVED", name: "Hook trust" },
            { code: "RELAY_STATE_NOT_OBSERVED", name: "Relay state" },
            { code: "QUEUE_STATE_NOT_OBSERVED", name: "Delivery queue state" },
          ],
          problems: [],
          links: {
            self: `/api/v1/devices/${deviceId}/diagnostics`,
            sourceEvent: `/api/v1/source-events/${setupAcknowledgementEventId}`,
          },
          nextAction: {
            kind: "rerun_setup_verification",
            label: "Rerun setup verification after repair",
          },
        },
      ],
    });

    const sourceEvidence = await app.inject({
      method: "GET",
      url: `/api/v1/source-events/${setupAcknowledgementEventId}`,
      headers: { cookie: browserCookie },
    });
    expect(sourceEvidence.statusCode).toBe(200);
    expect(sourceEvidence.json()).toMatchObject({
      id: setupAcknowledgementEventId,
      rawPayload: {
        session_id: setupSessionId,
        source: "setup_verification_complete",
      },
    });
  });

  it("keeps Device diagnostics private and returns safe recovery actions", async () => {
    const signedOut = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${deviceId}/diagnostics`,
    });
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.json()).toEqual({
      error: {
        code: "BROWSER_SESSION_REQUIRED",
        message: "Sign in again, then retry Device diagnostics.",
      },
    });

    const absent = await app.inject({
      method: "GET",
      url: "/api/v1/devices/44444444-4444-4444-8444-444444444444/diagnostics",
      headers: { cookie: browserCookie },
    });
    expect(absent.statusCode).toBe(404);
    expect(absent.json()).toEqual({
      error: {
        code: "DEVICE_DIAGNOSTICS_NOT_FOUND",
        message:
          "This Device was not found. Re-enroll it before retrying setup verification.",
      },
    });

    const deviceView = await app.inject({
      method: "GET",
      url: "/api/v1/device/diagnostics",
      headers: { authorization: `Bearer ${deviceCredential}` },
    });
    expect(deviceView.statusCode).toBe(200);
    expect(deviceView.json()).toMatchObject({
      deviceId,
      installationHealth: [
        {
          kind: "installation_health",
          verificationId: setupSessionId,
          links: { self: "/api/v1/device/diagnostics" },
        },
      ],
    });

    const openApi = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(openApi.statusCode).toBe(200);
    expect(openApi.json().paths).toMatchObject({
      "/api/v1/devices/{id}/diagnostics": {
        get: { security: [{ browserSession: [] }] },
      },
      "/api/v1/device/diagnostics": {
        get: { security: [{ deviceCredential: [] }] },
      },
    });
  });

  it("does not erase real coding evidence that collides with a setup verification ID", async () => {
    const collision = [
      hookEvent("SessionStart", "2026-07-18T10:00:00.000Z", {
        hook_event_name: "SessionStart",
        session_id: setupSessionId,
        source: "resume",
      }),
      hookEvent("UserPromptSubmit", "2026-07-18T10:00:01.000Z", {
        hook_event_name: "UserPromptSubmit",
        session_id: setupSessionId,
        turn_id: "turn-real-collision-001",
      }),
      hookEvent("Stop", "2026-07-18T10:00:02.000Z", {
        hook_event_name: "Stop",
        session_id: setupSessionId,
        turn_id: "turn-real-collision-001",
      }),
    ];
    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${deviceCredential}` },
      payload: { batchId: randomUUID(), events: collision },
    });
    expect(delivery.statusCode).toBe(200);

    const activity = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity",
      headers: { cookie: browserCookie },
    });
    expect(activity.statusCode).toBe(200);
    expect(
      activity.json().items.map((session: { id: string }) => session.id),
    ).toEqual([setupSessionId, realSessionId]);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${setupSessionId}`,
      headers: { cookie: browserCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      session: { id: setupSessionId, synthetic: { kind: "real" } },
      turns: [{ id: "turn-real-collision-001" }],
    });
  });

  it("names safe repair actions for observed unhealthy installation state", async () => {
    const unhealthyId = "setup-verification-unhealthy";
    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${deviceCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [
          hookEvent("SessionStart", "2026-07-18T11:00:00.000Z", {
            hook_event_name: "SessionStart",
            session_id: unhealthyId,
            source: "startup",
          }),
          hookEvent("Stop", "2026-07-18T11:00:01.000Z", {
            hook_event_name: "Stop",
            session_id: unhealthyId,
            source: "setup_verification_complete",
            canonical_kind: "installation_health",
            diagnostics: {
              server_endpoint: "http://127.0.0.1:3000",
              hook_trust: "untrusted",
              relay_state: "stopped",
              queue: { pending: 2, poisoned: 1 },
            },
          }),
        ],
      },
    });
    expect(delivery.statusCode).toBe(200);

    const diagnostics = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${deviceId}/diagnostics`,
      headers: { cookie: browserCookie },
    });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json().installationHealth[0]).toMatchObject({
      kind: "installation_health",
      verificationId: unhealthyId,
      serverEndpoint: {
        state: "observed",
        value: "http://127.0.0.1:3000",
      },
      hookTrust: { state: "observed", value: "untrusted" },
      relay: { state: "observed", value: "stopped" },
      queue: { state: "observed", pending: 2, poisoned: 1 },
      missingPrerequisites: [],
      problems: [
        { code: "HOOK_TRUST_UNSAFE" },
        { code: "RELAY_NOT_RUNNING" },
        { code: "QUEUE_NOT_DRAINED" },
      ],
      nextAction: {
        kind: "repair_hook_trust",
        label: "Repair hook trust, then retry",
      },
    });
  });

  it("does not diagnose a noncanonical coding event as installation health", async () => {
    const noncanonical = hookEvent("Stop", "2026-07-18T12:00:00.000Z", {
      hook_event_name: "Stop",
      session_id: "ordinary-session-with-setup-like-source",
      source: "setup_verification_complete",
    });
    const delivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${deviceCredential}` },
      payload: { batchId: randomUUID(), events: [noncanonical] },
    });
    expect(delivery.statusCode).toBe(200);

    const diagnostics = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${deviceId}/diagnostics`,
      headers: { cookie: browserCookie },
    });
    expect(diagnostics.statusCode).toBe(200);
    const verificationIds = diagnostics
      .json()
      .installationHealth.map(
        (verification: { verificationId: string }) => verification.verificationId,
      );
    expect(verificationIds).toContain(setupSessionId);
    expect(verificationIds).not.toContain("ordinary-session-with-setup-like-source");

    const codingSession = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/ordinary-session-with-setup-like-source",
      headers: { cookie: browserCookie },
    });
    expect(codingSession.statusCode).toBe(200);
  });
});
