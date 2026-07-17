#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  AnalysisCredentialCreateResponseSchema,
  AnalysisCredentialsResponseSchema,
  ApiErrorSchema,
  CandidateSubmissionRequestSchema,
  CandidateSubmissionResponseSchema,
  CitationActivityTargetResponseSchema,
  CitationTurnTargetResponseSchema,
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
  loupe-diagnostic inspect <session-id> [--json] --server-url <url> --analysis-credential <token>
  loupe-diagnostic search [--query <text>] [--member <id>] [--repository <text>] [--include-seeded] [--page <n>] [--page-size <n>] [--json] --server-url <url> --analysis-credential <token>
  loupe-diagnostic compare <session-id[:turn-id]>... --claim <statement> [--kind pattern|outcome|causal|productivity] [--include-seeded] [--json] --server-url <url> --analysis-credential <token>
  loupe-diagnostic cite <session-id:turn-id:activity-id> [--json] --server-url <url> --analysis-credential <token>
  loupe-diagnostic candidate submit <manifest.json> [--json] --server-url <url> --analysis-credential <token>
  loupe-diagnostic watch [--max-events <n>] [--json] --server-url <url> --analysis-credential <token>
  loupe-diagnostic credential create --name <label> [--json] --server-url <url> --browser-session <token>
  loupe-diagnostic credential list [--json] --server-url <url> --browser-session <token>
  loupe-diagnostic credential revoke <credential-id> --server-url <url> --browser-session <token>
  loupe-diagnostic examples import starter-v1 --server-url <url> --browser-session <token>

Environment alternatives:
  LOUPE_SERVER_URL       Server base URL (default: http://127.0.0.1:3000)
  LOUPE_ANALYSIS_CREDENTIAL  Revocable Analysis credential
  LOUPE_BROWSER_SESSION  Value of the browser_session cookie`;

interface Authentication {
  analysisCredential?: string;
  browserSession?: string;
}

interface InspectOptions {
  sessionId: string;
  serverUrl: URL;
  authentication: Authentication;
  structured: boolean;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value.`);
  }
  return value;
}

class UsageError extends Error {}

class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseInspectOptions(args: string[]): InspectOptions {
  if (args[0] !== "inspect" || !args[1] || args[1].startsWith("--")) {
    throw new UsageError("Expected the inspect command and a Session id.");
  }

  const sessionId = args[1];
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;
  let analysisCredential = process.env.LOUPE_ANALYSIS_CREDENTIAL;
  let structured = false;

  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--browser-session") {
      browserSession = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--analysis-credential") {
      analysisCredential = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--json") {
      structured = true;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }

  if (!browserSession && !analysisCredential) {
    throw new UsageError(
      "An Analysis credential is required via --analysis-credential or LOUPE_ANALYSIS_CREDENTIAL.",
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

  return {
    sessionId,
    serverUrl: parsedServerUrl,
    authentication: { analysisCredential, browserSession },
    structured,
  };
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
      ...(options.authentication.analysisCredential
        ? { authorization: `Bearer ${options.authentication.analysisCredential}` }
        : {
            cookie: `${browserSessionCookieName}=${options.authentication.browserSession}`,
          }),
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(body);
    if (apiError.success) {
      throw new ApiRequestError(
        apiError.data.error.code,
        `${apiError.data.error.code}: ${apiError.data.error.message}`,
      );
    }
    throw new Error(`HTTP_${response.status}: Session inspection failed.`);
  }

  const parsed = ExecutionSessionDetailResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("INVALID_RESPONSE: Server returned an invalid Session detail.");
  }
  process.stdout.write(
    options.structured
      ? `${JSON.stringify(parsed.data, null, 2)}\n`
      : formatDetail(parsed.data),
  );
}

