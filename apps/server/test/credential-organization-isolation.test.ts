import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  if (typeof serialized !== "string") throw new Error("Missing browser cookie");
  return serialized.split(";", 1)[0]!;
}

function event(sessionId: string, turnId: string): SourceEvent {
  const id = randomUUID();
  const rawPayload = { hook_event_name: "SessionStart", session_id: sessionId, turn_id: turnId };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "SessionStart" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-18T00:00:00.000Z",
    capturedAt: "2026-07-18T00:00:00.000Z",
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

describe.sequential("credential and administrative Organization isolation", () => {
  const testDatabase = createTestDatabase("credential_org_isolation");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let browserCookie: string;
  let organizationA: string;
  let organizationB: string;
  let memberA: string;
  let memberB: string;
  let deviceA: { id: string };
  let deviceCredentialA: string;
  let analysisCredentialA: string;
  let deviceCredentialB: string;
  let analysisCredentialB: string;
  let candidateA: { id: string; versionId: string; artifactHash: string };
  let releaseA: { releaseId: string };

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    let bootstrapCode: string | undefined;
    app = await buildApp({ databaseUrl: testDatabase.databaseUrl, onBootstrapCode: (code) => { bootstrapCode = code; } });
    const bootstrap = await app.inject({ method: "POST", url: "/api/v1/bootstrap/redeem", payload: {
      code: bootstrapCode, organization: { name: "Organization A" }, administrator: { displayName: "A Administrator" },
    } });
    browserCookie = cookie(bootstrap);
    organizationA = bootstrap.json().organization.id;
    memberA = bootstrap.json().member.id;
    const createdB = await app.inject({ method: "POST", url: "/api/v1/organizations", headers: { cookie: browserCookie }, payload: { name: "Organization B" } });
    organizationB = createdB.json().organization.id;
    memberB = createdB.json().member.id;

    const memberships = await app.inject({ method: "GET", url: "/api/v1/person/memberships", headers: { cookie: browserCookie } });
    const membershipA = memberships.json().memberships.find((item: { organization: { id: string } }) => item.organization.id === organizationA);
    await app.inject({ method: "PUT", url: "/api/v1/session/active-membership", headers: { cookie: browserCookie }, payload: { membershipId: membershipA.member.id } });
    const grantA = await app.inject({ method: "POST", url: "/api/v1/device-enrollment-grants", headers: { cookie: browserCookie }, payload: { deviceName: "A Device" } });
    const enrollmentA = await app.inject({ method: "POST", url: "/api/v1/device-enrollments/redeem", payload: { grant: grantA.json().grant } });
    deviceA = enrollmentA.json().device;
    deviceCredentialA = enrollmentA.json().credential;
    const analysisA = await app.inject({ method: "POST", url: "/api/v1/analysis-credentials", headers: { cookie: browserCookie }, payload: { name: "A Analysis" } });
    analysisCredentialA = analysisA.json().credential;
    await app.inject({ method: "POST", url: "/api/v1/device/source-event-batches", headers: { authorization: `Bearer ${deviceCredentialA}` }, payload: { batchId: randomUUID(), events: [event("org-a-session", "org-a-turn")] } });

    await app.inject({ method: "PUT", url: "/api/v1/session/active-membership", headers: { cookie: browserCookie }, payload: { membershipId: memberB } });
    const grantB = await app.inject({ method: "POST", url: "/api/v1/device-enrollment-grants", headers: { cookie: browserCookie }, payload: { deviceName: "B Device" } });
    const enrollmentB = await app.inject({ method: "POST", url: "/api/v1/device-enrollments/redeem", payload: { grant: grantB.json().grant } });
    deviceCredentialB = enrollmentB.json().credential;
    const analysisB = await app.inject({ method: "POST", url: "/api/v1/analysis-credentials", headers: { cookie: browserCookie }, payload: { name: "B Analysis" } });
    analysisCredentialB = analysisB.json().credential;
    await app.inject({ method: "POST", url: "/api/v1/device/source-event-batches", headers: { authorization: `Bearer ${deviceCredentialB}` }, payload: { batchId: randomUUID(), events: [event("org-b-session", "org-b-turn")] } });

    const detailA = await app.inject({ method: "GET", url: "/api/v1/sessions/org-a-session", headers: { authorization: `Bearer ${analysisCredentialA}` } });
    const activityId = detailA.json().timeline[0].sourceEventId as string;
    const candidatePackage = { files: [{ path: "SKILL.md", content: "---\nname: org-a-skill\ndescription: An Organization A skill.\n---\n\nUse captured evidence." }] };
    const artifactHash = `sha256:${createHash("sha256").update(JSON.stringify(candidatePackage)).digest("hex")}`;
    const submission = await app.inject({ method: "POST", url: "/api/v1/candidates", headers: { authorization: `Bearer ${analysisCredentialA}` }, payload: {
      name: "org-a-skill", version: "1.0.0", reviewerContext: "Organization A review", uncertainty: { level: "low", statement: "One real observation." },
      claims: [{ id: "claim-a", statement: "A has evidence.", classification: "descriptive", citationIds: ["citation-a"] }],
      citations: [{ id: "citation-a", sessionId: "org-a-session", turnId: "org-a-turn", activityId }], package: candidatePackage, artifactHash,
    } });
    candidateA = { id: submission.json().candidate.id, versionId: submission.json().version.id, artifactHash };
    await app.inject({ method: "PUT", url: "/api/v1/session/active-membership", headers: { cookie: browserCookie }, payload: { membershipId: memberA } });
    const approval = await app.inject({ method: "POST", url: `/api/v1/candidates/${candidateA.id}/versions/${candidateA.versionId}/approve`, headers: { cookie: browserCookie }, payload: { artifactHash } });
    expect(approval.statusCode).toBe(201);
    releaseA = { releaseId: approval.json().release.releaseId };
    await app.inject({ method: "PUT", url: "/api/v1/session/active-membership", headers: { cookie: browserCookie }, payload: { membershipId: memberB } });
  });

  afterAll(async () => { await app?.close(); await testDatabase.drop(); });

  it("binds Analysis credentials to their issuing Organization and never leaks another Organization", async () => {
    const own = await app.inject({ method: "GET", url: "/api/v1/sessions/org-a-session", headers: { authorization: `Bearer ${analysisCredentialA}` } });
    expect(own.statusCode).toBe(200);
    const foreign = await app.inject({ method: "GET", url: "/api/v1/sessions/org-b-session", headers: { authorization: `Bearer ${analysisCredentialA}` } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: { code: "EXECUTION_SESSION_NOT_FOUND", message: "The Session was not found." } });
    const reverse = await app.inject({ method: "GET", url: "/api/v1/sessions/org-a-session", headers: { authorization: `Bearer ${analysisCredentialB}` } });
    expect(reverse.statusCode).toBe(404);
  });

  it("keeps Device settings and credentials bound to one membership", async () => {
    const crossPolicy = await app.inject({ method: "PATCH", url: `/api/v1/devices/${deviceA.id}/capture-policy`, headers: { cookie: browserCookie }, payload: { demoCanaryEnabled: true } });
    expect(crossPolicy.statusCode).toBe(404);
    const ownPolicy = await app.inject({ method: "GET", url: "/api/v1/device/capture-policy", headers: { authorization: `Bearer ${deviceCredentialA}` } });
    expect(ownPolicy.statusCode).toBe(200);
    const foreignCandidate = await app.inject({ method: "POST", url: `/api/v1/candidates/${candidateA.id}/versions/${candidateA.versionId}/approve`, headers: { cookie: browserCookie }, payload: { artifactHash: candidateA.artifactHash } });
    expect(foreignCandidate.statusCode).toBe(404);
    expect(foreignCandidate.json()).toEqual({ error: { code: "CANDIDATE_NOT_FOUND", message: "The Candidate version was not found in the authenticated Organization." } });
    const foreignArtifact = await app.inject({ method: "GET", url: `/api/v1/device/standards/artifacts/${releaseA.releaseId}`, headers: { authorization: `Bearer ${deviceCredentialB}` } });
    expect(foreignArtifact.statusCode).toBe(404);
    expect(foreignArtifact.json()).toEqual({ error: { code: "STANDARD_RELEASE_NOT_FOUND", message: "The approved Organization standard release was not found." } });
  });
});
