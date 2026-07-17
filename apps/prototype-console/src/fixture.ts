import type { ActivityResponse, ComparisonResponse, Evidence, Session, SessionDetail } from "./types";

const exact: Evidence = {
  stability: ["observed", "unstable"],
  derivation: "exact",
  sourceEventIds: [],
};

const inferred: Evidence = {
  stability: ["inferred"],
  derivation: "inferred",
  sourceEventIds: [],
};

const unavailable: Evidence = {
  stability: ["unavailable"],
  derivation: "unavailable",
  sourceEventIds: [],
};

const memberId = "11111111-1111-4111-8111-111111111111";

function session(
  id: string,
  owner: string,
  state: Session["activityState"],
  outcome: Session["annotations"]["outcome"],
  reviewStatus: Session["annotations"]["reviewStatus"],
  repo: string,
  lastObservedAt: string,
): Session {
  return {
    id,
    owner: { memberId, deviceId: "22222222-2222-4222-8222-222222222222", displayName: owner, isExample: false },
    ownerProfile: { displayName: owner, isExample: false },
    gitContext: {
      status: "available",
      repositoryRoot: `/workspace/${repo.split("/").at(-1)}`,
      remoteIdentity: repo,
      branch: outcome === "failed" ? "feature/package-output" : "main",
      worktree: `/workspace/${repo.split("/").at(-1)}`,
      commit: outcome === "failed" ? "6b0d9f2" : "a18cc72",
    },
    firstObservedAt: "2026-07-17T11:41:02.000Z",
    lastObservedAt,
    activityState: state,
    completion: { status: "not_assumed", evidence: "unavailable" },
    rootAgentRunId: `agent-root-${id}`,
    projectionVersion: "1",
    ownershipReconciliation: { rule: "device_member_at_delivery", confidence: "high" },
    annotations: {
      outcome,
      reviewStatus,
      tags: outcome === "failed" ? ["build", "permissions", "release"] : ["verified"],
      updatedAt: "2026-07-17T12:08:00.000Z",
    },
    synthetic: { kind: "real", examplePackVersion: null },
    deepLink: `/?session=${id}`,
    repository: { repositoryRoot: `/workspace/${repo.split("/").at(-1)}`, remoteIdentity: repo, branch: outcome === "failed" ? "feature/package-output" : "main" },
  };
}

const failedSession = session("session-edge-017", "Mina Shah", "idle", "failed", "needs_help", "acme/relay", "2026-07-17T12:03:28.000Z");
const exemplarSession = session("session-edge-016", "Diego Ruiz", "idle", "successful", "exemplar", "acme/relay", "2026-07-17T11:32:12.000Z");
const resumedSession = session("session-edge-015", "Mina Shah", "resumed", "partial", "ordinary", "acme/console", "2026-07-17T10:58:43.000Z");

export const edgeActivity: ActivityResponse = {
  items: [failedSession, exemplarSession, resumedSession],
  syntheticInclusion: "excluded",
  filters: { page: 1, pageSize: 50, includeSeeded: false },
  page: { page: 1, pageSize: 50, total: 3, hasMore: false, nextPage: null },
  aggregates: {
    sessions: 3,
    members: 2,
    repositories: 2,
    activityStates: { live: 0, idle: 2, resumed: 1 },
    outcomes: { successful: 1, partial: 1, failed: 1, unknown: 0 },
  },
  members: [
    { id: memberId, displayName: "Mina Shah", isExample: false, sessionCount: 2 },
    { id: "33333333-3333-4333-8333-333333333333", displayName: "Diego Ruiz", isExample: false, sessionCount: 1 },
  ],
  repositories: [
    { identity: "acme/relay", sessionCount: 2 },
    { identity: "acme/console", sessionCount: 1 },
  ],
};

const toolSuccessSource = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const toolFailureSource = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

