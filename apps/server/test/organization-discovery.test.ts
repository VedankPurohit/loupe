import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";
import type { SourceEvent } from "@workspace/contracts";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function sessionStart(sessionId: string): SourceEvent {
  const id = randomUUID();
  const rawPayload = {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    turn_id: "turn-search-1",
    source: "startup",
    model: "gpt-search-fixture",
    tool_name: "shell",
    error: "fixture compilation error",
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
    occurredAt: "2026-07-17T12:00:00.000Z",
    capturedAt: "2026-07-17T12:00:00.010Z",
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
    gitContext: {
      status: "available",
      repositoryRoot: "/workspace/searchable-repository",
      remoteIdentity: "https://example.com/acme/searchable-repository.git",
      branch: "main",
      detached: false,
      worktree: "/workspace/searchable-repository",
      commit: "0123456789abcdef0123456789abcdef01234567",
      sampledAt: "2026-07-17T11:59:59.000Z",
      provenance: {
        source: "relay_local_git",
        evidence: "local_observation",
        stability: "observed",
        derivation: "exact",
        cwd: "/workspace/searchable-repository",
      },
      reason: null,
    },
  };
}

function cookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}) {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  return String(serialized).split(";", 1)[0]!;
}

describe.sequential("Organization discovery through /api/v1", () => {
  const testDatabase = createTestDatabase("organization_discovery");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let administratorCookie: string;
  let memberCookie: string;
  let memberId: string;

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
        organization: { name: "Discovery Lab" },
        administrator: { displayName: "Administrator" },
      },
    });
    administratorCookie = cookie(bootstrap);

    const invitation = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administratorCookie },
      payload: {},
    });
    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      payload: {
        code: invitation.json().code,
        member: { displayName: "Search Member" },
      },
    });
    memberId = redemption.json().member.id as string;
    memberCookie = cookie(redemption);
    const grant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: memberCookie },
      payload: { deviceName: "Search Mac" },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: grant.json().grant },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${enrollment.json().credential}` },
      payload: { batchId: randomUUID(), events: [sessionStart("session-real-search")] },
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("finds a real Session by Member and repository while excluding a matching Seeded Session and aggregates by default", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/starter-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(imported.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organization/activity?memberId=${memberId}&repository=searchable-repository&q=compilation&pageSize=1`,
      headers: { cookie: administratorCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      syntheticInclusion: "excluded",
      items: [
        {
          id: "session-real-search",
          owner: { memberId, displayName: "Search Member", isExample: false },
          repository: { remoteIdentity: "https://example.com/acme/searchable-repository.git" },
          synthetic: { kind: "real", examplePackVersion: null },
          deepLink: "/?session=session-real-search",
        },
      ],
      page: { pageSize: 1, hasMore: false, total: 1 },
      aggregates: {
        sessions: 1,
        members: 1,
        repositories: 1,
        activityStates: { live: 1, idle: 0, resumed: 0 },
      },
    });
  });

  it("keeps example-pack import idempotent, makes explicit inclusion visible, and lets the owner annotate for later search", async () => {
    const memberImport = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/starter-v1/import",
      headers: { cookie: memberCookie },
    });
    expect(memberImport.statusCode).toBe(403);
    expect(memberImport.json()).toMatchObject({
      error: { code: "ADMINISTRATOR_REQUIRED" },
    });

    const repeatedImport = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/starter-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(repeatedImport.statusCode).toBe(200);
    expect(repeatedImport.json()).toMatchObject({
      imported: false,
      syntheticDesignation: "seeded",
      sessionIds: ["seeded-starter-compilation"],
    });

    const annotation = await app.inject({
      method: "PATCH",
      url: "/api/v1/sessions/session-real-search/annotations",
      headers: { cookie: memberCookie },
      payload: {
        outcome: "partial",
        reviewStatus: "needs_help",
        tags: ["compiler", "compiler"],
      },
    });
    expect(annotation.statusCode).toBe(200);
    expect(annotation.json()).toMatchObject({
      outcome: "partial",
      reviewStatus: "needs_help",
      tags: ["compiler"],
    });

    const nonOwnerAnnotation = await app.inject({
      method: "PATCH",
      url: "/api/v1/sessions/seeded-starter-compilation/annotations",
      headers: { cookie: memberCookie },
      payload: { outcome: "successful" },
    });
    expect(nonOwnerAnnotation.statusCode).toBe(403);
    expect(nonOwnerAnnotation.json()).toMatchObject({
      error: { code: "SESSION_ANNOTATION_FORBIDDEN" },
    });

    const included = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?q=compilation&includeSeeded=true&pageSize=10",
      headers: { cookie: administratorCookie },
    });
    expect(included.statusCode).toBe(200);
    expect(included.json()).toMatchObject({
      syntheticInclusion: "included",
      page: { total: 2 },
      aggregates: { sessions: 2, outcomes: { partial: 1, unknown: 1 } },
    });
    expect(included.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "session-real-search",
          annotations: expect.objectContaining({
            outcome: "partial",
            reviewStatus: "needs_help",
            tags: ["compiler"],
            updatedAt: expect.any(String),
          }),
        }),
        expect.objectContaining({
          id: "seeded-starter-compilation",
          owner: expect.objectContaining({ isExample: true }),
          synthetic: expect.objectContaining({
            kind: "seeded",
            examplePackVersion: "starter-v1",
          }),
        }),
      ]),
    );
  });
});
