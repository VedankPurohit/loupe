#!/usr/bin/env node

import {
  ApiErrorSchema,
  ExecutionSessionDetailResponseSchema,
  browserSessionCookieName,
  type AgentRun,
  type ExecutionSessionDetail,
  type Turn,
} from "@workspace/contracts";

const usage = `Usage:
  loupe-diagnostic inspect <session-id> --server-url <url> --browser-session <token>

Environment alternatives:
  LOUPE_SERVER_URL       Server base URL (default: http://127.0.0.1:3000)
  LOUPE_BROWSER_SESSION  Value of the browser_session cookie`;

interface InspectOptions {
  sessionId: string;
  serverUrl: URL;
  browserSession: string;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value.`);
  }
  return value;
}

class UsageError extends Error {}

function parseInspectOptions(args: string[]): InspectOptions {
  if (args[0] !== "inspect" || !args[1] || args[1].startsWith("--")) {
    throw new UsageError("Expected the inspect command and a Session id.");
  }

  const sessionId = args[1];
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;

  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--browser-session") {
      browserSession = readValue(args, index, flag);
      index += 1;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }

  if (!browserSession) {
    throw new UsageError(
      "A browser Session is required via --browser-session or LOUPE_BROWSER_SESSION.",
    );
  }

  let parsedServerUrl: URL;
  try {
    parsedServerUrl = new URL(serverUrl);
  } catch {
    throw new UsageError(`Invalid server URL: ${serverUrl}`);
  }
  if (!(["http:", "https:"] as string[]).includes(parsedServerUrl.protocol)) {
    throw new UsageError("The server URL must use http or https.");
  }

  return { sessionId, serverUrl: parsedServerUrl, browserSession };
}

function evidenceStrength(evidence: Turn["evidence"]): string {
  const stability = evidence.stability.length
    ? evidence.stability.join(", ")
    : "unavailable";
  return `${stability}; ${evidence.derivation}`;
}

function formatAgentRun(run: AgentRun, label: string): string[] {
  const lines = [
    `${label}: ${run.id}`,
    `  Codex thread: ${run.codexThreadId ?? "unavailable"}`,
    `  Agent type: ${run.agentType ?? "unavailable"}`,
    `  Evidence strength: ${evidenceStrength(run.identityEvidence)}`,
  ];
  if (run.parentEdge) {
    const parent =
      run.parentEdge.parentAgentRunId === null
        ? run.parentEdge.status
        : `${run.parentEdge.status} (${run.parentEdge.parentAgentRunId})`;
    lines.push(`  Parent: ${parent}`);
    lines.push(
      `  Parent reconciliation: ${run.parentEdge.reconciliation.rule}; confidence ${run.parentEdge.reconciliation.confidence}`,
    );
  }
  return lines;
}

function formatDetail(detail: ExecutionSessionDetail): string {
  const { session } = detail;
  const root = detail.agentRuns.find(
    (run) => run.id === session.rootAgentRunId && run.kind === "root",
  );
  const subagents = detail.agentRuns.filter((run) => run.kind === "subagent");
  const lines = [
    `Session: ${session.id}`,
    `Activity state: ${session.activityState}`,
    `Observed: ${session.firstObservedAt} to ${session.lastObservedAt}`,
    `Completion: ${session.completion.status}; evidence ${session.completion.evidence}`,
    `Projection version: ${session.projectionVersion}`,
    `Ownership confidence: ${session.ownershipReconciliation.confidence}`,
    "",
    `Activity episodes (${detail.activities.length})`,
    ...detail.activities.flatMap((activity) => [
      `Activity: ${activity.id}`,
      `  State: ${activity.state}; source ${activity.source}`,
      `  Observed: ${activity.startedAt} to ${activity.endedAt ?? "active"}`,
    ]),
    "",
    `Turns (${detail.turns.length})`,
    ...detail.turns.flatMap((turn) => [
      `Turn: ${turn.id}`,
      `  Agent run: ${turn.agentRunId}`,
      `  Evidence strength: ${evidenceStrength(turn.evidence)}`,
      `  Observed: ${turn.firstObservedAt} to ${turn.lastObservedAt}`,
    ]),
    "",
    ...(root
      ? formatAgentRun(root, "Root agent run")
      : [`Root agent run: unavailable (${session.rootAgentRunId})`]),
    "",
    `Subagent runs (${subagents.length})`,
    ...subagents.flatMap((run) => formatAgentRun(run, "Subagent run")),
  ];
  return `${lines.join("\n")}\n`;
}

async function inspect(options: InspectOptions): Promise<void> {
  const endpoint = new URL(
    `/api/v1/sessions/${encodeURIComponent(options.sessionId)}`,
    options.serverUrl,
  );
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      cookie: `${browserSessionCookieName}=${options.browserSession}`,
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(body);
    if (apiError.success) {
      throw new Error(
        `${apiError.data.error.code}: ${apiError.data.error.message}`,
      );
    }
    throw new Error(`HTTP_${response.status}: Session inspection failed.`);
  }

  const parsed = ExecutionSessionDetailResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("INVALID_RESPONSE: Server returned an invalid Session detail.");
  }
  process.stdout.write(formatDetail(parsed.data));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  try {
    const options = parseInspectOptions(args);
    await inspect(options);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${usage}\n`);
      process.exitCode = 2;
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown CLI error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

await main();