async function authenticatedJson(
  endpoint: URL,
  authentication: Authentication,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      accept: "application/json",
      ...(authentication.analysisCredential
        ? { authorization: `Bearer ${authentication.analysisCredential}` }
        : { cookie: `${browserSessionCookieName}=${authentication.browserSession}` }),
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(body);
    if (apiError.success) {
      throw new ApiRequestError(
        apiError.data.error.code,
        apiError.data.error.message,
      );
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
  let analysisCredential = process.env.LOUPE_ANALYSIS_CREDENTIAL;
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
    } else if (flag === "--analysis-credential") {
      analysisCredential = readValue(args, index, flag);
      index += 1;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!browserSession && !analysisCredential) {
    throw new UsageError(
      "An Analysis credential is required via --analysis-credential or LOUPE_ANALYSIS_CREDENTIAL.",
    );
  }
  const endpoint = new URL("/api/v1/organization/activity", parseServerUrl(serverUrl));
  endpoint.search = query.toString();
  const parsed = OrganizationActivityResponseSchema.safeParse(
    await authenticatedJson(endpoint, { analysisCredential, browserSession }),
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
  let analysisCredential = process.env.LOUPE_ANALYSIS_CREDENTIAL;
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
    } else if (flag === "--analysis-credential") {
      analysisCredential = readValue(args, index, flag);
      index += 1;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!statement) throw new UsageError("The compare command requires --claim.");
  if (!browserSession && !analysisCredential) {
    throw new UsageError(
      "An Analysis credential is required via --analysis-credential or LOUPE_ANALYSIS_CREDENTIAL.",
    );
  }
  const endpoint = new URL("/api/v1/comparisons", parseServerUrl(serverUrl));
  const parsed = ComparisonResponseSchema.safeParse(
    await authenticatedJson(endpoint, { analysisCredential, browserSession }, {
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

async function cite(args: string[]): Promise<void> {
  const selection = args[1];
  if (!selection || selection.startsWith("--")) {
    throw new UsageError("The cite command requires session-id:turn-id:activity-id.");
  }
  const parts = selection.split(":");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new UsageError(`Invalid citation selection: ${selection}`);
  }
  const [sessionId, turnId, activityId] = parts as [string, string, string];
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;
  let analysisCredential = process.env.LOUPE_ANALYSIS_CREDENTIAL;
  let structured = false;
  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--browser-session") {
      browserSession = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--analysis-credential") {
      analysisCredential = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--json") {
      structured = true;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!browserSession && !analysisCredential) {
    throw new UsageError(
      "An Analysis credential is required via --analysis-credential or LOUPE_ANALYSIS_CREDENTIAL.",
    );
  }
  const baseUrl = parseServerUrl(serverUrl);
  const authentication = { analysisCredential, browserSession };
  const encodedSession = encodeURIComponent(sessionId);
  const encodedTurn = encodeURIComponent(turnId);
  const encodedActivity = encodeURIComponent(activityId);
  const [turnResult, activityResult] = await Promise.all([
    authenticatedJson(
      new URL(`/api/v1/sessions/${encodedSession}/turns/${encodedTurn}`, baseUrl),
      authentication,
    ),
    authenticatedJson(
      new URL(
        `/api/v1/sessions/${encodedSession}/activity/${encodedActivity}`,
        baseUrl,
      ),
      authentication,
    ),
  ]);
  const turn = CitationTurnTargetResponseSchema.safeParse(turnResult);
  const activity = CitationActivityTargetResponseSchema.safeParse(activityResult);
  if (!turn.success || !activity.success || activity.data.turnId !== turnId) {
    throw new Error("INVALID_RESPONSE: Server returned an invalid Evidence citation.");
  }
  const result = {
    citation: {
      sessionId,
      turnId,
      activityId,
      synthetic: turn.data.session.synthetic.kind,
      fidelity: activity.data.activity.evidence,
      links: {
        session: new URL(`/api/v1/sessions/${encodedSession}`, baseUrl).toString(),
        turn: new URL(
          `/api/v1/sessions/${encodedSession}/turns/${encodedTurn}`,
          baseUrl,
        ).toString(),
        activity: new URL(
          `/api/v1/sessions/${encodedSession}/activity/${encodedActivity}`,
          baseUrl,
        ).toString(),
        browser: new URL(
          `/?session=${encodedSession}&turn=${encodedTurn}&activity=${encodedActivity}`,
          baseUrl,
        ).toString(),
      },
    },
    turn: turn.data.turn,
    activity: activity.data.activity,
  };
  if (structured) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `Citation: ${sessionId}/${turnId}/${activityId}`,
      `Synthetic: ${result.citation.synthetic}`,
      `Fidelity: ${evidenceStrength(result.citation.fidelity)}`,
      `Browser: ${result.citation.links.browser}`,
    ].join("\n") + "\n",
  );
}

