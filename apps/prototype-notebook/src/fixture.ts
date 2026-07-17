import type {
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

const eventA = "11111111-1111-4111-8111-111111111111";
const eventB = "22222222-2222-4222-8222-222222222222";
const eventC = "33333333-3333-4333-8333-333333333333";
const memberA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deviceA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const exactEvidence = {
  stability: ["documented", "observed"] as ("documented" | "observed")[],
  derivation: "exact" as const,
  sourceEventIds: [eventA],
};

const inferredEvidence = {
  stability: ["observed", "inferred"] as ("observed" | "inferred")[],
  derivation: "inferred" as const,
  sourceEventIds: [eventB],
};

const unavailableEvidence = {
  stability: ["unavailable"] as "unavailable"[],
  derivation: "unavailable" as const,
  sourceEventIds: [] as string[],
};

const reconciliation = {
  inputs: [],
  rule: "Fixture identity follows the deterministic capture envelope.",
  selectedValue: "root-run",
  confidence: "high" as const,
};

function session(
  id: string,
  owner: { id: string; device: string; name: string },
  state: "live" | "idle" | "resumed",
  outcome: "successful" | "partial" | "failed" | "unknown",
  repository: string,
  branch: string,
) {
  return {
    id,
    owner: {
      memberId: owner.id,
      deviceId: owner.device,
      displayName: owner.name,
      isExample: false,
    },
    ownerProfile: { displayName: owner.name, isExample: false },
    gitContext: null,
    firstObservedAt: "2026-07-17T09:10:00.000Z",
    lastObservedAt:
      id === "session-build-47"
        ? "2026-07-17T09:31:10.000Z"
        : "2026-07-16T16:21:00.000Z",
    activityState: state,
    completion: { status: "not_assumed" as const, evidence: "unavailable" as const },
    rootAgentRunId: `${id}-root`,
    projectionVersion: "1" as const,
    ownershipReconciliation: { ...reconciliation, selectedValue: owner.id },
    annotations: {
      outcome,
      reviewStatus: outcome === "failed" ? ("needs_help" as const) : ("exemplar" as const),
      tags: outcome === "failed" ? ["build", "dependency"] : ["build", "recovery"],
      updatedAt: "2026-07-17T10:00:00.000Z",
    },
    synthetic: { kind: "real" as const, examplePackVersion: null },
    deepLink: `/?session=${id}`,
    repository: { repositoryRoot: `/work/${repository}`, remoteIdentity: repository, branch },
  };
}

const failedCase = session(
  "session-build-47",
  { id: memberA, device: deviceA, name: "Mira Chen" },
  "resumed",
  "failed",
  "acme/checkout",
  "fix/checkout-timeout",
);

const exemplarCase = session(
  "session-build-31",
  { id: memberB, device: deviceB, name: "Jon Bell" },
  "idle",
  "successful",
  "acme/checkout",
  "fix/retry-budget",
);

export const fixtureActivity: OrganizationActivityResponse = {
  items: [failedCase, exemplarCase],
  syntheticInclusion: "excluded",
  filters: { page: 1, pageSize: 25, includeSeeded: false },
  page: { page: 1, pageSize: 25, total: 2, hasMore: false, nextPage: null },
  aggregates: {
    sessions: 2,
    members: 2,
    repositories: 1,
    activityStates: { live: 0, idle: 1, resumed: 1 },
    outcomes: { successful: 1, partial: 0, failed: 1, unknown: 0 },
  },
  members: [
    { id: memberA, displayName: "Mira Chen", isExample: false, sessionCount: 1 },
    { id: memberB, displayName: "Jon Bell", isExample: false, sessionCount: 1 },
  ],
  repositories: [{ identity: "acme/checkout", sessionCount: 2 }],
};

function detailFor(id: string, successful: boolean): ExecutionSessionDetail {
  const item = successful ? exemplarCase : failedCase;
  const rootId = `${id}-root`;
  const scoutId = `${id}-scout`;
  const verifierId = `${id}-verifier`;
  const firstToolTime = successful ? "2026-07-16T16:12:30.000Z" : "2026-07-17T09:17:32.000Z";
  const failedTime = successful ? "2026-07-16T16:14:10.000Z" : "2026-07-17T09:22:08.000Z";
  const tools: ExecutionSessionDetail["evidence"]["tools"] = [
    {
      id: `${id}-tool-read`,
      toolName: "read_file",
      occurredAt: firstToolTime,
      identifiers: { hookToolUseId: "call-read-18", otelCallId: "otel-read-18" },
      input: { path: "packages/checkout/src/retry.ts" },
      result: { lines: 184, truncated: false },
      durationMs: 71,
      outcome: "success",
      approval: "unavailable",
      retryCount: 0,
      turnAssociation: { turnId: `${id}-turn-1`, strength: "exact", method: "hook_turn_id" },
      evidence: exactEvidence,
      coverageGaps: ["Approval was not exposed by captured evidence."],
    },
    {
      id: `${id}-tool-shell`,
      toolName: successful ? "pnpm test retry-budget" : "pnpm test checkout-timeout",
      occurredAt: failedTime,
      identifiers: { hookToolUseId: "call-shell-44", otelCallId: "otel-shell-44" },
      input: { command: successful ? "pnpm test retry-budget" : "pnpm test checkout-timeout" },
      result: successful
        ? { exitCode: 0, summary: "12 tests passed" }
        : { exitCode: 1, summary: "Expected retry budget 3, received 5" },
      durationMs: successful ? 1540 : 2381,
      outcome: successful ? "success" : "failure",
      approval: "approved",
      retryCount: successful ? 0 : 2,
      turnAssociation: { turnId: `${id}-turn-1`, strength: "exact_unstable", method: "producer_trace_parent" },
      evidence: inferredEvidence,
      coverageGaps: successful ? [] : ["Passive capture cannot prove why the retry budget changed."],
    },
    {
      id: `${id}-tool-patch`,
      toolName: "apply_patch",
      occurredAt: successful ? "2026-07-16T16:16:01.000Z" : "2026-07-17T09:26:44.000Z",
      identifiers: { hookToolUseId: "call-patch-51", otelCallId: null },
      input: { file: "packages/checkout/src/retry.ts" },
      result: successful ? { changed: true } : null,
      durationMs: successful ? 115 : null,
      outcome: successful ? "success" : "unknown",
      approval: "unavailable",
      retryCount: null,
      turnAssociation: { turnId: `${id}-turn-2`, strength: "inferred", method: "unique_turn_time_window" },
      evidence: successful ? exactEvidence : unavailableEvidence,
      coverageGaps: successful ? [] : ["Matching OTel result was not captured."],
    },
  ];

  return {
    session: item,
    activities: [
      { id: `${id}-episode-1`, source: "startup", state: "idle", startedAt: item.firstObservedAt, endedAt: failedTime, sourceEventId: eventA },
      { id: `${id}-episode-2`, source: "resume", state: item.activityState, startedAt: failedTime, endedAt: null, sourceEventId: eventC },
    ],
    turns: [
      { id: `${id}-turn-1`, agentRunId: rootId, firstObservedAt: item.firstObservedAt, lastObservedAt: failedTime, evidence: exactEvidence },
      { id: `${id}-turn-2`, agentRunId: rootId, firstObservedAt: failedTime, lastObservedAt: item.lastObservedAt, evidence: inferredEvidence },
    ],
    agentRuns: [
      { id: rootId, kind: "root", codexThreadId: `thread-${id}-root`, agentType: "coding", firstObservedAt: item.firstObservedAt, lastObservedAt: item.lastObservedAt, identityEvidence: exactEvidence, parentEdge: null },
      {
        id: scoutId,
        kind: "subagent",
        codexThreadId: `thread-${id}-scout`,
        agentType: "explorer",
        firstObservedAt: firstToolTime,
        lastObservedAt: failedTime,
        identityEvidence: exactEvidence,
        parentEdge: { status: "exact", parentAgentRunId: rootId, reconciliation: { ...reconciliation, selectedValue: rootId } },
      },
      {
        id: verifierId,
        kind: "subagent",
        codexThreadId: `thread-${id}-verify`,
        agentType: "verifier",
        firstObservedAt: failedTime,
        lastObservedAt: item.lastObservedAt,
        identityEvidence: inferredEvidence,
        parentEdge: { status: "inferred", parentAgentRunId: rootId, reconciliation: { ...reconciliation, selectedValue: rootId, confidence: "medium" } },
      },
    ],
    timeline: [
      { sourceEventId: eventA, event: "turn.started", occurredAt: item.firstObservedAt, turnId: `${id}-turn-1`, agentRunId: rootId, evidence: exactEvidence },
      { sourceEventId: eventB, event: "subagent.started", occurredAt: firstToolTime, turnId: `${id}-turn-1`, agentRunId: scoutId, evidence: inferredEvidence },
      { sourceEventId: eventC, event: successful ? "tool.completed" : "tool.failed", occurredAt: failedTime, turnId: `${id}-turn-1`, agentRunId: scoutId, evidence: inferredEvidence },
      { sourceEventId: eventB, event: "session.resumed", occurredAt: failedTime, turnId: `${id}-turn-2`, agentRunId: rootId, evidence: exactEvidence },
      { sourceEventId: eventA, event: "turn.stopped", occurredAt: item.lastObservedAt, turnId: `${id}-turn-2`, agentRunId: verifierId, evidence: exactEvidence },
    ],
    evidence: {
      tools,
      lifecycle: [
        { id: `${id}-resume`, kind: "resume", event: "SessionStart", occurredAt: failedTime, details: { source: "resume" }, turnAssociation: { turnId: `${id}-turn-2`, strength: "exact", method: "hook_turn_id" }, evidence: exactEvidence },
        { id: `${id}-skill`, kind: "skill", event: "SKILL.md accessed", occurredAt: firstToolTime, details: { name: "tdd", interpretation: "access, not compliance" }, turnAssociation: { turnId: `${id}-turn-1`, strength: "inferred", method: "unique_turn_time_window" }, evidence: inferredEvidence },
      ],
      apiRequests: [],
      tokenUsage: [4200, 6800, 9100, 12400].map((input, index) => ({
        id: `${id}-tokens-${index + 1}`,
        occurredAt: new Date(Date.parse(item.firstObservedAt) + index * 240000).toISOString(),
        sourceKind: "provider_completion" as const,
        model: "gpt-5.6-sol",
        serviceTier: null,
        categories: { input, cachedInput: index * 1100, output: 610 + index * 210, reasoningOutput: 240 + index * 90, total: input + 850 + index * 1400 },
        turnAssociation: { turnId: index < 2 ? `${id}-turn-1` : `${id}-turn-2`, strength: "exact_unstable" as const, method: "producer_trace_parent" },
        evidence: inferredEvidence,
      })),
      context: {
        limits: [{ model: "gpt-5.6-sol", contextWindow: 196000, autoCompactionLimit: 176000, evidence: exactEvidence }],
        occupancy: [4200, 6800, 9100, 12400].map((input, index) => ({
          tokenUsageId: `${id}-tokens-${index + 1}`,
          occupancyTokens: input,
          occupancyPercent: Number(((input / 196000) * 100).toFixed(2)),
          method: "provider_input_tokens_over_reported_context_window" as const,
          inputs: { inputTokens: input, contextWindow: 196000 },
          missingAssumptions: ["Provider input usage may differ from the exact serialized request."],
          evidence: inferredEvidence,
        })),
        firstRequestBaseline: {
          tokenUsageId: `${id}-tokens-1`, occupancyTokens: 4200, occupancyPercent: 2.14, method: "provider_input_tokens_over_reported_context_window", inputs: { inputTokens: 4200, contextWindow: 196000 }, missingAssumptions: ["Provider input usage may differ from the exact serialized request."], evidence: inferredEvidence,
        },
        contribution: { status: "unavailable", method: "no_stable_passive_per_item_context_contract", note: "Exact per-item Context contribution is unavailable from captured evidence.", evidence: unavailableEvidence },
      },
      costEstimates: [{
        tokenUsageId: `${id}-tokens-4`, status: "unavailable", amount: null, currency: null, effectiveDate: null, priceTableVersion: null,
        modelMapping: { observedModel: "gpt-5.6-sol", pricedModel: null },
        inputs: { uncachedInputTokens: 9100, cachedInputTokens: 3300, outputTokens: 1240, reasoningOutputTokens: 510 },
        billingCaveat: "Codex reports tokens, not provider charges.", reason: "No explicit price-table mapping for the observed model.",
      }],
      capabilities: [
        { capability: "explicit_skill_mention", state: "inferred", note: "SKILL.md access proves access, not workflow compliance.", evidence: inferredEvidence },
        { capability: "observed_mcp_use", state: "unavailable", note: "No supported MCP invocation was captured in this Session.", evidence: unavailableEvidence },
      ],
    },
  };
}

export const fixtureDetails: Record<string, ExecutionSessionDetail> = {
  "session-build-47": detailFor("session-build-47", false),
  "session-build-31": detailFor("session-build-31", true),
};
