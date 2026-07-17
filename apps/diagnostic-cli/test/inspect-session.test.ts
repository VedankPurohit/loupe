import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

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

describe("spawned diagnostic CLI", () => {
  it("inspects the canonical Session through /api/v1 and exposes execution evidence", async () => {
    let requestedUrl: string | undefined;
    let requestedCookie: string | undefined;
    const server = createServer((request, response) => {
      requestedUrl = request.url;
      requestedCookie = request.headers.cookie;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          session: {
            id: "session-real-001",
            owner: {
              memberId: "11111111-1111-4111-8111-111111111111",
              deviceId: "22222222-2222-4222-8222-222222222222",
            },
            ownerProfile: { displayName: "Real Member", isExample: false },
            gitContext: null,
            firstObservedAt: "2026-07-17T08:00:00.000Z",
            lastObservedAt: "2026-07-17T08:04:00.000Z",
            activityState: "resumed",
            completion: { status: "not_assumed", evidence: "unavailable" },
            rootAgentRunId: "root-thread-001",
            projectionVersion: "1",
            ownershipReconciliation: {
              inputs: [],
              rule: "first delivering device establishes ownership",
              selectedValue: "11111111-1111-4111-8111-111111111111",
              confidence: "high",
            },
            annotations: {
              outcome: "unknown",
              reviewStatus: "ordinary",
              tags: [],
              updatedAt: null,
            },
            synthetic: { kind: "real", examplePackVersion: null },
            deepLink: "/?session=session-real-001",
          },
          activities: [
            {
              id: "activity-001",
              source: "startup",
              state: "idle",
              startedAt: "2026-07-17T08:00:00.000Z",
              endedAt: "2026-07-17T08:01:00.000Z",
              sourceEventId: "33333333-3333-4333-8333-333333333333",
            },
            {
              id: "activity-002",
              source: "resume",
              state: "resumed",
              startedAt: "2026-07-17T08:03:00.000Z",
              endedAt: null,
              sourceEventId: "44444444-4444-4444-8444-444444444444",
            },
          ],
          turns: [
            {
              id: "turn-probe-001",
              agentRunId: "root-thread-001",
              firstObservedAt: "2026-07-17T08:00:10.000Z",
              lastObservedAt: "2026-07-17T08:00:20.000Z",
              evidence: {
                stability: ["documented", "observed"],
                derivation: "exact",
                sourceEventIds: ["55555555-5555-4555-8555-555555555555"],
              },
            },
          ],
          agentRuns: [
            {
              id: "root-thread-001",
              kind: "root",
              codexThreadId: "root-thread-001",
              agentType: "default",
              firstObservedAt: "2026-07-17T08:00:00.000Z",
              lastObservedAt: "2026-07-17T08:04:00.000Z",
              identityEvidence: {
                stability: ["documented", "observed"],
                derivation: "exact",
                sourceEventIds: ["66666666-6666-4666-8666-666666666666"],
              },
              parentEdge: null,
            },
            {
              id: "child-thread-001",
              kind: "subagent",
              codexThreadId: "child-thread-001",
              agentType: "worker",
              firstObservedAt: "2026-07-17T08:00:30.000Z",
              lastObservedAt: "2026-07-17T08:00:50.000Z",
              identityEvidence: {
                stability: ["observed", "unstable"],
                derivation: "exact",
                sourceEventIds: ["77777777-7777-4777-8777-777777777777"],
              },
              parentEdge: {
                status: "unresolved",
                parentAgentRunId: null,
                reconciliation: {
                  inputs: [],
                  rule: "no defensible parent observation",
                  selectedValue: null,
                  confidence: "none",
                },
              },
            },
          ],
          timeline: [],
          evidence: {
            tools: [],
            lifecycle: [],
            tokenUsage: [],
            context: {
              limits: [],
              occupancy: [],
              firstRequestBaseline: null,
              contribution: {
                status: "unavailable",
                method: "no_stable_passive_per_item_context_contract",
                note: "Unavailable from captured evidence.",
                evidence: {
                  stability: ["unavailable"],
                  derivation: "unavailable",
                  sourceEventIds: [],
                },
              },
            },
            costEstimates: [],
            capabilities: [],
          },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");

    const result = await runCli([
      "inspect",
      "session-real-001",
      "--server-url",
      `http://127.0.0.1:${address.port}`,
      "--browser-session",
      "test-session-token",
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(requestedUrl).toBe("/api/v1/sessions/session-real-001");
    expect(requestedCookie).toBe("browser_session=test-session-token");
    expect(result.stdout).toContain("Session: session-real-001");
    expect(result.stdout).toContain("Activity state: resumed");
    expect(result.stdout).toContain("Activity episodes (2)");
    expect(result.stdout).toContain("Turn: turn-probe-001");
    expect(result.stdout).toContain("Root agent run: root-thread-001");
    expect(result.stdout).toContain("Subagent run: child-thread-001");
    expect(result.stdout).toContain(
      "Evidence strength: documented, observed; exact",
    );
    expect(result.stdout).toContain("Parent: unresolved");
    expect(result.stdout).toContain("no defensible parent observation; confidence none");
  });
});
