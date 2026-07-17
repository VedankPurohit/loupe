#!/usr/bin/env node

import {
  ApiErrorSchema,
  ComparisonResponseSchema,
  ExecutionSessionDetailResponseSchema,
  ExamplePackImportResponseSchema,
  OrganizationActivityResponseSchema,
  browserSessionCookieName,
  type AgentRun,
  type ComparisonResponse,
  type ExecutionSessionDetail,
  type Turn,
} from "@workspace/contracts";

const usage = `Usage:
  loupe-diagnostic inspect <session-id> --server-url <url> --browser-session <token>
  loupe-diagnostic search [--query <text>] [--member <id>] [--repository <text>] [--include-seeded] [--page <n>] [--page-size <n>] [--json] --server-url <url> --browser-session <token>
  loupe-diagnostic compare <session-id[:turn-id]>... --claim <statement> [--kind pattern|outcome|causal|productivity] [--include-seeded] [--json] --server-url <url> --browser-session <token>
  loupe-diagnostic examples import starter-v1 --server-url <url> --browser-session <token>

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

async function authenticatedJson(
  endpoint: URL,
  browserSession: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      accept: "application/json",
      cookie: `${browserSessionCookieName}=${browserSession}`,
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(body);
    if (apiError.success) {
      throw new Error(`${apiError.data.error.code}: ${apiError.data.error.message}`);
    }
    throw new Error(`HTTP_${response.status}: Request failed.`);
  }
  return body;
}

function parseServerUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new Error();
    return url;
  } catch {
    throw new UsageError(`Invalid server URL: ${value}`);
  }
}

async function search(args: string[]): Promise<void> {
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;
  let structured = false;
  const query = new URLSearchParams();
  const valueFlags: Record<string, string> = {
    "--query": "q",
    "--member": "memberId",
    "--repository": "repository",
    "--page": "page",
    "--page-size": "pageSize",
    "--outcome": "outcome",
    "--review-status": "reviewStatus",
    "--tag": "tag",
    "--model": "model",
    "--tool": "tool",
    "--capability": "capability",
    "--error": "error",
  };
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]!;
    if (valueFlags[flag]) {
      query.set(valueFlags[flag]!, readValue(args, index, flag));
      index += 1;
    } else if (flag === "--include-seeded") {
      query.set("includeSeeded", "true");
    } else if (flag === "--json") {
      structured = true;
    } else if (flag === "--server-url") {
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
  const endpoint = new URL("/api/v1/organization/activity", parseServerUrl(serverUrl));
  endpoint.search = query.toString();
  const parsed = OrganizationActivityResponseSchema.safeParse(
    await authenticatedJson(endpoint, browserSession),
  );
  if (!parsed.success) {
    throw new Error("INVALID_RESPONSE: Server returned invalid Organization activity.");
  }
  if (structured) {
    process.stdout.write(`${JSON.stringify(parsed.data, null, 2)}\n`);
    return;
  }
  const lines = [
    `Organization activity (${parsed.data.page.total})`,
    `Seeded examples: ${parsed.data.syntheticInclusion}`,
    `Page ${parsed.data.page.page}; page size ${parsed.data.page.pageSize}`,
    ...parsed.data.items.flatMap((item) => [
      "",
      `${item.synthetic.kind === "seeded" ? "[Seeded] " : ""}${item.id}`,
      `  Owner: ${item.owner.displayName}${item.owner.isExample ? " [Example]" : ""}`,
      `  Repository: ${item.repository.remoteIdentity ?? item.repository.repositoryRoot ?? "unavailable"}`,
      `  Activity: ${item.activityState}; outcome ${item.annotations.outcome}; review ${item.annotations.reviewStatus}`,
      `  Tags: ${item.annotations.tags.join(", ") || "none"}`,
      `  Deep link: ${new URL(item.deepLink, serverUrl).toString()}`,
    ]),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function comparisonLabel(value: ComparisonResponse["claim"]["classification"]) {
  return value
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

async function compare(args: string[]): Promise<void> {
  const selectionArguments: string[] = [];
  let index = 1;
  while (index < args.length && !args[index]!.startsWith("--")) {
    selectionArguments.push(args[index]!);
    index += 1;
  }
  if (!selectionArguments.length) {
    throw new UsageError("The compare command requires at least one Session or Turn selection.");
  }
  const selections = selectionArguments.map((value) => {
    const separator = value.indexOf(":");
    if (separator < 0) return { scope: "session" as const, sessionId: value };
    const sessionId = value.slice(0, separator);
    const turnId = value.slice(separator + 1);
    if (!sessionId || !turnId) {
      throw new UsageError(`Invalid comparison selection: ${value}`);
    }
    return { scope: "turn" as const, sessionId, turnId };
  });
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;
  let includeSeeded = false;
  let structured = false;
  let statement: string | undefined;
  let kind: "pattern" | "outcome" | "causal" | "productivity" = "pattern";
  const filters: Record<string, string> = {};
  const signals: string[] = [];
  for (; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--claim") {
      statement = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--kind") {
      const value = readValue(args, index, flag);
      if (!["pattern", "outcome", "causal", "productivity"].includes(value)) {
        throw new UsageError(`Invalid claim kind: ${value}`);
      }
      kind = value as typeof kind;
      index += 1;
    } else if (flag === "--signals") {
      signals.push(
        ...readValue(args, index, flag)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      index += 1;
    } else if (flag === "--repository") {
      filters.repository = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--include-seeded") {
      includeSeeded = true;
    } else if (flag === "--json") {
      structured = true;
    } else if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--browser-session") {
      browserSession = readValue(args, index, flag);
      index += 1;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!statement) throw new UsageError("The compare command requires --claim.");
  if (!browserSession) {
    throw new UsageError(
      "A browser Session is required via --browser-session or LOUPE_BROWSER_SESSION.",
    );
  }
  const endpoint = new URL("/api/v1/comparisons", parseServerUrl(serverUrl));
  const parsed = ComparisonResponseSchema.safeParse(
    await authenticatedJson(endpoint, browserSession, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selections,
        filters,
        includeSeeded,
        claim: { kind, statement, signals },
      }),
    }),
  );
  if (!parsed.success) {
    throw new Error("INVALID_RESPONSE: Server returned invalid comparison data.");
  }
  if (structured) {
    process.stdout.write(`${JSON.stringify(parsed.data, null, 2)}\n`);
    return;
  }
  const { claim, population, completeness } = parsed.data;
  const lines = [
    `Comparison: ${comparisonLabel(claim.classification)}`,
    `Claim status: ${claim.status}`,
    `Population: ${population.selectedSessions} Sessions; ${population.selectedTurns} Turns`,
    `Real Turns: ${population.distinctRealTurns}; Seeded Turns: ${population.seededTurns}`,
    `Completeness: ${completeness.status} (${completeness.resolved}/${completeness.selected} selections resolved)`,
    ...(claim.refusal
      ? [`Refusal: ${claim.refusal.code} — ${claim.refusal.message}`]
      : []),
    ...claim.caveats.map((caveat) => `Caveat: ${caveat}`),
    "Citations:",
    ...parsed.data.citations.map(
      (citation) =>
        `  ${citation.synthetic === "seeded" ? "[Seeded] " : ""}${citation.sessionId}/${citation.turnId}: ${new URL(citation.links.browser, serverUrl).toString()}`,
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function importExamples(args: string[]): Promise<void> {
  if (args[1] !== "import" || args[2] !== "starter-v1") {
    throw new UsageError("Expected examples import starter-v1.");
  }
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;
  for (let index = 3; index < args.length; index += 1) {
    const flag = args[index]!;
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
  const endpoint = new URL(
    "/api/v1/administration/example-packs/starter-v1/import",
    parseServerUrl(serverUrl),
  );
  const parsed = ExamplePackImportResponseSchema.safeParse(
    await authenticatedJson(endpoint, browserSession, { method: "POST" }),
  );
  if (!parsed.success) {
    throw new Error("INVALID_RESPONSE: Server returned invalid Example-pack data.");
  }
  process.stdout.write(
    `${parsed.data.imported ? "Imported" : "Already imported"} ${parsed.data.version}: ${parsed.data.sessionIds.join(", ")} [Seeded]\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  try {
    if (args[0] === "search") {
      await search(args);
    } else if (args[0] === "compare") {
      await compare(args);
    } else if (args[0] === "examples") {
      await importExamples(args);
    } else {
      const options = parseInspectOptions(args);
      await inspect(options);
    }
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
