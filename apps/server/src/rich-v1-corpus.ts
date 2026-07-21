import { createHash } from "node:crypto";

import type { GitContextObservation } from "@workspace/contracts";

import {
  richExamplePackVersion,
  stableExampleUuid,
  type RichExampleEvidence,
  type RichExampleEvidenceReference,
  type RichExampleRecord,
  type RichExampleRecordKind,
} from "./rich-example-pack.js";

export const richV1ExpectedCounts = {
  members: 12,
  sessions: 480,
  turns: 1_088,
  agentRuns: 864,
  detailRecords: 3_104,
} as const;

const exampleMembers = [
  ["Ada Lovelace · Example", ["ledger-ui", "docs-site"]],
  ["Alan Turing · Example", ["telemetry-pipeline", "agent-toolkit"]],
  ["Grace Hopper · Example", ["oauth-gateway", "release-automation"]],
  ["Katherine Johnson · Example", ["telemetry-pipeline", "ledger-ui"]],
  ["Margaret Hamilton · Example", ["release-automation", "agent-toolkit"]],
  ["Hedy Lamarr · Example", ["docs-site", null]],
  ["Marie Curie · Example", ["event-lake", "quality-gates"]],
  ["Chien-Shiung Wu · Example", ["agent-toolkit", "quality-gates"]],
  ["Srinivasa Ramanujan · Example", ["ledger-ui", "event-lake"]],
  ["George Washington Carver · Example", ["docs-site", "installer"]],
  ["Frida Kahlo · Example", ["ledger-ui", "design-tokens"]],
  ["Leonardo da Vinci · Example", ["oauth-gateway", "integration-lab"]],
] as const;

type ActivityState = "live" | "idle" | "resumed";
type Outcome = "successful" | "partial" | "failed" | "unknown";
type ReviewStatus = "exemplar" | "needs_help" | "ordinary";
type DetailFamily =
  | "tool"
  | "lifecycle"
  | "api_request"
  | "token_usage"
  | "context_limit"
  | "context_occupancy"
  | "cost_estimate"
  | "capability";
type ScenarioTraits = {
  toolSequence?: "approval_requested_then_approved" | "failure_then_success";
  apiSequence?: "rate_limit_then_unknown";
  parentConflict?: "two_exact_unresolved";
  parentAssociation?: "inferred";
  gitRemote?: "unavailable";
  gitState?: "not_repository";
  modelTier?: "unknown";
  lifecycleSequence?: "compaction_then_resume";
  capabilitySequence?: "mcp_observed_then_snapshot_unavailable";
  costGap?: "unknown_price_mapping";
  timelineState?: "duplicate_event_retained";
};

const scenarios: ReadonlyArray<{
  slug: string;
  turns: number;
  agentRuns: number;
  activityState: ActivityState;
  outcome: Outcome;
  reviewStatus: ReviewStatus;
  tags: readonly string[];
  detailFamilies: readonly DetailFamily[];
  traits?: ScenarioTraits;
}> = [
  { slug: "ledger-a11y", turns: 3, agentRuns: 3, activityState: "idle", outcome: "successful", reviewStatus: "exemplar", tags: ["accessibility", "reviewed"], detailFamilies: ["tool", "token_usage", "context_limit", "capability"] },
  { slug: "ledger-empty-state", turns: 2, agentRuns: 1, activityState: "resumed", outcome: "partial", reviewStatus: "needs_help", tags: ["empty-state", "ux"], detailFamilies: ["tool", "token_usage", "capability"], traits: { modelTier: "unknown" } },
  { slug: "docs-guide", turns: 2, agentRuns: 1, activityState: "idle", outcome: "successful", reviewStatus: "ordinary", tags: ["documentation"], detailFamilies: ["tool", "lifecycle", "token_usage", "capability"], traits: { costGap: "unknown_price_mapping" } },
  { slug: "telemetry-schema-drift", turns: 3, agentRuns: 2, activityState: "idle", outcome: "failed", reviewStatus: "needs_help", tags: ["adapter", "schema-drift"], detailFamilies: ["tool", "api_request", "token_usage", "capability"], traits: { parentAssociation: "inferred" } },
  { slug: "telemetry-backfill", turns: 2, agentRuns: 2, activityState: "resumed", outcome: "successful", reviewStatus: "exemplar", tags: ["migration", "reconciliation"], detailFamilies: ["tool", "lifecycle", "token_usage", "cost_estimate"], traits: { lifecycleSequence: "compaction_then_resume" } },
  { slug: "agent-capabilities", turns: 2, agentRuns: 3, activityState: "live", outcome: "unknown", reviewStatus: "ordinary", tags: ["mcp", "capabilities"], detailFamilies: ["tool", "lifecycle", "capability"], traits: { capabilitySequence: "mcp_observed_then_snapshot_unavailable" } },
  { slug: "oauth-local-callback", turns: 2, agentRuns: 2, activityState: "idle", outcome: "successful", reviewStatus: "exemplar", tags: ["oauth", "local"], detailFamilies: ["tool", "api_request", "context_occupancy", "capability"], traits: { toolSequence: "approval_requested_then_approved" } },
  { slug: "oauth-membership-boundary", turns: 2, agentRuns: 1, activityState: "idle", outcome: "failed", reviewStatus: "needs_help", tags: ["authorization", "invite"], detailFamilies: ["tool", "api_request", "capability"] },
  { slug: "release-rollback", turns: 3, agentRuns: 2, activityState: "resumed", outcome: "partial", reviewStatus: "ordinary", tags: ["release", "rollback"], detailFamilies: ["tool", "lifecycle", "token_usage", "cost_estimate"], traits: { toolSequence: "failure_then_success" } },
  { slug: "integrity-duplicate-event", turns: 2, agentRuns: 2, activityState: "idle", outcome: "successful", reviewStatus: "exemplar", tags: ["idempotency", "delivery"], detailFamilies: ["tool", "api_request", "token_usage"], traits: { timelineState: "duplicate_event_retained" } },
  { slug: "ledger-filter-gaps", turns: 2, agentRuns: 1, activityState: "idle", outcome: "unknown", reviewStatus: "ordinary", tags: ["search", "unavailable"], detailFamilies: ["tool", "token_usage", "context_limit"], traits: { gitRemote: "unavailable" } },
  { slug: "release-context-pressure", turns: 3, agentRuns: 3, activityState: "resumed", outcome: "partial", reviewStatus: "needs_help", tags: ["context", "compaction"], detailFamilies: ["tool", "lifecycle", "context_occupancy", "cost_estimate"] },
  { slug: "agent-parent-conflict", turns: 2, agentRuns: 2, activityState: "idle", outcome: "failed", reviewStatus: "needs_help", tags: ["subagent", "reconciliation"], detailFamilies: ["tool", "lifecycle", "capability"], traits: { parentConflict: "two_exact_unresolved" } },
  { slug: "docs-mcp-unavailable", turns: 2, agentRuns: 1, activityState: "idle", outcome: "successful", reviewStatus: "ordinary", tags: ["mcp", "docs"], detailFamilies: ["tool", "lifecycle", "capability"] },
  { slug: "nonrepo-rate-limit", turns: 2, agentRuns: 1, activityState: "live", outcome: "unknown", reviewStatus: "ordinary", tags: ["non-repository", "api"], detailFamilies: ["tool", "api_request", "capability"], traits: { apiSequence: "rate_limit_then_unknown", gitState: "not_repository" } },
];

