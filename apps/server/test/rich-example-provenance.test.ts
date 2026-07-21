import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

const cliPath = fileURLToPath(
  new URL("../../diagnostic-cli/dist/cli.js", import.meta.url),
);
const richExampleSessionId = "seeded-rich-v1-ledger-a11y-00";

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

describe.sequential("provenance-safe rich Example evidence through /api/v1", () => {
  const testDatabase = createTestDatabase("rich_example_provenance");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let administratorCookie: string;

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
        organization: { name: "Rich Example Provenance Lab" },
        administrator: { displayName: "Administrator" },
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    administratorCookie = cookie(bootstrap);
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("returns a rich Seeded timeline without a Device-backed Source-event id", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({
      version: "rich-v1",
      imported: true,
      syntheticDesignation: "seeded",
      sessionIds: expect.arrayContaining([richExampleSessionId]),
    });
    expect(imported.json().sessionIds).toHaveLength(480);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${richExampleSessionId}`,
      headers: { cookie: administratorCookie },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body).toMatchObject({
      session: {
        id: richExampleSessionId,
        owner: { deviceId: null },
        ownerProfile: { displayName: expect.stringContaining("Example"), isExample: true },
        synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
      },
      activities: [
        {
          sourceEventId: null,
          reference: {
            origin: "example_pack_server_controlled",
            examplePackVersion: "rich-v1",
            syntheticEvidenceId: expect.any(String),
          },
        },
      ],
    });
    expect(body.timeline).not.toHaveLength(0);
    for (const event of body.timeline) {
      expect(event).toMatchObject({
        sourceEventId: null,
        reference: {
          origin: "example_pack_server_controlled",
          examplePackVersion: "rich-v1",
          syntheticEvidenceId: expect.any(String),
        },
        evidence: {
          sourceEventIds: [],
          references: [
            {
              origin: "example_pack_server_controlled",
              examplePackVersion: "rich-v1",
              syntheticEvidenceId: expect.any(String),
            },
          ],
        },
      });
    }
    expect(body.turns).toHaveLength(3);
    expect(body.agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "root" }),
        expect.objectContaining({ kind: "subagent" }),
      ]),
    );
    expect(body.evidence).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ outcome: "success" }),
        expect.objectContaining({
          outcome: "unknown",
          result: null,
          durationMs: null,
          evidence: expect.objectContaining({ derivation: "unavailable" }),
        }),
      ]),
      lifecycle: [expect.objectContaining({ kind: "skill" })],
      apiRequests: [expect.objectContaining({ statusCode: 422, success: false })],
      tokenUsage: expect.arrayContaining([
        expect.objectContaining({ model: "gpt-5.6-codex" }),
        expect.objectContaining({
          model: null,
          categories: expect.objectContaining({ total: null }),
        }),
      ]),
      context: {
        limits: [expect.objectContaining({ contextWindow: 128000 })],
        occupancy: [expect.objectContaining({ occupancyTokens: 1_000 })],
        contribution: expect.objectContaining({ status: "unavailable" }),
      },
      costEstimates: expect.arrayContaining([
        expect.objectContaining({ status: "estimated" }),
        expect.objectContaining({
          status: "unavailable",
          amount: null,
          currency: null,
        }),
      ]),
      capabilities: expect.arrayContaining([
        expect.objectContaining({ capability: "explicit_skill_mention" }),
        expect.objectContaining({
          capability: "complete_passive_capability_snapshot",
          state: "unavailable",
        }),
      ]),
    });

    const retainedSourceEventIds: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        if (key === "sourceEventIds" && Array.isArray(nested)) {
          retainedSourceEventIds.push(...nested.filter((id): id is string => typeof id === "string"));
        } else {
          visit(nested);
        }
      }
    };
    visit(body);
    expect(retainedSourceEventIds).toEqual([]);

    const devices = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: administratorCookie },
    });
    expect(devices.statusCode).toBe(200);
    expect(devices.json()).toMatchObject({ devices: [] });

    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/rich-v1/import",
      headers: { cookie: administratorCookie },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({
      version: "rich-v1",
      imported: false,
      exampleMemberId: imported.json().exampleMemberId,
      sessionIds: imported.json().sessionIds,
    });

    const openApi = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(openApi.statusCode).toBe(200);
    expect(
      openApi.json().paths["/api/v1/administration/example-packs/{version}/import"]
        .post.parameters[0].schema.enum,
    ).toContain("rich-v1");
  });

  it("keeps the Seeded Session opt-in and illustrative in the spawned Analysis CLI", async () => {
    const credential = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: administratorCookie },
      payload: { name: "Rich Example analyst" },
    });
    expect(credential.statusCode).toBe(201);
    const analysisCredential = credential.json().credential as string;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    const excluded = await runCli(
      ["search", "--query", "accessibility", "--json", "--server-url", serverUrl],
      analysisCredential,
    );
    expect(excluded).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(excluded.stdout)).toMatchObject({
      syntheticInclusion: "excluded",
      items: [],
      page: { total: 0 },
    });

    const included = await runCli(
      [
        "search",
        "--query",
        "accessibility",
        "--include-seeded",
        "--page-size",
        "100",
        "--json",
        "--server-url",
        serverUrl,
      ],
      analysisCredential,
    );
    expect(included).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(included.stdout)).toMatchObject({
      syntheticInclusion: "included",
      page: { total: 32 },
      items: expect.arrayContaining([
        expect.objectContaining({
          id: richExampleSessionId,
          owner: expect.objectContaining({
            displayName: expect.stringContaining("Example"),
            isExample: true,
          }),
          synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
        }),
      ]),
    });

    const excludedInspect = await runCli(
      ["inspect", richExampleSessionId, "--server-url", serverUrl],
      analysisCredential,
    );
    expect(excludedInspect.exitCode).toBe(2);
    expect(excludedInspect.stderr).toContain("SEEDED_INCLUSION_REQUIRED");

    const inspected = await runCli(
      ["inspect", richExampleSessionId, "--include-seeded", "--server-url", serverUrl],
      analysisCredential,
    );
    expect(inspected).toMatchObject({ exitCode: 0, stderr: "" });
    expect(inspected.stdout).toContain("[Seeded] Session");
    expect(inspected.stdout).toContain("Ada Lovelace · Example [Example member]");
    expect(inspected.stdout).toContain(
      "[Seeded] Turn: example-turn-rich-v1-ledger-a11y-00-00",
    );

    const compared = await runCli(
      [
        "compare",
        richExampleSessionId,
        "--claim",
        "The Example Turns prove a real organizational pattern.",
        "--include-seeded",
        "--json",
        "--server-url",
        serverUrl,
      ],
      analysisCredential,
    );
    expect(compared).toMatchObject({ exitCode: 0, stderr: "" });
    const comparedBody = JSON.parse(compared.stdout);
    expect(comparedBody).toMatchObject({
      population: { distinctRealTurns: 0, seededTurns: 3 },
      syntheticInclusion: "included_for_illustration",
      claim: { classification: "unsupported", status: "refused" },
      citations: expect.arrayContaining([
        expect.objectContaining({ synthetic: "seeded" }),
      ]),
    });

    const citation = comparedBody.citations[0];
    const cited = await runCli(
      [
        "cite",
        `${citation.sessionId}:${citation.turnId}:${citation.activityId}`,
        "--include-seeded",
        "--json",
        "--server-url",
        serverUrl,
      ],
      analysisCredential,
    );
    expect(cited).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(cited.stdout)).toMatchObject({
      citation: { synthetic: "seeded", activityId: citation.activityId },
      activity: {
        sourceEventId: null,
        reference: {
          origin: "example_pack_server_controlled",
          examplePackVersion: "rich-v1",
        },
      },
    });
  });
});
