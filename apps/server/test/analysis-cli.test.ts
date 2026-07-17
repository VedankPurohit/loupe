import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

const cliPath = fileURLToPath(
  new URL("../../diagnostic-cli/dist/cli.js", import.meta.url),
);

function turnEvent(sessionId: string, turnId: string, occurredAt: string): SourceEvent {
  const id = randomUUID();
  const rawPayload = {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    turn_id: turnId,
    source: "startup",
    model: "gpt-analysis-fixture",
    tool_name: "shell",
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

function cookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}) {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  return String(serialized).split(";", 1)[0]!;
}

async function runCli(args: string[]) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { exitCode, stdout, stderr };
}

describe.sequential("revocable Analysis credential and real CLI", () => {
  const testDatabase = createTestDatabase("analysis_cli");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let browserCookie: string;
  let analysisCredential: string;
  let analysisCredentialId: string;
  let serverUrl: string;
  let temporaryDirectory: string;

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
        organization: { name: "Analysis Lab" },
        administrator: { displayName: "Administrator Analyst" },
      },
    });
    browserCookie = cookie(bootstrap);
    const grant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Analysis fixture Mac" },
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
      payload: {
        batchId: randomUUID(),
        events: [
          turnEvent("analysis-session-a", "analysis-turn-a", "2026-07-17T14:00:00.000Z"),
          turnEvent("analysis-session-b", "analysis-turn-b", "2026-07-17T14:05:00.000Z"),
        ],
      },
    });
    const credential = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: browserCookie },
      payload: { name: "Build Week analyst" },
    });
    expect(credential.statusCode).toBe(201);
    analysisCredential = credential.json().credential as string;
    analysisCredentialId = credential.json().analysisCredential.id as string;
    temporaryDirectory = await mkdtemp(join(tmpdir(), "loupe-analysis-candidate-"));
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("searches real evidence in structured output, follows a citation, and cannot mutate evidence or administer the Organization", async () => {
    const search = await runCli([
      "search",
      "--query",
      "analysis",
      "--page",
      "1",
      "--page-size",
      "1",
      "--json",
      "--server-url",
      serverUrl,
      "--analysis-credential",
      analysisCredential,
    ]);
    expect(search).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(search.stdout)).toMatchObject({
      syntheticInclusion: "excluded",
      page: { page: 1, pageSize: 1, total: 2, hasMore: true, nextPage: 2 },
      items: [
        expect.objectContaining({
          synthetic: { kind: "real", examplePackVersion: null },
          deepLink: expect.stringContaining("?session="),
        }),
      ],
    });

    const inspected = await runCli([
      "inspect",
      "analysis-session-a",
      "--json",
      "--server-url",
      serverUrl,
      "--analysis-credential",
      analysisCredential,
    ]);
    expect(inspected).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      session: {
        id: "analysis-session-a",
        synthetic: { kind: "real", examplePackVersion: null },
        deepLink: "/?session=analysis-session-a",
      },
      turns: [
        expect.objectContaining({
          id: "analysis-turn-a",
          evidence: expect.objectContaining({ derivation: "exact" }),
        }),
      ],
    });

    const comparison = await runCli([
      "compare",
      "analysis-session-a:analysis-turn-a",
      "analysis-session-b:analysis-turn-b",
      "--claim",
      "Both real Turns used the captured workflow.",
      "--json",
      "--server-url",
      serverUrl,
      "--analysis-credential",
      analysisCredential,
    ]);
    expect(comparison).toMatchObject({ exitCode: 0, stderr: "" });
    const comparisonBody = JSON.parse(comparison.stdout);
    expect(comparisonBody).toMatchObject({
      syntheticInclusion: "excluded",
      population: { distinctRealTurns: 2, seededTurns: 0 },
      claim: { classification: "repeated_pattern" },
    });
    const citation = comparisonBody.citations[0];
    const cited = await runCli([
      "cite",
      `${citation.sessionId}:${citation.turnId}:${citation.activityId}`,
      "--json",
      "--server-url",
      serverUrl,
      "--analysis-credential",
      analysisCredential,
    ]);
    expect(cited).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(cited.stdout)).toMatchObject({
      citation: {
        sessionId: citation.sessionId,
        turnId: citation.turnId,
        activityId: citation.activityId,
        synthetic: "real",
        fidelity: expect.objectContaining({ derivation: "exact" }),
      },
    });

    for (const request of [
      {
        method: "PATCH" as const,
        url: "/api/v1/sessions/analysis-session-a/annotations",
        payload: { outcome: "successful" },
      },
      ...["approve", "publish", "pause", "rollback"].map((action) => ({
        method: "POST" as const,
        url: "/api/v1/administration/actions",
        payload: { action },
      })),
      {
        method: "POST" as const,
        url: "/api/v1/device/source-event-batches",
        payload: { batchId: randomUUID(), events: [turnEvent("forbidden", "forbidden", new Date().toISOString())] },
      },
    ]) {
      const denied = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${analysisCredential}` },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({
        error: { code: "ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN" },
      });
    }
  });

  it("submits a complete immutable Candidate package and rejects prose-only, uncited, hash-mismatched, or duplicate versions with stable errors", async () => {
    const comparison = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { authorization: `Bearer ${analysisCredential}` },
      payload: {
        selections: [
          { scope: "turn", sessionId: "analysis-session-a", turnId: "analysis-turn-a" },
          { scope: "turn", sessionId: "analysis-session-b", turnId: "analysis-turn-b" },
        ],
        claim: { kind: "pattern", statement: "Both real Turns used the captured workflow." },
      },
    });
    const citations = comparison.json().citations as Array<{
      sessionId: string;
      turnId: string;
      activityId: string;
    }>;
    const skillContent =
      "---\nname: prefer-evidence\ndescription: Require evidence before recommendations.\n---\n\n# Prefer evidence\n\nCite observed Turns before recommending changes.\n";
    const manifest = {
      name: "prefer-evidence",
      version: "1.0.0",
      reviewerContext:
        "Review whether requiring Turn citations is appropriate for Organization investigations.",
      uncertainty: {
        level: "medium",
        statement: "The pattern is supported by two captured Turns but has not been evaluated after rollout.",
      },
      claims: [
        {
          id: "claim-two-real-turns",
          statement: "Two distinct real captured Turns used this workflow.",
          citationIds: ["evidence-a", "evidence-b"],
        },
      ],
      citations: citations.map((citation, index) => ({
        ...citation,
        id: index === 0 ? "evidence-a" : "evidence-b",
      })),
      package: { files: [{ path: "SKILL.md", content: skillContent }] },
      artifactHash:
        "sha256:48bb181d41354e2c6a051c0f981286934507e784b4e7c389694ac0bd6c116830",
    };
    const manifestPath = join(temporaryDirectory, "candidate.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const submitted = await runCli([
      "candidate",
      "submit",
      manifestPath,
      "--json",
      "--server-url",
      serverUrl,
      "--analysis-credential",
      analysisCredential,
    ]);
    expect(submitted).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      candidate: {
        name: "prefer-evidence",
        status: "pending_review",
        deepLink: expect.stringContaining("?candidate="),
      },
      version: {
        version: "1.0.0",
        immutable: true,
        artifactHash: manifest.artifactHash,
        reviewerContext: manifest.reviewerContext,
        uncertainty: manifest.uncertainty,
        claims: manifest.claims,
        citations: [
          expect.objectContaining({ synthetic: "real" }),
          expect.objectContaining({ synthetic: "real" }),
        ],
        package: manifest.package,
      },
    });

    const invalidRequests = [
      {
        expectedCode: "CANDIDATE_PACKAGE_INCOMPLETE",
        body: { ...manifest, name: "prose-only", version: "1.0.0", package: { files: [] } },
      },
      {
        expectedCode: "CANDIDATE_CLAIMS_UNCITED",
        body: {
          ...manifest,
          version: "1.0.1",
          claims: [{ ...manifest.claims[0], citationIds: [] }],
        },
      },
      {
        expectedCode: "CANDIDATE_ARTIFACT_HASH_MISMATCH",
        body: {
          ...manifest,
          version: "1.0.2",
          artifactHash: `sha256:${"0".repeat(64)}`,
        },
      },
      {
        expectedCode: "CANDIDATE_VERSION_EXISTS",
        expectedStatus: 409,
        body: manifest,
      },
    ];
    for (const invalid of invalidRequests) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/candidates",
        headers: { authorization: `Bearer ${analysisCredential}` },
        payload: invalid.body,
      });
      expect(response.statusCode).toBe(invalid.expectedStatus ?? 422);
      expect(response.json()).toMatchObject({
        error: { code: invalid.expectedCode },
      });
    }
  });

  it("revokes predictably while retaining previously submitted Candidate history", async () => {
    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/analysis-credentials/${analysisCredentialId}/revoke`,
      headers: { cookie: browserCookie },
    });
    expect(revoked.statusCode).toBe(204);

    const denied = await runCli([
      "search",
      "--json",
      "--server-url",
      serverUrl,
      "--analysis-credential",
      analysisCredential,
    ]);
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stderr)).toMatchObject({
      error: { code: "ANALYSIS_CREDENTIAL_REQUIRED" },
    });

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/candidates",
      headers: { cookie: browserCookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ name: "prefer-evidence" }),
        version: expect.objectContaining({
          version: "1.0.0",
          artifactHash:
            "sha256:48bb181d41354e2c6a051c0f981286934507e784b4e7c389694ac0bd6c116830",
        }),
      }),
    ]);
  });
});