const operations = ["inspect", "validate", "replace", "render", "reconcile"] as const;
const targets = ["example-panel", "example-record", "example-route", "example-contract"] as const;
const tools = ["shell", "file_edit", "test_runner", "browser_automation", "git", "mcp_call", "documentation"] as const;
const models = ["gpt-5.6-codex", "gpt-5.6-codex-mini"] as const;

export interface RichV1CorpusMember {
  id: string;
  displayName: string;
  createdAt: Date;
}

export interface RichV1CorpusSession {
  databaseId: string;
  canonicalId: string;
  ownerMemberId: string;
  gitContext: GitContextObservation;
  firstObservedAt: Date;
  lastObservedAt: Date;
  activityState: ActivityState;
  rootAgentRunId: string;
  searchText: string;
  annotation: {
    id: string;
    outcome: Outcome;
    reviewStatus: ReviewStatus;
    tags: string[];
    updatedAt: Date;
  };
  turns: Array<{
    id: string;
    canonicalTurnId: string;
    agentRunId: string;
    firstObservedAt: Date;
    lastObservedAt: Date;
    evidence: RichExampleEvidence;
  }>;
  agentRuns: Array<{
    id: string;
    publicId: string;
    kind: "root" | "subagent";
    codexThreadId: string;
    agentType: string;
    firstObservedAt: Date;
    lastObservedAt: Date;
    identityEvidence: RichExampleEvidence;
    parentStatus: "exact" | "inferred" | "unresolved" | null;
    parentAgentRunId: string | null;
    parentReconciliation: Record<string, unknown> | null;
  }>;
  records: RichExampleRecord[];
}

export interface RichV1Corpus {
  members: RichV1CorpusMember[];
  sessions: RichV1CorpusSession[];
  counts: typeof richV1ExpectedCounts;
}

function reference(id: string): RichExampleEvidenceReference {
  return {
    origin: "example_pack_server_controlled",
    examplePackVersion: richExamplePackVersion,
    syntheticEvidenceId: id,
  };
}

function evidence(
  id: string,
  stability: RichExampleEvidence["stability"] = ["observed"],
  derivation: RichExampleEvidence["derivation"] = "exact",
): RichExampleEvidence {
  return {
    stability,
    derivation,
    sourceEventIds: [],
    references: [reference(id)],
  };
}

function safeCommit(canonicalSessionId: string) {
  return createHash("sha256").update(`synthetic\n${canonicalSessionId}`).digest("hex").slice(0, 40);
}