async function submitCandidate(args: string[]): Promise<void> {
  if (args[1] !== "submit" || !args[2] || args[2]!.startsWith("--")) {
    throw new UsageError("Expected candidate submit <manifest.json>.");
  }
  const manifestPath = args[2]!;
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let analysisCredential = process.env.LOUPE_ANALYSIS_CREDENTIAL;
  let structured = false;
  for (let index = 3; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--analysis-credential") {
      analysisCredential = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--json") {
      structured = true;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!analysisCredential) {
    throw new UsageError(
      "An Analysis credential is required via --analysis-credential or LOUPE_ANALYSIS_CREDENTIAL.",
    );
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
      throw new UsageError(`Candidate manifest is not readable JSON: ${manifestPath}`);
  }
  if (
    typeof manifest === "object" &&
    manifest !== null &&
    !("artifactHash" in manifest) &&
    "package" in manifest &&
    typeof manifest.package === "object" &&
    manifest.package !== null &&
    "files" in manifest.package &&
    Array.isArray(manifest.package.files)
  ) {
    const files = [...manifest.package.files].sort((left, right) => {
      const leftPath =
        typeof left === "object" && left !== null && "path" in left
          ? String(left.path)
          : "";
      const rightPath =
        typeof right === "object" && right !== null && "path" in right
          ? String(right.path)
          : "";
      return leftPath.localeCompare(rightPath);
    });
    manifest = {
      ...manifest,
      package: { files },
      artifactHash: `sha256:${createHash("sha256")
        .update(JSON.stringify({ files }))
        .digest("hex")}`,
    };
  }
  const request = CandidateSubmissionRequestSchema.safeParse(manifest);
  if (!request.success) {
    throw new UsageError(
      "Candidate manifest is incomplete or does not match the submission contract.",
    );
  }
  const parsed = CandidateSubmissionResponseSchema.safeParse(
    await authenticatedJson(
      new URL("/api/v1/candidates", parseServerUrl(serverUrl)),
      { analysisCredential },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.data),
      },
    ),
  );
  if (!parsed.success) {
    throw new Error("INVALID_RESPONSE: Server returned invalid Candidate data.");
  }
  if (structured) {
    process.stdout.write(`${JSON.stringify(parsed.data, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `Candidate: ${parsed.data.candidate.name}`,
      `Version: ${parsed.data.version.version} (immutable)`,
      `Artifact hash: ${parsed.data.version.artifactHash}`,
      `Status: ${parsed.data.candidate.status}`,
      `Review: ${new URL(parsed.data.candidate.deepLink, serverUrl).toString()}`,
    ].join("\n") + "\n",
  );
}

async function watch(args: string[]): Promise<void> {
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let analysisCredential = process.env.LOUPE_ANALYSIS_CREDENTIAL;
  let structured = false;
  let maxEvents = Number.POSITIVE_INFINITY;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--analysis-credential") {
      analysisCredential = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--max-events") {
      maxEvents = Number(readValue(args, index, flag));
      if (!Number.isInteger(maxEvents) || maxEvents < 1) {
        throw new UsageError("--max-events must be a positive integer.");
      }
      index += 1;
    } else if (flag === "--json") {
      structured = true;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!analysisCredential) {
    throw new UsageError(
      "An Analysis credential is required via --analysis-credential or LOUPE_ANALYSIS_CREDENTIAL.",
    );
  }
  const response = await fetch(
    new URL("/api/v1/live", parseServerUrl(serverUrl)),
    {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${analysisCredential}`,
      },
    },
  );
  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => undefined);
    const apiError = ApiErrorSchema.safeParse(body);
    if (apiError.success) {
      throw new ApiRequestError(
        apiError.data.error.code,
        apiError.data.error.message,
      );
    }
    throw new Error(`HTTP_${response.status}: Watch failed.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seen = 0;
  while (seen < maxEvents) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0 && seen < maxEvents) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data) {
        const event = JSON.parse(data) as {
          sequence: number;
          type: string;
          sessionId: string;
          occurredAt: string;
        };
        seen += 1;
        process.stdout.write(
          structured
            ? `${JSON.stringify(event)}\n`
            : `${event.type} #${event.sequence}: ${event.sessionId} at ${event.occurredAt}\n`,
        );
      }
      separator = buffer.indexOf("\n\n");
    }
  }
  await reader.cancel();
}

