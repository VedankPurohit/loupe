import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";
import type { SourceEvent } from "@workspace/contracts";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function sourceEvent(
  sessionId: string,
  hookEventName: "SessionStart" | "Stop",
  clientClaimedOwnerMemberId: string,
): SourceEvent {
  const id = randomUUID();
  const rawPayload = {
    hook_event_name: hookEventName,
    session_id: sessionId,
    turn_id: "turn-member-ownership-1",
    owner_member_id: clientClaimedOwnerMemberId,
    source: hookEventName === "SessionStart" ? "startup" : undefined,
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(rawPayload))
      .digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: hookEventName },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt:
      hookEventName === "SessionStart"
        ? "2026-07-17T12:00:00.000Z"
        : "2026-07-17T12:01:00.000Z",
    capturedAt:
      hookEventName === "SessionStart"
        ? "2026-07-17T12:00:00.010Z"
        : "2026-07-17T12:01:00.010Z",
    capturePath: `hook:${hookEventName}`,
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
    gitContext:
      hookEventName === "SessionStart"
        ? {
            status: "available",
            repositoryRoot: "/workspace/project",
            remoteIdentity: "https://example.com/acme/project.git",
            branch: "main",
            detached: false,
            worktree: "/workspace/project",
            commit: "0123456789abcdef0123456789abcdef01234567",
            sampledAt: "2026-07-17T11:59:59.000Z",
            provenance: {
              source: "relay_local_git",
              evidence: "local_observation",
              stability: "observed",
              derivation: "exact",
              cwd: "/workspace/project/packages/server",
            },
            reason: null,
          }
        : undefined,
  };
}

describe.sequential("Member invitations and historical Session ownership", () => {
  const testDatabase = createTestDatabase("member_ownership");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let administratorCookie: string;
  let administratorId: string;

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
        organization: { name: "Ownership Lab" },
        administrator: { displayName: "Admin One" },
      },
    });
    administratorId = bootstrap.json().member.id as string;
    const setCookie = bootstrap.headers["set-cookie"];
    administratorCookie = (
      Array.isArray(setCookie) ? setCookie[0] : setCookie
    )!.split(";", 1)[0]!;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("invites a Member whose first Device owns the Session despite later delivery through another member's Device", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administratorCookie },
      payload: { expiresInHours: 24 },
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.json()).toMatchObject({
      code: expect.stringMatching(/^invite_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/),
      expiresAt: expect.any(String),
    });

    const redeemed = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      payload: {
        code: issued.json().code,
        member: { displayName: "Member Two" },
      },
    });
    expect(redeemed.statusCode).toBe(201);
    expect(redeemed.json()).toMatchObject({
      member: { displayName: "Member Two", role: "member" },
    });
    const memberId = redeemed.json().member.id as string;
    const memberSetCookie = redeemed.headers["set-cookie"];
    const memberCookie = (
      Array.isArray(memberSetCookie) ? memberSetCookie[0] : memberSetCookie
    )!.split(";", 1)[0]!;

    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      payload: {
        code: issued.json().code,
        member: { displayName: "Imposter" },
      },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({
      error: { code: "INVITE_CODE_INVALID" },
    });

    const memberCannotInvite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: memberCookie },
      payload: {},
    });
    expect(memberCannotInvite.statusCode).toBe(403);
    expect(memberCannotInvite.json()).toMatchObject({
      error: { code: "ADMINISTRATOR_REQUIRED" },
    });

    const memberGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: memberCookie },
      payload: { deviceName: "Member Mac" },
    });
    const memberEnrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: memberGrant.json().grant },
    });
    const memberDevice = memberEnrollment.json().device as { id: string };
    const memberCredential = memberEnrollment.json().credential as string;
    const sessionId = "session-member-owned";

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${memberCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [sourceEvent(sessionId, "SessionStart", administratorId)],
      },
    });
    expect(accepted.statusCode).toBe(200);

    const firstView = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(firstView.json().session.owner).toEqual({
      memberId,
      deviceId: memberDevice.id,
    });

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/devices/${memberDevice.id}/revoke`,
          headers: { cookie: memberCookie },
        })
      ).statusCode,
    ).toBe(204);

    const administratorGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: administratorCookie },
      payload: { deviceName: "Re-enrolled Mac" },
    });
    const administratorEnrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: administratorGrant.json().grant },
    });
    const administratorDevice = administratorEnrollment.json().device as {
      id: string;
    };
    const administratorCredential = administratorEnrollment.json()
      .credential as string;

    const laterDelivery = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${administratorCredential}` },
      payload: {
        batchId: randomUUID(),
        events: [sourceEvent(sessionId, "Stop", administratorId)],
      },
    });
    expect(laterDelivery.statusCode).toBe(200);

    const historicalView = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}`,
      headers: { cookie: memberCookie },
    });
    expect(historicalView.json().session).toMatchObject({
      owner: { memberId, deviceId: memberDevice.id },
      gitContext: {
        status: "available",
        repositoryRoot: "/workspace/project",
        remoteIdentity: "https://example.com/acme/project.git",
        branch: "main",
        detached: false,
        worktree: "/workspace/project",
        commit: "0123456789abcdef0123456789abcdef01234567",
        provenance: {
          source: "relay_local_git",
          evidence: "local_observation",
          stability: "observed",
          derivation: "exact",
        },
      },
      ownershipReconciliation: {
        rule: "first_accepted_device_owns_session",
        selectedValue: memberDevice.id,
        inputs: expect.arrayContaining([
          expect.objectContaining({ observedValue: memberDevice.id }),
          expect.objectContaining({ observedValue: administratorDevice.id }),
        ]),
      },
    });
  });
});