function gitContext(
  canonicalSessionId: string,
  repository: string | null,
  sampledAt: string,
  variant: number,
): GitContextObservation {
  if (!repository) {
    return {
      status: "not_repository",
      repositoryRoot: null,
      remoteIdentity: null,
      branch: null,
      detached: null,
      worktree: null,
      commit: null,
      sampledAt,
      provenance: {
        source: "relay_local_git",
        evidence: "local_observation",
        stability: "observed",
        derivation: "exact",
        cwd: `/examples/rich-v1/non-repository/${canonicalSessionId}`,
      },
      reason: "cwd_is_not_a_git_repository",
    };
  }
  const worktree = `/examples/rich-v1/${repository}/${canonicalSessionId}`;
  return {
    status: "available",
    repositoryRoot: `/examples/rich-v1/${repository}`,
    remoteIdentity: `https://example.invalid/loupe/${repository}.git`,
    branch: `example/${operations[variant % operations.length]}-${String(variant).padStart(2, "0")}`,
    detached: variant % 11 === 0,
    worktree,
    commit: safeCommit(canonicalSessionId),
    sampledAt,
    provenance: {
      source: "relay_local_git",
      evidence: "local_observation",
      stability: "observed",
      derivation: "exact",
      cwd: worktree,
    },
    reason: null,
  };
}

function association(scenarioIndex: number, turnId: string) {
  if ([1, 10, 14].includes(scenarioIndex)) {
    return { turnId, strength: "unavailable" as const, method: "example_pack_deliberate_unavailable_state" };
  }
  if (scenarioIndex === 8) {
    return { turnId, strength: "exact_unstable" as const, method: "example_pack_fork_association_unstable" };
  }
  if (scenarioIndex === 3) {
    return { turnId, strength: "inferred" as const, method: "example_pack_trace_schema_inference" };
  }
  return { turnId, strength: "exact" as const, method: "example_pack_server_controlled" };
}