async function manageCredential(args: string[]): Promise<void> {
  const action = args[1];
  if (!action || !["create", "list", "revoke"].includes(action)) {
    throw new UsageError("Expected credential create, list, or revoke.");
  }
  let serverUrl = process.env.LOUPE_SERVER_URL ?? "http://127.0.0.1:3000";
  let browserSession = process.env.LOUPE_BROWSER_SESSION;
  let structured = false;
  let name: string | undefined;
  const credentialId = action === "revoke" ? args[2] : undefined;
  let index = action === "revoke" ? 3 : 2;
  for (; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--server-url") {
      serverUrl = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--browser-session") {
      browserSession = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--name") {
      name = readValue(args, index, flag);
      index += 1;
    } else if (flag === "--json") {
      structured = true;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  if (!browserSession) {
    throw new UsageError(
      "A browser Session is required via --browser-session or LOUPE_BROWSER_SESSION.",
    );
  }
  const endpoint = new URL("/api/v1/analysis-credentials", parseServerUrl(serverUrl));
  if (action === "create") {
    if (!name) throw new UsageError("credential create requires --name.");
    const parsed = AnalysisCredentialCreateResponseSchema.safeParse(
      await authenticatedJson(
        endpoint,
        { browserSession },
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        },
      ),
    );
    if (!parsed.success) throw new Error("INVALID_RESPONSE: Invalid credential data.");
    process.stdout.write(
      structured
        ? `${JSON.stringify(parsed.data, null, 2)}\n`
        : `Analysis credential ${parsed.data.analysisCredential.id}\n${parsed.data.credential}\n`,
    );
    return;
  }
  if (action === "list") {
    const parsed = AnalysisCredentialsResponseSchema.safeParse(
      await authenticatedJson(endpoint, { browserSession }),
    );
    if (!parsed.success) throw new Error("INVALID_RESPONSE: Invalid credential data.");
    process.stdout.write(
      structured
        ? `${JSON.stringify(parsed.data, null, 2)}\n`
        : parsed.data.analysisCredentials
            .map(
              (credential) =>
                `${credential.id}  ${credential.name}  ${credential.revokedAt ? "revoked" : "active"}`,
            )
            .join("\n") + "\n",
    );
    return;
  }
  if (!credentialId) throw new UsageError("credential revoke requires an id.");
  await authenticatedJson(
    new URL(
      `/api/v1/analysis-credentials/${encodeURIComponent(credentialId)}/revoke`,
      parseServerUrl(serverUrl),
    ),
    { browserSession },
    { method: "POST" },
  );
  process.stdout.write(
    structured
      ? `${JSON.stringify({ id: credentialId, revoked: true })}\n`
      : `Revoked Analysis credential ${credentialId}.\n`,
  );
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
    await authenticatedJson(endpoint, { browserSession }, { method: "POST" }),
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
    } else if (args[0] === "cite") {
      await cite(args);
    } else if (args[0] === "candidate") {
      await submitCandidate(args);
    } else if (args[0] === "watch") {
      await watch(args);
    } else if (args[0] === "credential") {
      await manageCredential(args);
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
    if (args.includes("--json") && error instanceof ApiRequestError) {
      process.stderr.write(
        `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`,
      );
    } else {
      const message = error instanceof Error ? error.message : "Unknown CLI error.";
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}

await main();