export const failedSessionDetail: SessionDetail = {
  session: failedSession,
  activities: [
    {
      id: "activity-017-a",
      source: "startup",
      state: "idle",
      startedAt: "2026-07-17T11:41:02.000Z",
      endedAt: "2026-07-17T12:03:28.000Z",
      sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    },
  ],
  turns: [
    { id: "turn-package", agentRunId: "agent-root-session-edge-017", firstObservedAt: "2026-07-17T11:41:06.000Z", lastObservedAt: "2026-07-17T12:03:28.000Z", evidence: exact },
    { id: "turn-inspect-build", agentRunId: "agent-child-build", firstObservedAt: "2026-07-17T11:43:54.000Z", lastObservedAt: "2026-07-17T11:47:11.000Z", evidence: { ...exact, sourceEventIds: [toolSuccessSource] } },
    { id: "turn-write-output", agentRunId: "agent-child-package", firstObservedAt: "2026-07-17T11:58:04.000Z", lastObservedAt: "2026-07-17T12:03:28.000Z", evidence: { ...exact, sourceEventIds: [toolFailureSource] } },
  ],
  agentRuns: [
    {
      id: "agent-root-session-edge-017",
      kind: "root",
      codexThreadId: "thread_017",
      agentType: "coding-agent",
      firstObservedAt: "2026-07-17T11:41:02.000Z",
      lastObservedAt: "2026-07-17T12:03:28.000Z",
      identityEvidence: exact,
      parentEdge: null,
    },
    {
      id: "agent-child-build",
      kind: "subagent",
      codexThreadId: "thread_017_build",
      agentType: "explorer",
      firstObservedAt: "2026-07-17T11:43:54.000Z",
      lastObservedAt: "2026-07-17T11:47:11.000Z",
      identityEvidence: exact,
      parentEdge: { status: "exact", parentAgentRunId: "agent-root-session-edge-017", reconciliation: { confidence: "high", rule: "hook_parent_thread_id" } },
    },
    {
      id: "agent-child-package",
      kind: "subagent",
      codexThreadId: "thread_017_package",
      agentType: "implementer",
      firstObservedAt: "2026-07-17T11:55:31.000Z",
      lastObservedAt: "2026-07-17T12:03:28.000Z",
      identityEvidence: { ...exact, stability: ["observed", "unstable"] },
      parentEdge: { status: "inferred", parentAgentRunId: "agent-root-session-edge-017", reconciliation: { confidence: "medium", rule: "unique_nested_time_window" } },
    },
    {
      id: "agent-orphan-lint",
      kind: "subagent",
      codexThreadId: null,
      agentType: "reviewer",
      firstObservedAt: "2026-07-17T11:51:08.000Z",
      lastObservedAt: "2026-07-17T11:52:15.000Z",
      identityEvidence: inferred,
      parentEdge: { status: "unresolved", parentAgentRunId: null, reconciliation: { confidence: "none", rule: "no_supported_parent_signal" } },
    },
  ],
  timeline: [
    { sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", event: "SessionStart", occurredAt: "2026-07-17T11:41:02.000Z", turnId: null, agentRunId: "agent-root-session-edge-017", evidence: exact },
    { sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", event: "TurnStarted", occurredAt: "2026-07-17T11:41:06.000Z", turnId: "turn-package", agentRunId: "agent-root-session-edge-017", evidence: exact },
    { sourceEventId: toolSuccessSource, event: "ToolCompleted", occurredAt: "2026-07-17T11:45:17.000Z", turnId: "turn-inspect-build", agentRunId: "agent-child-build", evidence: { ...exact, sourceEventIds: [toolSuccessSource] } },
    { sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", event: "PreCompact", occurredAt: "2026-07-17T11:53:45.000Z", turnId: "turn-package", agentRunId: "agent-root-session-edge-017", evidence: exact },
    { sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", event: "AgentStarted", occurredAt: "2026-07-17T11:55:31.000Z", turnId: "turn-package", agentRunId: "agent-child-package", evidence: inferred },
    { sourceEventId: toolFailureSource, event: "ToolFailed", occurredAt: "2026-07-17T12:02:14.000Z", turnId: "turn-write-output", agentRunId: "agent-child-package", evidence: { ...exact, sourceEventIds: [toolFailureSource] } },
    { sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7", event: "TurnCompleted", occurredAt: "2026-07-17T12:03:28.000Z", turnId: "turn-package", agentRunId: "agent-root-session-edge-017", evidence: exact },
  ],
  evidence: {
    tools: [
      {
        id: "tool-read-package",
        toolName: "exec_command",
        occurredAt: "2026-07-17T11:45:17.000Z",
        identifiers: { hookToolUseId: "tool_use_read_012", otelCallId: "call_read_012" },
        input: { cmd: "pnpm --filter @workspace/relay build" },
        result: { exitCode: 0, output: "build complete" },
        durationMs: 8221,
        outcome: "success",
        approval: "unavailable",
        retryCount: 0,
        turnAssociation: { turnId: "turn-inspect-build", strength: "exact_unstable", method: "codex_0_144_5_trace_parent" },
        evidence: { ...exact, sourceEventIds: [toolSuccessSource] },
        coverageGaps: ["approval_signal_unavailable"],
      },
      {
        id: "tool-write-dist",
        toolName: "exec_command",
        occurredAt: "2026-07-17T12:02:14.000Z",
        identifiers: { hookToolUseId: "tool_use_fail_017", otelCallId: "call_fail_017" },
        input: { cmd: "cp packages/relay/dist/index.js /workspace/dist/relay.js", cwd: "/workspace/relay" },
        result: { exitCode: 1, stderr: "permission denied: /workspace/dist" },
        durationMs: 146,
        outcome: "failure",
        approval: "approved",
        retryCount: 1,
        turnAssociation: { turnId: "turn-write-output", strength: "exact_unstable", method: "codex_0_144_5_trace_parent" },
        evidence: { ...exact, sourceEventIds: [toolFailureSource] },
        coverageGaps: ["hook_result_truncated_after_4kb"],
      },
    ],
    lifecycle: [
      { id: "life-compact", kind: "compaction", event: "PreCompact", occurredAt: "2026-07-17T11:53:45.000Z", details: { trigger: "auto" }, turnAssociation: { turnId: "turn-package", strength: "exact_unstable", method: "hook_turn_correlation" }, evidence: exact },
      { id: "life-skill", kind: "skill", event: "SKILL.md accessed", occurredAt: "2026-07-17T11:56:02.000Z", details: { path: "tdd/SKILL.md" }, turnAssociation: { turnId: "turn-package", strength: "inferred", method: "unique_turn_time_window" }, evidence: inferred },
    ],
    tokenUsage: [
      { id: "usage-017-1", occurredAt: "2026-07-17T11:41:10.000Z", sourceKind: "provider_completion", model: "gpt-5.6-sol", serviceTier: "priority", categories: { input: 18420, cachedInput: 16128, output: 740, reasoningOutput: 238, total: 19398 }, turnAssociation: { turnId: "turn-package", strength: "exact_unstable", method: "codex_0_144_5_trace_parent" }, evidence: exact },
      { id: "usage-017-2", occurredAt: "2026-07-17T12:02:22.000Z", sourceKind: "provider_completion", model: "gpt-5.6-sol", serviceTier: "priority", categories: { input: 91188, cachedInput: 78612, output: 1844, reasoningOutput: 921, total: 93953 }, turnAssociation: { turnId: "turn-write-output", strength: "exact_unstable", method: "codex_0_144_5_trace_parent" }, evidence: exact },
    ],
    context: {
      limits: [{ model: "gpt-5.6-sol", contextWindow: 200000, autoCompactionLimit: 168000, evidence: exact }],
      occupancy: [
        { tokenUsageId: "usage-017-1", occupancyTokens: 18420, occupancyPercent: 9.21, method: "provider_input_tokens_over_reported_context_window", inputs: { inputTokens: 18420, contextWindow: 200000 }, missingAssumptions: ["Provider input usage may differ from exact serialized Context."], evidence: inferred },
        { tokenUsageId: "usage-017-2", occupancyTokens: 91188, occupancyPercent: 45.594, method: "provider_input_tokens_over_reported_context_window", inputs: { inputTokens: 91188, contextWindow: 200000 }, missingAssumptions: ["Provider input usage may differ from exact serialized Context."], evidence: inferred },
      ],
      firstRequestBaseline: { tokenUsageId: "usage-017-1" },
      contribution: { status: "unavailable", method: "no_stable_passive_per_item_context_contract", note: "Per-item Context contribution is unavailable from captured evidence.", evidence: unavailable },
    },
    costEstimates: [{ tokenUsageId: "usage-017-2", status: "unavailable", amount: null, currency: null, reason: "No verified price mapping for observed model gpt-5.6-sol.", billingCaveat: "Not a provider bill." }],
    capabilities: [
      { capability: "explicit_skill_mention", state: "inferred", note: "SKILL.md access proves access, not workflow compliance.", evidence: inferred },
      { capability: "observed_mcp_use", state: "observed", note: "One configured MCP Tool was invoked in this Session.", evidence: exact },
      { capability: "complete_passive_capability_snapshot", state: "unavailable", note: "Complete passive capability inventory is unavailable from captured evidence.", evidence: unavailable },
    ],
  },
};

export function edgeDetailFor(id: string): SessionDetail {
  const selected = edgeActivity.items.find((item) => item.id === id) ?? failedSession;
  if (selected.id === failedSession.id) return failedSessionDetail;
  return {
    ...failedSessionDetail,
    session: selected,
    timeline: failedSessionDetail.timeline.slice(0, 3),
    evidence: { ...failedSessionDetail.evidence, tools: failedSessionDetail.evidence.tools.slice(0, 1) },
  };
}

export const edgeComparison: ComparisonResponse = {
  population: { selectedSessions: 2, distinctRealTurns: 5, seededTurns: 0 },
  syntheticInclusion: "excluded",
  completeness: { status: "partial", evidenceGaps: ["Cost unavailable for both observed models"] },
  subjects: [
    { selection: { scope: "session", sessionId: "session-edge-017" }, synthetic: "real", ownerDisplayName: "Mina Shah", outcome: "failed", reviewStatus: "needs_help", durationMs: 1346000, toolCount: 2, tokenTotal: 113351, modelChoices: ["gpt-5.6-sol"], completeness: { tokenUsage: "available", toolEvidence: "available", humanOutcome: "available" } },
    { selection: { scope: "session", sessionId: "session-edge-016" }, synthetic: "real", ownerDisplayName: "Diego Ruiz", outcome: "successful", reviewStatus: "exemplar", durationMs: 842000, toolCount: 5, tokenTotal: 78412, modelChoices: ["gpt-5.6-sol"], completeness: { tokenUsage: "available", toolEvidence: "available", humanOutcome: "available" } },
  ],
  citations: [{ id: "citation-edge-01", sessionId: "session-edge-017", turnId: "turn-write-output", synthetic: "real", links: { browser: "/?session=session-edge-017&turn=turn-write-output&activity=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4" } }],
  claim: { classification: "repeated_pattern", status: "supported", refusal: null, caveats: ["This comparison is descriptive and does not establish productivity or causation."] },
};
