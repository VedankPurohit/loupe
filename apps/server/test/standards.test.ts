import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CandidatePackage, SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function cookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}) {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  return String(serialized).split(";", 1)[0]!;
}

function sourceEvent(sessionId: string, turnId: string): SourceEvent {
  const id = randomUUID();
  const occurredAt = "2026-07-17T14:00:00.000Z";
  const rawPayload = {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    turn_id: turnId,
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
    occurredAt,
    capturedAt: occurredAt,
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

describe.sequential("Organization standard approval through /api/v1", () => {
  const testDatabase = createTestDatabase("standards");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let administratorCookie: string;
  let analysisCredential: string;
  let candidateId: string;
  let approvedVersionId: string;
  let standardId: string;
  let firstReleaseId: string;
  let secondStandardId: string;
  let secondStandardReleaseId: string;
  const deviceCredentials: string[] = [];
  const candidatePackage: CandidatePackage = {
    files: [
      {
        path: "SKILL.md",
        content:
          "---\nname: evidence-first\ndescription: Require evidence before recommendations.\n---\n\nCite captured Turns.",
      },
    ],
  };
  const artifactHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(candidatePackage))
    .digest("hex")}`;

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
        organization: { name: "Standards Lab" },
        administrator: { displayName: "Standards Administrator" },
      },
    });
    administratorCookie = cookie(bootstrap);
    for (const deviceName of ["First Mac", "Second Mac"]) {
      const grant = await app.inject({
        method: "POST",
        url: "/api/v1/device-enrollment-grants",
        headers: { cookie: administratorCookie },
        payload: { deviceName },
      });
      const enrollment = await app.inject({
        method: "POST",
        url: "/api/v1/device-enrollments/redeem",
        payload: { grant: grant.json().grant },
      });
      deviceCredentials.push(enrollment.json().credential as string);
    }
    const delivered = await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${deviceCredentials[0]}` },
      payload: {
        batchId: randomUUID(),
        events: [sourceEvent("standards-session", "standards-turn")],
      },
    });
    expect(delivered.statusCode).toBe(200);
    const credential = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: administratorCookie },
      payload: { name: "Standards analysis" },
    });
    analysisCredential = credential.json().credential as string;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("binds approval to one immutable hash and exposes only that release to every Enrolled device", async () => {
    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/standards-session",
      headers: { authorization: `Bearer ${analysisCredential}` },
    });
    const activityId = sessions.json().timeline[0].sourceEventId as string;
    const submission = await app.inject({
      method: "POST",
      url: "/api/v1/candidates",
      headers: { authorization: `Bearer ${analysisCredential}` },
      payload: {
        name: "evidence-first",
        version: "1.0.0",
        reviewerContext: "Require navigable evidence.",
        uncertainty: { level: "low", statement: "Observed in one real Turn." },
        claims: [
          {
            id: "claim-1",
            statement: "The workflow should cite captured Turns.",
            classification: "single_case_hypothesis",
            citationIds: ["citation-1"],
          },
        ],
        citations: [
          {
            id: "citation-1",
            sessionId: "standards-session",
            turnId: "standards-turn",
            activityId,
          },
        ],
        package: candidatePackage,
        artifactHash,
      },
    });
    expect(submission.statusCode).toBe(201);
    const { candidate, version } = submission.json();
    candidateId = candidate.id as string;
    approvedVersionId = version.id as string;

    const mismatched = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidate.id}/versions/${version.id}/approve`,
      headers: { cookie: administratorCookie },
      payload: { artifactHash: `sha256:${"0".repeat(64)}` },
    });
    expect(mismatched).toMatchObject({ statusCode: 409 });
    expect(mismatched.json()).toMatchObject({
      error: { code: "CANDIDATE_APPROVAL_HASH_MISMATCH" },
    });

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidate.id}/versions/${version.id}/approve`,
      headers: { cookie: administratorCookie },
      payload: { artifactHash },
    });
    expect(approved.statusCode).toBe(201);
    standardId = approved.json().release.standardId as string;
    firstReleaseId = approved.json().release.releaseId as string;
    expect(approved.json()).toMatchObject({
      release: {
        standardId: expect.any(String),
        releaseId: expect.any(String),
        version: "1.0.0",
        artifactHash,
        mandatory: true,
        immutable: true,
      },
    });

    const secondPackage: CandidatePackage = {
      files: [
        {
          path: "SKILL.md",
          content:
            "---\nname: test-first\ndescription: Require a failing regression before implementation.\n---\n\nWork red, then green.",
        },
      ],
    };
    const secondHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(secondPackage))
      .digest("hex")}`;
    const secondSubmission = await app.inject({
      method: "POST",
      url: "/api/v1/candidates",
      headers: { authorization: `Bearer ${analysisCredential}` },
      payload: {
        name: "test-first",
        version: "1.0.0",
        reviewerContext: "Keep implementation grounded in an observable regression.",
        uncertainty: { level: "low", statement: "Observed in one real Turn." },
        claims: [
          {
            id: "claim-2",
            statement: "The workflow should begin with a failing regression.",
            classification: "single_case_hypothesis",
            citationIds: ["citation-2"],
          },
        ],
        citations: [
          {
            id: "citation-2",
            sessionId: "standards-session",
            turnId: "standards-turn",
            activityId,
          },
        ],
        package: secondPackage,
        artifactHash: secondHash,
      },
    });
    expect(secondSubmission.statusCode).toBe(201);
    const secondApproval = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${secondSubmission.json().candidate.id}/versions/${secondSubmission.json().version.id}/approve`,
      headers: { cookie: administratorCookie },
      payload: { artifactHash: secondHash },
    });
    expect(secondApproval.statusCode).toBe(201);
    secondStandardId = secondApproval.json().release.standardId as string;
    secondStandardReleaseId = secondApproval.json().release.releaseId as string;

    const freshGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: administratorCookie },
      payload: { deviceName: "Fresh Mac" },
    });
    const freshEnrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: freshGrant.json().grant },
    });
    deviceCredentials.push(freshEnrollment.json().credential as string);

    for (const credential of deviceCredentials) {
      const manifest = await app.inject({
        method: "GET",
        url: "/api/v1/device/standards/manifest",
        headers: { authorization: `Bearer ${credential}` },
      });
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json()).toMatchObject({
        schemaVersion: "1",
        targets: [
          {
            standardId,
            name: "evidence-first",
            version: "1.0.0",
            artifactHash,
            state: "active",
            mandatory: true,
            previousReleaseId: null,
            artifactUrl: expect.stringMatching(
              /^\/api\/v1\/device\/standards\/artifacts\//,
            ),
            collisionPolicy: "organization_wins_preserve_personal",
          },
          {
            standardId: secondStandardId,
            name: "test-first",
            releaseId: secondStandardReleaseId,
            artifactHash: secondHash,
            state: "active",
            mandatory: true,
            previousReleaseId: null,
          },
        ],
      });
      const artifact = await app.inject({
        method: "GET",
        url: manifest.json().targets[0].artifactUrl,
        headers: { authorization: `Bearer ${credential}` },
      });
      expect(artifact.statusCode).toBe(200);
      expect(artifact.json()).toMatchObject({ artifactHash, package: candidatePackage });
    }
  });

  it("makes browser review Administrator-only and an edit a new unapproved immutable version", async () => {
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administratorCookie },
      payload: { expiresInHours: 1 },
    });
    const member = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      payload: {
        code: invite.json().code,
        member: { displayName: "Ordinary Member" },
      },
    });
    const memberCookie = cookie(member);
    const changedPackage: CandidatePackage = {
      files: [
        {
          path: "SKILL.md",
          content:
            "---\nname: evidence-first\ndescription: Require exact evidence before recommendations.\n---\n\nCite two captured Turns when claiming a repeated pattern.",
        },
      ],
    };
    const changedHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(changedPackage))
      .digest("hex")}`;
    const editPayload = {
      version: "1.1.0",
      reviewerContext: "Administrator clarified the evidence threshold.",
      uncertainty: { level: "low", statement: "Existing citation retained." },
      claims: [
        {
          id: "claim-1",
          statement: "The workflow should cite captured Turns.",
          classification: "single_case_hypothesis",
          citationIds: ["citation-1"],
        },
      ],
      package: changedPackage,
      artifactHash: changedHash,
    };
    const editUrl = `/api/v1/candidates/${candidateId}/versions/${approvedVersionId}/edit`;
    for (const authentication of [
      { cookie: memberCookie },
      { authorization: `Bearer ${analysisCredential}` },
      { authorization: `Bearer ${deviceCredentials[0]}` },
    ]) {
      for (const action of [
        { url: editUrl, payload: editPayload },
        {
          url: `/api/v1/candidates/${candidateId}/versions/${approvedVersionId}/approve`,
          payload: { artifactHash },
        },
        {
          url: `/api/v1/candidates/${candidateId}/versions/${approvedVersionId}/reject`,
          payload: { note: "Not authorized to decide." },
        },
      ]) {
        const denied = await app.inject({
          method: "POST",
          url: action.url,
          headers: authentication,
          payload: action.payload,
        });
        expect(denied.statusCode, action.url).toBe(403);
      }
    }

    const unsupportedRepeatedPattern = await app.inject({
      method: "POST",
      url: editUrl,
      headers: { cookie: administratorCookie },
      payload: {
        ...editPayload,
        claims: [
          {
            ...editPayload.claims[0],
            classification: "repeated_pattern",
          },
        ],
      },
    });
    expect(unsupportedRepeatedPattern.statusCode).toBe(422);
    expect(unsupportedRepeatedPattern.json()).toMatchObject({
      error: {
        code: "CANDIDATE_REPEATED_PATTERN_REQUIRES_TWO_REAL_TURNS",
      },
    });

    const edited = await app.inject({
      method: "POST",
      url: editUrl,
      headers: { cookie: administratorCookie },
      payload: editPayload,
    });
    expect(edited.statusCode).toBe(201);
    expect(edited.json()).toMatchObject({
      candidate: { status: "pending_review" },
      version: {
        version: "1.1.0",
        immutable: true,
        artifactHash: changedHash,
        review: { state: "pending_review" },
      },
    });
    const manifest = await app.inject({
      method: "GET",
      url: "/api/v1/device/standards/manifest",
      headers: { authorization: `Bearer ${deviceCredentials[0]}` },
    });
    expect(manifest.json().targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          standardId,
          releaseId: firstReleaseId,
          artifactHash,
          version: "1.0.0",
        }),
        expect.objectContaining({
          standardId: secondStandardId,
          releaseId: secondStandardReleaseId,
          state: "active",
        }),
      ]),
    );

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidateId}/versions/${edited.json().version.id}/reject`,
      headers: { cookie: administratorCookie },
      payload: { note: "The stronger claim is not yet supported by two real Turns." },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      candidate: { status: "rejected" },
      version: { review: { state: "rejected" } },
    });
  });

  it("pauses, reports isolated Device status, and rolls back the manifest target", async () => {
    const nextPackage: CandidatePackage = {
      files: [
        {
          path: "SKILL.md",
          content:
            "---\nname: evidence-first\ndescription: Require evidence before every recommendation.\n---\n\nAlways cite captured Turns.",
        },
      ],
    };
    const nextHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(nextPackage))
      .digest("hex")}`;
    const edited = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidateId}/versions/${approvedVersionId}/edit`,
      headers: { cookie: administratorCookie },
      payload: {
        version: "2.0.0",
        reviewerContext: "Mandatory next release.",
        uncertainty: { level: "low", statement: "Existing citation retained." },
        claims: [
          {
            id: "claim-1",
            statement: "The workflow should cite captured Turns.",
            classification: "single_case_hypothesis",
            citationIds: ["citation-1"],
          },
        ],
        package: nextPackage,
        artifactHash: nextHash,
      },
    });
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidateId}/versions/${edited.json().version.id}/approve`,
      headers: { cookie: administratorCookie },
      payload: { artifactHash: nextHash },
    });
    expect(approved.statusCode).toBe(201);
    const secondReleaseId = approved.json().release.releaseId as string;

    const paused = await app.inject({
      method: "POST",
      url: `/api/v1/organization-standards/${standardId}/pause`,
      headers: { cookie: administratorCookie },
    });
    expect(paused.statusCode).toBe(204);
    const pausedManifest = await app.inject({
      method: "GET",
      url: "/api/v1/device/standards/manifest",
      headers: { authorization: `Bearer ${deviceCredentials[0]}` },
    });
    expect(pausedManifest.json().targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          standardId,
          state: "paused",
          releaseId: secondReleaseId,
          previousReleaseId: firstReleaseId,
        }),
        expect.objectContaining({
          standardId: secondStandardId,
          state: "active",
          releaseId: secondStandardReleaseId,
          previousReleaseId: null,
        }),
      ]),
    );

    const report = await app.inject({
      method: "POST",
      url: "/api/v1/device/standards/installations",
      headers: { authorization: `Bearer ${deviceCredentials[0]}` },
      payload: {
        standardId,
        releaseId: secondReleaseId,
        installedReleaseId: firstReleaseId,
        state: "deferred_active_session",
        observedAt: "2026-07-17T15:00:00.000Z",
        activeSessionIds: ["active-session-1"],
      },
    });
    expect(report.statusCode).toBe(201);
    expect(report.json()).toMatchObject({
      standardId,
      state: "deferred_active_session",
      activeSessionIds: ["active-session-1"],
    });
    const crossStandardReport = await app.inject({
      method: "POST",
      url: "/api/v1/device/standards/installations",
      headers: { authorization: `Bearer ${deviceCredentials[0]}` },
      payload: {
        standardId: secondStandardId,
        releaseId: secondReleaseId,
        installedReleaseId: firstReleaseId,
        state: "installed",
        observedAt: "2026-07-17T15:01:00.000Z",
        activeSessionIds: [],
      },
    });
    expect(crossStandardReport.statusCode).toBe(404);
    expect(crossStandardReport.json()).toMatchObject({
      error: { code: "STANDARD_RELEASE_NOT_FOUND" },
    });
    const administratorStatus = await app.inject({
      method: "GET",
      url: "/api/v1/organization-standards",
      headers: { cookie: administratorCookie },
    });
    expect(administratorStatus.statusCode).toBe(200);
    expect(administratorStatus.json().items[0]).toMatchObject({
      standardId,
      state: "paused",
      installations: [
        expect.objectContaining({
          state: "deferred_active_session",
          activeSessionIds: ["active-session-1"],
        }),
      ],
    });
    expect(administratorStatus.json().items[1]).toMatchObject({
      standardId: secondStandardId,
      installations: [],
    });
    const otherDeviceReports = await app.inject({
      method: "GET",
      url: "/api/v1/device/standards/installations",
      headers: { authorization: `Bearer ${deviceCredentials[1]}` },
    });
    expect(otherDeviceReports.json()).toEqual({ items: [] });

    const rollback = await app.inject({
      method: "POST",
      url: `/api/v1/organization-standards/${standardId}/rollback`,
      headers: { cookie: administratorCookie },
      payload: { releaseId: firstReleaseId },
    });
    expect(rollback.statusCode).toBe(204);
    const rolledBackManifest = await app.inject({
      method: "GET",
      url: "/api/v1/device/standards/manifest",
      headers: { authorization: `Bearer ${deviceCredentials[1]}` },
    });
    expect(rolledBackManifest.json().targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          standardId,
          state: "active",
          releaseId: firstReleaseId,
          artifactHash,
          previousReleaseId: secondReleaseId,
        }),
        expect.objectContaining({
          standardId: secondStandardId,
          state: "active",
          releaseId: secondStandardReleaseId,
          previousReleaseId: null,
        }),
      ]),
    );
  });
});
