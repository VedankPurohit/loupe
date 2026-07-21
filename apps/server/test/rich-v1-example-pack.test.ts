import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

const cliPath = fileURLToPath(
  new URL("../../diagnostic-cli/dist/cli.js", import.meta.url),
);
const firstRichSessionId = "seeded-rich-v1-ledger-a11y-00";

async function runCli(args: string[], analysisCredential: string) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      NO_COLOR: "1",
      CODING_AGENT_OBSERVABILITY_ANALYSIS_CREDENTIAL: analysisCredential,
    },
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

function cookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}) {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  return String(serialized).split(";", 1)[0]!;
}

describe.sequential("rich-v1 Example pack through the Administrator /api/v1 seam", () => {
  const testDatabase = createTestDatabase("rich_v1_example_pack");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let administratorCookie: string;
  let primaryMembershipId: string;

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
        organization: { name: "Rich v1 Example Pack Lab" },
        administrator: { displayName: "Administrator" },
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    administratorCookie = cookie(bootstrap);
    primaryMembershipId = bootstrap.json().member.id as string;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  }, 30_000);

  it("imports the independently fixed rich-v1 manifest totals", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
    });

    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({
      version: "rich-v1",
      imported: true,
      counts: {
        members: 12,
        sessions: 480,
        turns: 1_088,
        agentRuns: 864,
        detailRecords: 3_104,
      },
      syntheticDesignation: "seeded",
    });
    expect(imported.json().sessionIds).toHaveLength(480);

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&page=1&pageSize=25",
      headers: { cookie: administratorCookie },
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      syntheticInclusion: "included",
      page: { page: 1, pageSize: 25, total: 480, hasMore: true, nextPage: 2 },
      aggregates: { sessions: 480, members: 12 },
    });
    expect(firstPage.json().items).toHaveLength(25);
    expect(firstPage.json().members).toHaveLength(12);
    for (const member of firstPage.json().members) {
      expect(member).toMatchObject({ isExample: true, sessionCount: 40 });
      expect(member.displayName).toContain("Example");
    }
    for (const session of firstPage.json().items) {
      expect(session).toMatchObject({
        owner: expect.objectContaining({ isExample: true, deviceId: null }),
        synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
      });
      expect(session.owner.displayName).toContain("Example");
    }

    const devices = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: administratorCookie },
    });
    expect(devices.statusCode).toBe(200);
    expect(devices.json()).toMatchObject({ devices: [] });
  }, 30_000);

  it("re-imports the same identities and timestamps without duplication", async () => {
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${firstRichSessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json()).toMatchObject({
      session: {
        id: firstRichSessionId,
        owner: { deviceId: null },
        ownerProfile: { displayName: "Ada Lovelace · Example", isExample: true },
        firstObservedAt: "2026-06-08T09:00:00.000Z",
        lastObservedAt: "2026-06-08T09:19:00.000Z",
        synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
      },
      activities: [
        expect.objectContaining({
          sourceEventId: null,
          reference: expect.objectContaining({
            origin: "example_pack_server_controlled",
            examplePackVersion: "rich-v1",
          }),
        }),
      ],
    });
    expect(before.json().turns).toHaveLength(3);
    expect(before.json().agentRuns).toHaveLength(3);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json()).toMatchObject({
      version: "rich-v1",
      imported: false,
      counts: {
        members: 12,
        sessions: 480,
        turns: 1_088,
        agentRuns: 864,
        detailRecords: 3_104,
      },
      sessionIds: expect.arrayContaining([
        "seeded-rich-v1-ledger-a11y-00",
        "seeded-rich-v1-nonrepo-rate-limit-31",
      ]),
    });
    expect(repeated.json().sessionIds).toHaveLength(480);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${firstRichSessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json()).toEqual(before.json());

    const allSeeded = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&page=20&pageSize=25",
      headers: { cookie: administratorCookie },
    });
    expect(allSeeded.statusCode).toBe(200);
    expect(allSeeded.json()).toMatchObject({
      page: { page: 20, pageSize: 25, total: 480, hasMore: false, nextPage: null },
      aggregates: {
        sessions: 480,
        members: 12,
        activityStates: { live: 64, idle: 288, resumed: 128 },
        outcomes: { successful: 192, partial: 96, failed: 96, unknown: 96 },
      },
    });
    expect(allSeeded.json().items).toHaveLength(5);
    expect(allSeeded.json().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Ada Lovelace · Example",
          isExample: true,
          sessionCount: 40,
        }),
      ]),
    );
  }, 30_000);

  it("keeps all Seeded rows excluded by default and makes filters page through full volume", async () => {
    const excluded = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?page=1&pageSize=25",
      headers: { cookie: administratorCookie },
    });
    expect(excluded.statusCode).toBe(200);
    expect(excluded.json()).toMatchObject({
      syntheticInclusion: "excluded",
      items: [],
      page: { total: 0 },
      aggregates: { sessions: 0, members: 0 },
    });

    const scenarioFilter = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&q=schema-drift&pageSize=100",
      headers: { cookie: administratorCookie },
    });
    expect(scenarioFilter.statusCode).toBe(200);
    expect(scenarioFilter.json()).toMatchObject({
      page: { total: 32, hasMore: false },
      aggregates: { sessions: 32, members: 12 },
    });
    expect(scenarioFilter.json().items).toHaveLength(32);
    expect(scenarioFilter.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
          owner: expect.objectContaining({ isExample: true }),
        }),
      ]),
    );

    const nonRepository = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&q=nonrepo-rate-limit&pageSize=100",
      headers: { cookie: administratorCookie },
    });
    expect(nonRepository.statusCode).toBe(200);
    expect(nonRepository.json().page.total).toBe(32);
    expect(nonRepository.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gitContext: expect.objectContaining({
            status: "not_repository",
            repositoryRoot: null,
            remoteIdentity: null,
          }),
        }),
      ]),
    );

    const modelFacet = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&model=gpt-5.6-codex&pageSize=100",
      headers: { cookie: administratorCookie },
    });
    expect(modelFacet.statusCode).toBe(200);
    expect(modelFacet.json().page.total).toBe(112);

    const toolFacet = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&tool=shell&pageSize=100",
      headers: { cookie: administratorCookie },
    });
    expect(toolFacet.statusCode).toBe(200);
    expect(toolFacet.json().page.total).toBe(59);

    const capabilityFacet = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&capability=configured_mcp_servers&pageSize=100",
      headers: { cookie: administratorCookie },
    });
    expect(capabilityFacet.statusCode).toBe(200);
    expect(capabilityFacet.json().page.total).toBe(32);

    const errorFacet = await app.inject({
      method: "GET",
      url: "/api/v1/organization/activity?includeSeeded=true&error=429&pageSize=100",
      headers: { cookie: administratorCookie },
    });
    expect(errorFacet.statusCode).toBe(200);
    expect(errorFacet.json().page.total).toBe(32);
  }, 30_000);

  it("allows only an Administrator browser session and rejects client-authored evidence", async () => {
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administratorCookie },
      payload: { expiresInHours: 24 },
    });
    expect(invite.statusCode).toBe(201);
    const member = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      payload: {
        code: invite.json().code,
        member: { displayName: "Ordinary Member" },
      },
    });
    expect(member.statusCode).toBe(201);
    const memberCookie = cookie(member);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: memberCookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      error: { code: "ADMINISTRATOR_REQUIRED" },
    });

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const arbitraryEvidence = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
      payload: {
        owner: { displayName: "client-authored" },
        evidence: { path: "/private/example", prompt: "client-authored" },
      },
    });
    expect(arbitraryEvidence.statusCode).toBe(400);
  }, 30_000);

  it("exposes the prescribed lifecycle, hierarchy, API, Context, cost, and capability states", async () => {
    const ids = [
      "seeded-rich-v1-ledger-a11y-00",
      "seeded-rich-v1-ledger-empty-state-01",
      "seeded-rich-v1-ledger-filter-gaps-00",
      "seeded-rich-v1-release-context-pressure-00",
      "seeded-rich-v1-agent-parent-conflict-00",
      "seeded-rich-v1-telemetry-schema-drift-00",
      "seeded-rich-v1-nonrepo-rate-limit-31",
      "seeded-rich-v1-oauth-local-callback-01",
      "seeded-rich-v1-release-rollback-01",
      "seeded-rich-v1-oauth-membership-boundary-01",
      "seeded-rich-v1-telemetry-backfill-01",
      "seeded-rich-v1-agent-capabilities-01",
      "seeded-rich-v1-docs-mcp-unavailable-00",
      "seeded-rich-v1-docs-guide-01",
      "seeded-rich-v1-integrity-duplicate-event-00",
    ];
    const responses = await Promise.all(
      ids.map((id) =>
        app.inject({
          method: "GET",
          url: `/api/v1/sessions/${id}`,
          headers: { cookie: administratorCookie },
        }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(200);
    }
    const details = new Map(
      responses.map((response) => {
        const body = response.json();
        return [body.session.id as string, body] as const;
      }),
    );

    expect(details.get(ids[0]!)!.activities[0].source).toBe("startup");
    expect(details.get(ids[1]!)!.activities[0].source).toBe("resume");
    expect(details.get(ids[1]!)!.evidence.tokenUsage).toEqual([
      expect.objectContaining({ serviceTier: null }),
    ]);
    expect(details.get(ids[2]!)!.activities[0].source).toBe("observed");
    expect(details.get(ids[3]!)!.activities[0].source).toBe("compact");
    expect(details.get(ids[4]!)!.activities[0].source).toBe("clear");
    expect(details.get(ids[2]!)!.session.gitContext).toMatchObject({
      status: "available",
      remoteIdentity: null,
    });

    expect(details.get(ids[5]!)!.agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "subagent",
          parentEdge: expect.objectContaining({
            status: "inferred",
            reconciliation: expect.objectContaining({
              rule: "example_pack_inferred_parent",
            }),
          }),
        }),
      ]),
    );
    expect(details.get(ids[6]!)!.evidence.apiRequests).toEqual([
      expect.objectContaining({
        attempt: expect.any(Number),
        statusCode: 429,
        success: false,
      }),
      expect.objectContaining({
        attempt: null,
        statusCode: null,
        durationMs: null,
        success: null,
        error: null,
      }),
    ]);
    expect(details.get(ids[7]!)!.evidence.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ approval: "requested" }),
        expect.objectContaining({ approval: "approved" }),
      ]),
    );
    expect(details.get(ids[7]!)!.evidence.context.occupancy).toEqual([
      expect.objectContaining({ occupancyTokens: 64_001, occupancyPercent: 50.00078125 }),
    ]);
    expect(details.get(ids[3]!)!.evidence.context.occupancy).toEqual([
      expect.objectContaining({ occupancyTokens: 104_000, occupancyPercent: 81.25 }),
    ]);
    expect(details.get(ids[3]!)!.evidence.costEstimates).toEqual([
      expect.objectContaining({
        status: "unavailable",
        reason: "unknown_example_model_mapping",
      }),
    ]);
    expect(details.get(ids[8]!)!.evidence.costEstimates).toEqual([
      expect.objectContaining({
        status: "unavailable",
        reason: "incomplete_example_token_categories",
      }),
    ]);
    expect(details.get(ids[8]!)!.evidence.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "failure" }),
        expect.objectContaining({ outcome: "success", retryCount: 1 }),
      ]),
    );
    expect(details.get(ids[9]!)!.evidence.capabilities).toEqual([
      expect.objectContaining({
        capability: "implicit_skill_activation",
        state: "inferred",
      }),
    ]);
    expect(details.get(ids[10]!)!.evidence.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "compaction",
          event: "example_compaction_observed",
        }),
        expect.objectContaining({ kind: "resume", event: "example_resume_observed" }),
      ]),
    );
    expect(details.get(ids[4]!)!.evidence.lifecycle).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          conflictingParentObservations: expect.arrayContaining([
            expect.stringContaining("example-agent-rich-v1-agent-parent-conflict"),
            expect.stringContaining("example-agent-rich-v1-agent-parent-alternative"),
          ]),
          resolution: "unresolved",
        }),
      }),
    ]);
    expect(details.get(ids[11]!)!.evidence.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "observed_mcp_use", state: "observed" }),
        expect.objectContaining({
          capability: "complete_passive_capability_snapshot",
          state: "unavailable",
        }),
      ]),
    );
    expect(details.get(ids[12]!)!.evidence.capabilities).toEqual([
      expect.objectContaining({
        capability: "configured_mcp_servers",
        state: "conditional",
      }),
    ]);
    expect(details.get(ids[13]!)!.evidence.costEstimates).toEqual([
      expect.objectContaining({
        status: "unavailable",
        reason: "example_price_mapping_unavailable",
      }),
    ]);
    expect(details.get(ids[14]!)!.timeline).toEqual([
      expect.objectContaining({ event: "ExampleDuplicateSourceEventRetained" }),
    ]);
  }, 30_000);

  it("isolates colliding rich-v1 identities between two active Organization memberships", async () => {
    const primaryReceipt = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(primaryReceipt.statusCode, primaryReceipt.body).toBe(200);
    const primaryDetail = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${firstRichSessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(primaryDetail.statusCode).toBe(200);

    const createdOrganization = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: administratorCookie },
      payload: { name: "Second Rich v1 Organization" },
    });
    expect(createdOrganization.statusCode, createdOrganization.body).toBe(201);
    const secondaryMembershipId = createdOrganization.json().member.id as string;

    const switchedToSecondary = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: administratorCookie },
      payload: { membershipId: secondaryMembershipId },
    });
    expect(switchedToSecondary.statusCode, switchedToSecondary.body).toBe(200);
    expect(switchedToSecondary.json()).toMatchObject({
      organization: { name: "Second Rich v1 Organization" },
      member: { id: secondaryMembershipId, role: "administrator" },
    });

    const secondaryReceipt = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(secondaryReceipt.statusCode, secondaryReceipt.body).toBe(200);
    expect(secondaryReceipt.json().sessionIds).toEqual(primaryReceipt.json().sessionIds);
    expect(secondaryReceipt.json().exampleMemberId).not.toBe(
      primaryReceipt.json().exampleMemberId,
    );
    const secondaryDetail = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${firstRichSessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(secondaryDetail.statusCode).toBe(200);
    expect(secondaryDetail.json().session.id).toBe(primaryDetail.json().session.id);
    expect(secondaryDetail.json().session.owner.memberId).not.toBe(
      primaryDetail.json().session.owner.memberId,
    );
    expect(secondaryDetail.json().timeline[0].reference.syntheticEvidenceId).not.toBe(
      primaryDetail.json().timeline[0].reference.syntheticEvidenceId,
    );
    const primaryMemberHiddenFromSecondary = await app.inject({
      method: "GET",
      url: `/api/v1/organization/activity?includeSeeded=true&memberId=${encodeURIComponent(primaryDetail.json().session.owner.memberId)}`,
      headers: { cookie: administratorCookie },
    });
    expect(primaryMemberHiddenFromSecondary.statusCode).toBe(200);
    expect(primaryMemberHiddenFromSecondary.json().page.total).toBe(0);

    const switchedToPrimary = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: administratorCookie },
      payload: { membershipId: primaryMembershipId },
    });
    expect(switchedToPrimary.statusCode, switchedToPrimary.body).toBe(200);
    const primaryDetailAgain = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${firstRichSessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(primaryDetailAgain.statusCode).toBe(200);
    expect(primaryDetailAgain.json()).toEqual(primaryDetail.json());
    const secondaryMemberHiddenFromPrimary = await app.inject({
      method: "GET",
      url: `/api/v1/organization/activity?includeSeeded=true&memberId=${encodeURIComponent(secondaryDetail.json().session.owner.memberId)}`,
      headers: { cookie: administratorCookie },
    });
    expect(secondaryMemberHiddenFromPrimary.statusCode).toBe(200);
    expect(secondaryMemberHiddenFromPrimary.json().page.total).toBe(0);
  }, 60_000);

  it("keeps the complete Seeded population opt-in in the spawned Analysis CLI", async () => {
    const credential = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: administratorCookie },
      payload: { name: "Rich v1 analyst" },
    });
    expect(credential.statusCode).toBe(201);
    const analysisCredential = credential.json().credential as string;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    const excluded = await runCli(
      ["search", "--query", "schema-drift", "--json", "--server-url", serverUrl],
      analysisCredential,
    );
    expect(excluded).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(excluded.stdout)).toMatchObject({
      syntheticInclusion: "excluded",
      items: [],
      page: { total: 0 },
    });

    const lastPage = await runCli(
      [
        "search",
        "--query",
        "Seeded Example rich-v1",
        "--include-seeded",
        "--page",
        "20",
        "--page-size",
        "25",
        "--json",
        "--server-url",
        serverUrl,
      ],
      analysisCredential,
    );
    expect(lastPage).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(lastPage.stdout)).toMatchObject({
      syntheticInclusion: "included",
      page: { page: 20, pageSize: 25, total: 480, hasMore: false },
      items: expect.arrayContaining([
        expect.objectContaining({
          owner: expect.objectContaining({
            displayName: expect.stringContaining("Example"),
            isExample: true,
          }),
          synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
        }),
      ]),
    });

    const refusedInspect = await runCli(
      ["inspect", firstRichSessionId, "--server-url", serverUrl],
      analysisCredential,
    );
    expect(refusedInspect.exitCode).toBe(2);
    expect(refusedInspect.stderr).toContain("SEEDED_INCLUSION_REQUIRED");

    const inspected = await runCli(
      [
        "inspect",
        firstRichSessionId,
        "--include-seeded",
        "--server-url",
        serverUrl,
      ],
      analysisCredential,
    );
    expect(inspected).toMatchObject({ exitCode: 0, stderr: "" });
    expect(inspected.stdout).toContain("[Seeded] Session");
    expect(inspected.stdout).toContain("· Example [Example member]");
    expect(inspected.stdout).toContain("Example pack: rich-v1 · illustrative only");
  }, 30_000);
});