function assertSafeString(value: string, location: string) {
  for (const match of value.matchAll(/(?:^|[\s"'(])(\/(?!\/)[^\s"'(),;]+)/g)) {
    if (!match[1]!.startsWith("/examples/rich-v1")) {
      throw new Error(`RICH_V1_UNSAFE_PATH:${location}`);
    }
  }
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(value)) {
    throw new Error(`RICH_V1_EMAIL_LIKE_VALUE:${location}`);
  }
  for (const match of value.matchAll(/https?:\/\/[^\s"']+/g)) {
    if (new URL(match[0]).hostname !== "example.invalid") {
      throw new Error(`RICH_V1_NON_EXAMPLE_DOMAIN:${location}`);
    }
  }
  if (/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+\S+|BEGIN (?:RSA |EC )?PRIVATE KEY)/.test(value)) {
    throw new Error(`RICH_V1_SECRET_SHAPED_VALUE:${location}`);
  }
}

export function validateRichV1SafeTemplate(value: unknown, location = "template"): void {
  if (typeof value === "string") {
    assertSafeString(value, location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, ordinal) => validateRichV1SafeTemplate(item, `${location}[${ordinal}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      validateRichV1SafeTemplate(item, `${location}.${key}`);
    }
  }
}

function buildSession(
  organizationId: string,
  scenarioIndex: number,
  variant: number,
  memberIds: readonly string[],
): RichV1CorpusSession {
  const scenario = scenarios[scenarioIndex]!;
  // The reviewed manifest says `* 5`, but that produces 41/39 outliers rather
  // than its independently fixed 40 Sessions per member. `* 4` preserves the
  // same bounded rotation while satisfying the authoritative public total.
  const personaIndex = (scenarioIndex * 4 + variant) % exampleMembers.length;
  const persona = exampleMembers[personaIndex]!;
  const canonicalId = `seeded-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`;
  const databaseId = stableExampleUuid(organizationId, canonicalId, "session", 0);
  const eventTime = new Date(Date.parse("2026-06-08T09:00:00.000Z") + (scenarioIndex * 32 + variant) * 19 * 60_000);
  const lastObservedAt = new Date(eventTime.getTime() + (scenario.turns * 6 + 1) * 60_000);
  const operation = operations[(scenarioIndex + variant) % operations.length]!;
  const target = targets[(scenarioIndex * 3 + variant) % targets.length]!;
  const toolName = tools[(scenarioIndex + variant) % tools.length]!;
  const model = [10, 14].includes(scenarioIndex) ? null : models[(scenarioIndex + variant) % models.length]!;
  const repositoryChoice =
    scenario.traits?.gitState === "not_repository"
      ? null
      : persona[1][(scenarioIndex + variant) % persona[1].length];
  const rootAgentRunId = `example-agent-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-00`;
  const turns = Array.from({ length: scenario.turns }, (_, ordinal) => {
    const canonicalTurnId = `example-turn-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-${String(ordinal).padStart(2, "0")}`;
    const at = new Date(eventTime.getTime() + (ordinal * 6 + 1) * 60_000);
    const id = stableExampleUuid(organizationId, canonicalId, "turn", ordinal);
    const unavailable = [1, 10, 14].includes(scenarioIndex) && ordinal === scenario.turns - 1;
    return {
      id,
      canonicalTurnId,
      agentRunId: `example-agent-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-${String(Math.min(ordinal, scenario.agentRuns - 1)).padStart(2, "0")}`,
      firstObservedAt: at,
      lastObservedAt: new Date(at.getTime() + 5 * 60_000),
      evidence: unavailable ? evidence(id, ["unavailable"], "unavailable") : evidence(id),
    };
  });
  const agentRuns = Array.from({ length: scenario.agentRuns }, (_, ordinal) => {
    const id = stableExampleUuid(organizationId, canonicalId, "agent_run", ordinal);
    const publicId = `example-agent-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-${String(ordinal).padStart(2, "0")}`;
    const conflicting =
      scenario.traits?.parentConflict === "two_exact_unresolved" && ordinal === 1;
    const inferredParent =
      scenario.traits?.parentAssociation === "inferred" && ordinal === 1;
    return {
      id,
      publicId,
      kind: ordinal === 0 ? "root" as const : "subagent" as const,
      codexThreadId: `example-thread-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-${String(ordinal).padStart(2, "0")}`,
      agentType: ["implementation", "research", "review", "test"][ordinal % 4]!,
      firstObservedAt: new Date(eventTime.getTime() + ordinal * 2 * 60_000),
      lastObservedAt: lastObservedAt,
      identityEvidence: conflicting
        ? evidence(id, ["observed", "unstable"], "unavailable")
        : inferredParent
          ? evidence(id, ["inferred"], "inferred")
          : evidence(id),
      parentStatus: ordinal === 0
        ? null
        : conflicting
          ? "unresolved" as const
          : inferredParent
            ? "inferred" as const
            : "exact" as const,
      parentAgentRunId: ordinal === 0 || conflicting ? null : ordinal === 1 ? rootAgentRunId : `example-agent-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-${String(ordinal - 1).padStart(2, "0")}`,
      parentReconciliation: ordinal === 0 ? null : {
        inputs: [],
        rule: conflicting
          ? "conflicting_example_parent_observations"
          : inferredParent
            ? "example_pack_inferred_parent"
            : "example_pack_server_controlled",
        selectedValue: conflicting ? null : ordinal === 1 ? rootAgentRunId : `example-agent-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}-${String(ordinal - 1).padStart(2, "0")}`,
        confidence: conflicting ? "none" : inferredParent ? "medium" : "high",
      },
    };
  });
  const records: RichExampleRecord[] = [];
  const ordinals = new Map<RichExampleRecordKind, number>();
  const addRecord = (
    recordKind: RichExampleRecordKind,
    payload: (reference: RichExampleEvidenceReference) => Record<string, unknown>,
  ) => {
    const ordinal = ordinals.get(recordKind) ?? 0;
    ordinals.set(recordKind, ordinal + 1);
    const id = stableExampleUuid(organizationId, canonicalId, recordKind, ordinal);
    const built = payload(reference(id));
    validateRichV1SafeTemplate(built, `${canonicalId}.${recordKind}.${ordinal}`);
    records.push({ id, organizationId, sessionId: databaseId, packVersion: richExamplePackVersion, recordKind, ordinal, payload: built });
  };
  const firstTurnId = turns[0]!.canonicalTurnId;
  const activitySource =
    scenarioIndex === 10
      ? "observed"
      : scenarioIndex === 11
        ? "compact"
        : scenarioIndex === 12
          ? "clear"
          : scenario.activityState === "resumed"
            ? "resume"
            : "startup";
  addRecord("activity_episode", (source) => ({
    id: `example-activity-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
    source: activitySource,
    state: scenario.activityState,
    startedAt: eventTime.toISOString(),
    endedAt: scenario.activityState === "live" ? null : lastObservedAt.toISOString(),
    sourceEventId: null,
    reference: source,
  }));
  addRecord("timeline_event", (source) => ({
    sourceEventId: null,
    reference: source,
    event:
      scenario.traits?.timelineState === "duplicate_event_retained"
        ? "ExampleDuplicateSourceEventRetained"
        : `Example ${scenario.slug} activity`,
    occurredAt: eventTime.toISOString(),
    turnId: firstTurnId,
    agentRunId: rootAgentRunId,
    evidence: evidence(source.syntheticEvidenceId),
  }));
  addRecord("context_contribution", (source) => ({
    status: scenarioIndex === 11 ? "estimated" : "unavailable",
    method: scenarioIndex === 11 ? "synthetic_bounded_context_estimate" : "no_exact_per_item_context_contract",
    note: scenarioIndex === 11 ? "Estimated from bounded synthetic Example inputs." : "Unavailable by design in this Seeded Example Session.",
    evidence: scenarioIndex === 11 ? evidence(source.syntheticEvidenceId, ["inferred"], "inferred") : evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
  }));

  let detailFamilies = [...scenario.detailFamilies];
  if ([1, 2, 6].includes(scenarioIndex)) {
    detailFamilies = detailFamilies.slice(0, -1);
  }
  if (scenarioIndex === 3) {
    detailFamilies = detailFamilies.filter((family) => family !== "capability");
  }
  if (scenarioIndex === 5 || scenarioIndex === 11) {
    detailFamilies = detailFamilies.filter((family) => family !== "tool");
  }
  if (variant === 0 && scenarioIndex >= 1 && scenarioIndex <= 8) {
    detailFamilies =
      scenarioIndex === 3
        ? detailFamilies.filter((_, ordinal) => ordinal !== 2)
        : scenarioIndex === 2
          ? detailFamilies.filter((_, ordinal) => ordinal !== 1)
          : detailFamilies.slice(0, -1);
  }
  for (const family of detailFamilies) {
    if (family === "tool") {
      const outcome = [1, 10, 14].includes(scenarioIndex) ? "unknown" : [3, 7, 8, 12].includes(scenarioIndex) ? "failure" : "success";
      addRecord("tool", (source) => ({
        id: `example-call-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
        toolName,
        occurredAt: new Date(eventTime.getTime() + 2 * 60_000).toISOString(),
        identifiers: { hookToolUseId: null, otelCallId: null },
        input: { operation: `${operation} ${target}`, path: `/examples/rich-v1/${target}` },
        result: outcome === "unknown" ? null : { status: outcome, description: outcome === "failure" ? "test command exited 1" : "synthetic example succeeded" },
        durationMs: outcome === "unknown" ? null : 80 + variant,
        outcome,
        approval: scenarioIndex === 7 ? "denied" : scenarioIndex === 0 ? "requested" : outcome === "unknown" ? "unavailable" : "approved",
        retryCount: outcome === "unknown" ? null : variant % 3,
        turnAssociation: association(scenarioIndex, firstTurnId),
        evidence: outcome === "unknown" ? evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable") : evidence(source.syntheticEvidenceId),
        coverageGaps: outcome === "unknown" ? ["example_tool_result_unavailable"] : [],
      }));
    } else if (family === "lifecycle") {
      const kind =
        scenarioIndex === 2
          ? "skill"
          : [5, 13].includes(scenarioIndex)
            ? "mcp"
            : scenarioIndex === 8 || scenarioIndex === 12
              ? "fork"
              : "compaction";
      addRecord("lifecycle", (source) => ({
        id: `example-lifecycle-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
        kind,
        event:
          kind === "skill"
            ? "explicit_skill_mention"
            : kind === "mcp"
              ? "example_mcp_configuration"
              : kind === "fork"
                ? "example_fork_observed"
                : "example_compaction_observed",
        occurredAt: new Date(eventTime.getTime() + 3 * 60_000).toISOString(),
        details: {
          operation: `${operation} ${target}`,
          ...(scenario.traits?.parentConflict === "two_exact_unresolved"
            ? {
                conflictingParentObservations: [
                  `example-agent-rich-v1-agent-parent-conflict-${String(variant).padStart(2, "0")}-00`,
                  `example-agent-rich-v1-agent-parent-alternative-${String(variant).padStart(2, "0")}-00`,
                ],
                resolution: "unresolved",
              }
            : {}),
        },
        turnAssociation: association(scenarioIndex, firstTurnId),
        evidence: evidence(source.syntheticEvidenceId, scenarioIndex === 8 ? ["observed", "unstable"] : ["observed"], scenarioIndex === 8 ? "inferred" : "exact"),
      }));
    } else if (family === "api_request") {
      const statuses: Record<number, number> = { 3: 422, 6: 200, 7: 403, 9: 500, 14: 429 };
      const statusCode = statuses[scenarioIndex] ?? 200;
      addRecord("api_request", (source) => ({
        id: `example-request-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
        occurredAt: new Date(eventTime.getTime() + 4 * 60_000).toISOString(),
        attempt: variant % 3,
        statusCode,
        durationMs: 40 + variant,
        success: statusCode === 200,
        error: statusCode === 200 ? null : `synthetic example request returned ${statusCode}`,
        turnAssociation: association(scenarioIndex, firstTurnId),
        evidence: evidence(source.syntheticEvidenceId),
      }));
    } else if (family === "token_usage") {
      const unavailable = model === null;
      const input = 1_000 + scenarioIndex * 100 + variant;
      addRecord("token_usage", (source) => ({
        id: `example-token-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
        occurredAt: new Date(eventTime.getTime() + 5 * 60_000).toISOString(),
        sourceKind: scenarioIndex === 8 ? "turn_total" : "provider_completion",
        model,
        serviceTier:
          model && scenario.traits?.modelTier !== "unknown"
            ? variant % 2 === 0
              ? "example-standard"
              : "example-fast"
            : null,
        categories: unavailable ? { input: null, cachedInput: null, output: null, reasoningOutput: null, total: null } : { input, cachedInput: scenarioIndex === 8 ? null : 100 + variant, output: 200 + variant, reasoningOutput: 50 + variant, total: scenarioIndex === 8 ? input + 250 + variant * 2 : input + 350 + variant * 3 },
        turnAssociation: association(scenarioIndex, firstTurnId),
        evidence: unavailable ? evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable") : evidence(source.syntheticEvidenceId),
      }));
    } else if (family === "context_limit") {
      addRecord("context_limit", (source) => ({
        model,
        contextWindow: model ? 128_000 : null,
        autoCompactionLimit: model ? 112_000 : null,
        evidence: model ? evidence(source.syntheticEvidenceId, ["documented"], "exact") : evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
      }));
    } else if (family === "context_occupancy") {
      const inputTokens =
        scenarioIndex === 11
          ? 104_000 + variant
          : variant % 2 === 0
            ? 2_000 + variant
            : 64_000 + variant;
      addRecord("context_occupancy", (source) => ({
        tokenUsageId: `example-token-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
        occupancyTokens: inputTokens,
        occupancyPercent: inputTokens / 128_000 * 100,
        method: "provider_input_tokens_over_reported_context_window",
        inputs: { inputTokens, contextWindow: 128_000 },
        missingAssumptions: ["synthetic_context_item_contributions_not_exact"],
        evidence: evidence(source.syntheticEvidenceId, ["inferred"], "inferred"),
      }));
    } else if (family === "cost_estimate") {
      const estimated = scenarioIndex === 4;
      const unknownModelMapping = scenarioIndex === 11;
      addRecord("cost_estimate", (source) => ({
        tokenUsageId: `example-token-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
        status: estimated ? "estimated" : "unavailable",
        amount: estimated ? 0.012 + variant / 10_000 : null,
        currency: estimated ? "USD" : null,
        effectiveDate: estimated ? "2026-06-01" : null,
        priceTableVersion: estimated ? "example-rich-v1-2026-06" : null,
        modelMapping: {
          observedModel: unknownModelMapping ? null : model,
          pricedModel: estimated ? "gpt-5.6-codex-example-price" : null,
        },
        inputs: { uncachedInputTokens: estimated ? 1_000 + variant : null, cachedInputTokens: estimated ? 100 : null, outputTokens: estimated ? 200 : null, reasoningOutputTokens: estimated ? 50 : null },
        billingCaveat: estimated
          ? "Illustrative Example-pack estimate; not provider billing evidence."
          : unknownModelMapping
            ? "Unknown Example model mapping cannot produce a cost estimate."
            : "Incomplete synthetic Example Token categories cannot produce a cost estimate.",
        reason: estimated
          ? null
          : unknownModelMapping
            ? "unknown_example_model_mapping"
            : "incomplete_example_token_categories",
        evidence: estimated ? evidence(source.syntheticEvidenceId, ["inferred"], "inferred") : evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
      }));
    } else {
      const capabilityByScenario = {
        0: "explicit_skill_mention",
        1: "complete_passive_capability_snapshot",
        2: "explicit_skill_mention",
        3: "configured_mcp_servers",
        5: "observed_mcp_use",
        6: "observed_mcp_use",
        7: "implicit_skill_activation",
        12: "fork",
        13: "configured_mcp_servers",
        14: "complete_passive_capability_snapshot",
      } as const;
      const capability =
        capabilityByScenario[
          scenarioIndex as keyof typeof capabilityByScenario
        ] ?? "explicit_skill_mention";
      const unavailable = [1, 10, 14].includes(scenarioIndex);
      addRecord("capability", (source) => ({
        capability,
        state: unavailable
          ? "unavailable"
          : capability === "configured_mcp_servers"
            ? "conditional"
            : capability === "fork" || capability === "implicit_skill_activation"
              ? "inferred"
              : "observed",
        note: unavailable ? "Synthetic Example capability evidence is unavailable by design." : "Server-controlled synthetic Example capability evidence.",
        evidence: unavailable
          ? evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable")
          : evidence(
              source.syntheticEvidenceId,
              capability === "fork" || capability === "implicit_skill_activation"
                ? ["inferred"]
                : ["observed"],
              capability === "fork" || capability === "implicit_skill_activation"
                ? "inferred"
                : "exact",
            ),
      }));
    }
  }

  if (scenario.traits?.toolSequence === "approval_requested_then_approved") {
    addRecord("tool", (source) => ({
      id: `example-call-rich-v1-oauth-local-callback-${String(variant).padStart(2, "0")}-approval`,
      toolName,
      occurredAt: new Date(eventTime.getTime() + 60_000).toISOString(),
      identifiers: { hookToolUseId: null, otelCallId: null },
      input: { operation: `${operation} ${target}`, path: `/examples/rich-v1/${target}` },
      result: null,
      durationMs: null,
      outcome: "unknown",
      approval: "requested",
      retryCount: 0,
      turnAssociation: association(scenarioIndex, firstTurnId),
      evidence: evidence(source.syntheticEvidenceId),
      coverageGaps: ["example_tool_approval_pending"],
    }));
  }
  if (scenario.traits?.toolSequence === "failure_then_success") {
    addRecord("tool", (source) => ({
      id: `example-call-rich-v1-release-rollback-${String(variant).padStart(2, "0")}-retry`,
      toolName,
      occurredAt: new Date(eventTime.getTime() + 4 * 60_000).toISOString(),
      identifiers: { hookToolUseId: null, otelCallId: null },
      input: { operation: `reconcile ${target}`, path: `/examples/rich-v1/${target}` },
      result: { status: "success", description: "synthetic example retry succeeded" },
      durationMs: 120 + variant,
      outcome: "success",
      approval: "approved",
      retryCount: 1,
      turnAssociation: association(scenarioIndex, firstTurnId),
      evidence: evidence(source.syntheticEvidenceId),
      coverageGaps: [],
    }));
  }
  if (scenario.traits?.apiSequence === "rate_limit_then_unknown") {
    addRecord("api_request", (source) => ({
      id: `example-request-rich-v1-nonrepo-rate-limit-${String(variant).padStart(2, "0")}-retry`,
      occurredAt: new Date(eventTime.getTime() + 5 * 60_000).toISOString(),
      attempt: null,
      statusCode: null,
      durationMs: null,
      success: null,
      error: null,
      turnAssociation: {
        turnId: firstTurnId,
        strength: "unavailable",
        method: "example_pack_retry_state_unavailable",
      },
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
    }));
  }
  if (scenario.traits?.lifecycleSequence === "compaction_then_resume") {
    addRecord("lifecycle", (source) => ({
      id: `example-lifecycle-rich-v1-telemetry-backfill-${String(variant).padStart(2, "0")}-resume`,
      kind: "resume",
      event: "example_resume_observed",
      occurredAt: new Date(eventTime.getTime() + 4 * 60_000).toISOString(),
      details: { operation: "reconcile example-record" },
      turnAssociation: association(scenarioIndex, firstTurnId),
      evidence: evidence(source.syntheticEvidenceId),
    }));
  }
  if (
    scenario.traits?.capabilitySequence ===
    "mcp_observed_then_snapshot_unavailable"
  ) {
    addRecord("capability", (source) => ({
      capability: "complete_passive_capability_snapshot",
      state: "unavailable",
      note: "A complete passive synthetic Example capability snapshot is unavailable.",
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
    }));
  }
  if (scenario.traits?.costGap === "unknown_price_mapping") {
    addRecord("cost_estimate", (source) => ({
      tokenUsageId: `example-token-rich-v1-${scenario.slug}-${String(variant).padStart(2, "0")}`,
      status: "unavailable",
      amount: null,
      currency: null,
      effectiveDate: null,
      priceTableVersion: null,
      modelMapping: { observedModel: model, pricedModel: null },
      inputs: {
        uncachedInputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null,
      },
      billingCaveat: "No illustrative Example price mapping is available.",
      reason: "example_price_mapping_unavailable",
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
    }));
  }

  if (scenarioIndex === 0 && variant === 0) {
    const unavailableTurnId = turns[1]!.canonicalTurnId;
    addRecord("tool", (source) => ({
      id: "example-call-rich-v1-ledger-a11y-00-unavailable",
      toolName: "shell",
      occurredAt: new Date(eventTime.getTime() + 7 * 60_000).toISOString(),
      identifiers: { hookToolUseId: null, otelCallId: null },
      input: { operation: "validate example-contract" },
      result: null,
      durationMs: null,
      outcome: "unknown",
      approval: "unavailable",
      retryCount: null,
      turnAssociation: {
        turnId: unavailableTurnId,
        strength: "unavailable",
        method: "example_pack_deliberate_unavailable_state",
      },
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
      coverageGaps: ["example_tool_result_unavailable", "example_tool_duration_unavailable"],
    }));
    addRecord("lifecycle", (source) => ({
      id: "example-lifecycle-rich-v1-ledger-a11y-00-skill",
      kind: "skill",
      event: "explicit_skill_mention",
      occurredAt: new Date(eventTime.getTime() + 3 * 60_000).toISOString(),
      details: { operation: "inspect example-panel" },
      turnAssociation: association(scenarioIndex, firstTurnId),
      evidence: evidence(source.syntheticEvidenceId),
    }));
    addRecord("api_request", (source) => ({
      id: "example-request-rich-v1-ledger-a11y-00-schema",
      occurredAt: new Date(eventTime.getTime() + 8 * 60_000).toISOString(),
      attempt: 1,
      statusCode: 422,
      durationMs: 85,
      success: false,
      error: "synthetic example schema validation returned 422",
      turnAssociation: association(scenarioIndex, unavailableTurnId),
      evidence: evidence(source.syntheticEvidenceId),
    }));
    addRecord("token_usage", (source) => ({
      id: "example-token-rich-v1-ledger-a11y-00-unavailable",
      occurredAt: new Date(eventTime.getTime() + 9 * 60_000).toISOString(),
      sourceKind: "turn_total",
      model: null,
      serviceTier: null,
      categories: {
        input: null,
        cachedInput: null,
        output: null,
        reasoningOutput: null,
        total: null,
      },
      turnAssociation: {
        turnId: unavailableTurnId,
        strength: "unavailable",
        method: "example_pack_deliberate_unavailable_state",
      },
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
    }));
    addRecord("context_occupancy", (source) => ({
      tokenUsageId: "example-token-rich-v1-ledger-a11y-00",
      occupancyTokens: 1_000,
      occupancyPercent: 0.78125,
      method: "provider_input_tokens_over_reported_context_window",
      inputs: { inputTokens: 1_000, contextWindow: 128_000 },
      missingAssumptions: ["synthetic_context_item_contributions_not_exact"],
      evidence: evidence(source.syntheticEvidenceId, ["inferred"], "inferred"),
    }));
    addRecord("cost_estimate", (source) => ({
      tokenUsageId: "example-token-rich-v1-ledger-a11y-00",
      status: "estimated",
      amount: 0.012,
      currency: "USD",
      effectiveDate: "2026-06-01",
      priceTableVersion: "example-rich-v1-2026-06",
      modelMapping: {
        observedModel: "gpt-5.6-codex",
        pricedModel: "gpt-5.6-codex-example-price",
      },
      inputs: {
        uncachedInputTokens: 1_000,
        cachedInputTokens: 100,
        outputTokens: 200,
        reasoningOutputTokens: 50,
      },
      billingCaveat: "Illustrative Example-pack estimate; not provider billing evidence.",
      reason: null,
      evidence: evidence(source.syntheticEvidenceId, ["inferred"], "inferred"),
    }));
    addRecord("cost_estimate", (source) => ({
      tokenUsageId: "example-token-rich-v1-ledger-a11y-00-unavailable",
      status: "unavailable",
      amount: null,
      currency: null,
      effectiveDate: null,
      priceTableVersion: null,
      modelMapping: { observedModel: null, pricedModel: null },
      inputs: {
        uncachedInputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null,
      },
      billingCaveat: "Unknown Example model and Token categories cannot produce a cost estimate.",
      reason: "unknown_example_model_and_token_categories",
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
    }));
    addRecord("capability", (source) => ({
      capability: "complete_passive_capability_snapshot",
      state: "unavailable",
      note: "A complete passive synthetic Example capability snapshot is unavailable.",
      evidence: evidence(source.syntheticEvidenceId, ["unavailable"], "unavailable"),
    }));
  }

  const sessionGitContext = gitContext(
    canonicalId,
    scenario.traits?.gitRemote === "unavailable" ? "ledger-ui" : repositoryChoice,
    eventTime.toISOString(),
    variant,
  );
  if (scenario.traits?.gitRemote === "unavailable") {
    sessionGitContext.remoteIdentity = null;
  }
  const session: RichV1CorpusSession = {
    databaseId,
    canonicalId,
    ownerMemberId: memberIds[personaIndex]!,
    gitContext: sessionGitContext,
    firstObservedAt: eventTime,
    lastObservedAt,
    activityState: scenario.activityState,
    rootAgentRunId,
    searchText: [
      "Seeded",
      "Example",
      "rich-v1",
      scenario.slug,
      ...scenario.tags,
      operation,
      target,
      toolName,
      model ?? "model unavailable",
      sessionGitContext.remoteIdentity ??
        (sessionGitContext.status === "not_repository"
          ? "not repository"
          : "remote unavailable"),
    ].join(" "),
    annotation: {
      id: stableExampleUuid(organizationId, canonicalId, "annotation", 0),
      outcome: scenario.outcome,
      reviewStatus: scenario.reviewStatus,
      tags: ["Example", "Seeded", ...scenario.tags],
      updatedAt: lastObservedAt,
    },
    turns,
    agentRuns,
    records,
  };
  validateRichV1SafeTemplate({
    memberName: persona[0],
    canonicalId,
    gitContext: session.gitContext,
    searchText: session.searchText,
    annotation: session.annotation,
  }, canonicalId);
  return session;
}

export function buildRichV1Corpus(organizationId: string): RichV1Corpus {
  const createdAt = new Date("2026-06-08T09:00:00.000Z");
  const members = exampleMembers.map(([displayName], ordinal) => ({
    id: stableExampleUuid(organizationId, displayName, "member", ordinal),
    displayName,
    createdAt,
  }));
  const sessions = scenarios.flatMap((_, scenarioIndex) =>
    Array.from({ length: 32 }, (_, variant) =>
      buildSession(organizationId, scenarioIndex, variant, members.map((member) => member.id)),
    ),
  );
  const actual = {
    members: members.length,
    sessions: sessions.length,
    turns: sessions.reduce((total, session) => total + session.turns.length, 0),
    agentRuns: sessions.reduce((total, session) => total + session.agentRuns.length, 0),
    detailRecords: sessions.reduce((total, session) => total + session.records.length, 0),
  };
  for (const [name, expected] of Object.entries(richV1ExpectedCounts)) {
    if (actual[name as keyof typeof actual] !== expected) {
      throw new Error(`RICH_V1_MANIFEST_COUNT_MISMATCH:${name}:${actual[name as keyof typeof actual]}:${expected}`);
    }
  }
  const sessionCounts = new Map(members.map((member) => [member.id, 0]));
  sessions.forEach((session) => sessionCounts.set(session.ownerMemberId, (sessionCounts.get(session.ownerMemberId) ?? 0) + 1));
  if ([...sessionCounts.values()].some((count) => count !== 40)) {
    throw new Error("RICH_V1_MEMBER_SESSION_DISTRIBUTION_MISMATCH");
  }
  return { members, sessions, counts: richV1ExpectedCounts };
}
