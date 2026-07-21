import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  return String(serialized).split(";", 1)[0]!;
}

function event(sessionId: string, turnId: string, marker: string): SourceEvent {
  const id = randomUUID();
  const rawPayload = {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    turn_id: turnId,
    source: "startup",
    model: "gpt-isolation-fixture",
    marker,
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "SessionStart" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-18T10:00:00.000Z",
    capturedAt: "2026-07-18T10:00:00.100Z",
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

describe.sequential("Organization evidence isolation through public seams", () => {
  const database = createTestDatabase("organization_evidence_isolation");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let browserCookie: string;
  let firstMembershipId: string;
  let secondMembershipId: string;
  let firstDeviceCredential: string;
  let secondDeviceCredential: string;
  let firstAnalysisCredential: string;

  beforeAll(async () => {
    await database.create();
    await migrateDatabase(database.databaseUrl);
    let bootstrapCode: string | undefined;
    app = await buildApp({
      databaseUrl: database.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });

    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Isolation One" },
        administrator: { displayName: "One Admin" },
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    browserCookie = cookie(bootstrap);
    firstMembershipId = bootstrap.json().member.id;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: browserCookie },
      payload: { name: "Isolation Two" },
    });
    expect(created.statusCode).toBe(201);
    secondMembershipId = created.json().member.id;

    const memberships = await app.inject({
      method: "GET",
      url: "/api/v1/person/memberships",
      headers: { cookie: browserCookie },
    });
    const membershipRows = memberships.json().memberships as Array<{ member: { id: string } }>;
    expect(membershipRows.map((row) => row.member.id)).toEqual(
      expect.arrayContaining([firstMembershipId, secondMembershipId]),
    );

    const firstSelected = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: firstMembershipId },
    });
    expect(firstSelected.statusCode).toBe(200);
    const firstGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "First Device" },
    });
    const firstEnrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: firstGrant.json().grant },
    });
    firstDeviceCredential = firstEnrollment.json().credential;
    const firstAnalysis = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: browserCookie },
      payload: { name: "First Analysis" },
    });
    firstAnalysisCredential = firstAnalysis.json().credential;

    const secondSelected = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: secondMembershipId },
    });
    expect(secondSelected.statusCode).toBe(200);
    const secondGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Second Device" },
    });
    const secondEnrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: secondGrant.json().grant },
    });
    secondDeviceCredential = secondEnrollment.json().credential;

    const firstDelivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${firstDeviceCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [
          event("colliding-public-session", "colliding-turn", "tenant-alpha"),
          event("colliding-public-session", "colliding-turn-2", "tenant-alpha-2"),
        ],
      },
    });
    const secondDelivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${secondDeviceCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [event("colliding-public-session", "colliding-turn", "tenant-beta")],
      },
    });
    expect(firstDelivery.statusCode).toBe(200);
    expect(secondDelivery.statusCode).toBe(200);

    for (const membershipId of [firstMembershipId, secondMembershipId]) {
      const selected = await app.inject({
        method: "PUT",
        url: "/api/v1/session/active-membership",
        headers: { cookie: browserCookie },
        payload: { membershipId },
      });
      expect(selected.statusCode).toBe(200);
      const imported = await app.inject({
        method: "POST",
        url: "/api/v1/administration/example-packs/starter-v1/import",
        headers: { cookie: browserCookie },
      });
      expect(imported.statusCode).toBe(200);
      expect(imported.json()).toMatchObject({
        version: "starter-v1",
        imported: true,
        sessionIds: ["seeded-starter-compilation"],
        syntheticDesignation: "seeded",
      });
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database.drop();
  }, 30_000);

  it("keeps same-key Session reads/search/comparison/citation and annotations tenant-bound", async () => {
    const selectFirst = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: firstMembershipId },
    });
    expect(selectFirst.statusCode).toBe(200);
    const first = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/colliding-public-session",
      headers: { cookie: browserCookie },
    });
    const selectSecond = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: secondMembershipId },
    });
    expect(selectSecond.statusCode).toBe(200);
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/colliding-public-session",
      headers: { cookie: browserCookie },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().session.owner.memberId).not.toBe(second.json().session.owner.memberId);

    await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: firstMembershipId },
    });
    const firstSearch = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?q=tenant-alpha",
      headers: { cookie: browserCookie },
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: secondMembershipId },
    });
    const secondSearch = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?q=tenant-alpha",
      headers: { cookie: browserCookie },
    });
    expect(firstSearch.json().items.map((item: { id: string }) => item.id)).toContain(
      "colliding-public-session",
    );
    expect(secondSearch.json().items).toHaveLength(0);

    await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: firstMembershipId },
    });
    const annotation = await app.inject({
      method: "PATCH",
      url: "/api/v1/sessions/colliding-public-session/annotations",
      headers: { cookie: browserCookie },
      payload: { outcome: "successful", tags: ["first-only"] },
    });
    expect(annotation.statusCode).toBe(200);
    await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: secondMembershipId },
    });
    const secondAgain = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/colliding-public-session",
      headers: { cookie: browserCookie },
    });
    expect(secondAgain.json().session.annotations.outcome).toBe("unknown");
    expect(secondAgain.json().session.annotations.tags).toEqual([]);

    const crossCitation = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/colliding-public-session/turns/colliding-turn",
      headers: { cookie: browserCookie },
    });
    expect(crossCitation.statusCode).toBe(200);
    const comparison = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { cookie: browserCookie },
      payload: {
        selections: [{ scope: "turn", sessionId: "colliding-public-session", turnId: "colliding-turn" }],
        includeSeeded: false,
        claim: { kind: "pattern", statement: "same-key" },
      },
    });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json().subjects[0].ownerDisplayName).toBe("One Admin");
    // The second browser Session must be switched to the second Organization;
    // selecting the same public key resolves only that tenant's projection.
    const secondOwner = secondAgain.json().session.ownerProfile.displayName;
    expect(secondOwner).toBe("One Admin");
  });

  it("does not let an Analysis credential or deep link cross the active Organization", async () => {
    const selectFirst = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: firstMembershipId },
    });
    expect(selectFirst.statusCode).toBe(200);
    const analysisRead = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/colliding-public-session",
      headers: { authorization: `Bearer ${firstAnalysisCredential}` },
    });
    expect(analysisRead.statusCode).toBe(200);
    const forbiddenDeepLink = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/colliding-public-session",
      headers: { cookie: "browser_session=invalid" },
    });
    expect(forbiddenDeepLink.statusCode).toBe(401);
  });

  it("binds structural pagination cursors and SSE invalidations to the active Organization", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: firstMembershipId },
    });
    const firstLedger = await app.inject({
      method: "GET",
      url: "/api/v1/structural-capture-ledger?sessionId=colliding-public-session&limit=1",
      headers: { cookie: browserCookie },
    });
    expect(firstLedger.statusCode).toBe(200);
    expect(firstLedger.json().observations).toHaveLength(1);
    expect(firstLedger.json().nextCursor).toEqual(expect.any(String));

    await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: browserCookie },
      payload: { membershipId: secondMembershipId },
    });
    const foreignCursor = await app.inject({
      method: "GET",
      url: `/api/v1/structural-capture-ledger?sessionId=colliding-public-session&limit=1&cursor=${firstLedger.json().nextCursor}`,
      headers: { cookie: browserCookie },
    });
    expect(foreignCursor.statusCode).toBe(200);
    // The first Organization's cursor cannot skip this Organization's first
    // observation, even though the public Session key is identical.
    expect(foreignCursor.json().observations).toHaveLength(1);
    expect(foreignCursor.json().observations[0].sourceEventId).toBeTruthy();

    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/v1/live`, {
      headers: { cookie: browserCookie },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    await reader.read();
    await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${firstDeviceCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [event("first-only-live-session", "first-live-turn", "first-live")],
      },
    });
    const pendingEvent = reader.read().then((result) => ({ kind: "event" as const, result }));
    const leaked = await Promise.race([
      pendingEvent,
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 250)),
    ]);
    expect(leaked).toEqual({ kind: "timeout" });
    await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${secondDeviceCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [event("second-only-live-session", "second-live-turn", "second-live")],
      },
    });
    const own = await Promise.race([
      pendingEvent,
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 1000)),
    ]);
    expect(own.kind).toBe("event");
    expect(new TextDecoder().decode((own as { result: ReadableStreamReadResult<Uint8Array> }).result.value)).toContain(
      "second-only-live-session",
    );
    controller.abort();
  });
});
