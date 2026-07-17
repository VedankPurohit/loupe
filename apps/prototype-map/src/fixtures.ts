import type {
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

const exact = {
  stability: ["observed"],
  derivation: "exact",
  sourceEventIds: ["d47651b0-8ddf-4204-a951-81da494a85c1"],
} as const;

const inferred = {
  stability: ["observed", "inferred"],
  derivation: "inferred",
  sourceEventIds: ["6fba98cf-07c7-4ebf-853a-9f9fd97df14a"],
} as const;

const unavailable = {
  stability: ["unavailable"],
  derivation: "unavailable",
  sourceEventIds: [],
} as const;

function activitySession(
  id: string,
  owner: string,
  state: "live" | "idle" | "resumed",
  outcome: "successful" | "partial" | "failed" | "unknown",
  minutesAgo: number,
) {
  const last = new Date(Date.parse("2026-07-17T10:18:00Z") - minutesAgo * 60_000);
  return {
    id,
    owner: {
      memberId: "d383c54f-8214-42ad-a8f5-9f34f66de2da",
      deviceId: "b383c54f-8214-42ad-a8f5-9f34f66de2db",
      displayName: owner,
      isExample: false,
    },
    ownerProfile: { displayName: owner, isExample: false },
    gitContext: null,
    firstObservedAt: new Date(last.getTime() - 24 * 60_000).toISOString(),
    lastObservedAt: last.toISOString(),
    activityState: state,
    completion: { status: "not_assumed", evidence: "unavailable" },
    rootAgentRunId: `${id}:root`,
    projectionVersion: "1",
    ownershipReconciliation: {
      inputs: [],
      rule: "device_ownership_at_first_accept",
      selectedValue: owner,
      confidence: "high",
    },
    annotations: {
      outcome,
      reviewStatus: outcome === "failed" ? "needs_help" : "ordinary",
      tags: outcome === "failed" ? ["build", "typescript"] : [],
      updatedAt: "2026-07-17T10:19:00Z",
    },
    synthetic: { kind: "real", examplePackVersion: null },
    deepLink: `/?session=${id}`,
    repository: {
      repositoryRoot: "/work/acme/checkout",
      remoteIdentity: "github.com/acme/checkout",
      branch: outcome === "failed" ? "feat/retry-policy" : "main",
    },
  };
}

export const edgeActivity = {
  items: [
    activitySession("ses_7m3", "Mira Chen", "live", "failed", 0),
    activitySession("ses_4k2", "Dev Patel", "resumed", "partial", 9),
    activitySession("ses_8p1", "Ana Silva", "idle", "successful", 31),
    {
      ...activitySession("seed_1", "Example member", "idle", "unknown", 70),
      owner: {
        memberId: "a383c54f-8214-42ad-a8f5-9f34f66de2dc",
        deviceId: null,
        displayName: "Example member",
        isExample: true,
      },
      ownerProfile: { displayName: "Example member", isExample: true },
      synthetic: { kind: "seeded", examplePackVersion: "starter-v1" },
    },
  ],
  syntheticInclusion: "included",
  filters: { page: 1, pageSize: 40, includeSeeded: true },
  page: { page: 1, pageSize: 40, total: 4, hasMore: false, nextPage: null },
  aggregates: {
    sessions: 3,
    members: 3,
    repositories: 1,
    activityStates: { live: 1, idle: 1, resumed: 1 },
    outcomes: { successful: 1, partial: 1, failed: 1, unknown: 0 },
  },
  members: [
    {
      id: "d383c54f-8214-42ad-a8f5-9f34f66de2da",
      displayName: "Mira Chen",
      isExample: false,
      sessionCount: 1,
    },
  ],
  repositories: [{ identity: "github.com/acme/checkout", sessionCount: 3 }],
} as OrganizationActivityResponse;

const session = edgeActivity.items[0]!;

export const edgeDetail = {
  session: {
    ...session,
    owner: {
      memberId: session.owner.memberId,
      deviceId: session.owner.deviceId,
    },
  },
  activities: [
    {
      id: "episode-1",
      source: "startup",
      state: "live",
      startedAt: "2026-07-17T09:54:00Z",
      endedAt: null,
      sourceEventId: "d47651b0-8ddf-4204-a951-81da494a85c1",
    },
  ],
  turns: [
    {
      id: "turn-prepare",
      agentRunId: "ses_7m3:root",
      firstObservedAt: "2026-07-17T09:55:00Z",
      lastObservedAt: "2026-07-17T10:08:00Z",
      evidence: exact,
    },
    {
      id: "turn-verify",
      agentRunId: "ses_7m3:tests",
      firstObservedAt: "2026-07-17T10:03:00Z",
      lastObservedAt: "2026-07-17T10:17:00Z",
      evidence: inferred,
    },
    {
      id: "turn-docs",
      agentRunId: "ses_7m3:docs",
      firstObservedAt: "2026-07-17T10:05:00Z",
      lastObservedAt: "2026-07-17T10:13:00Z",
      evidence: exact,
    },
  ],
  agentRuns: [
    {
      id: "ses_7m3:root",
      kind: "root",
      codexThreadId: "019f6f79-root",
      agentType: "implementation",
      firstObservedAt: "2026-07-17T09:54:00Z",
      lastObservedAt: "2026-07-17T10:18:00Z",
      identityEvidence: exact,
      parentEdge: null,
    },
    {
      id: "ses_7m3:tests",
      kind: "subagent",
      codexThreadId: "019f6f79-tests",
      agentType: "test treatment",
      firstObservedAt: "2026-07-17T10:02:00Z",
      lastObservedAt: "2026-07-17T10:17:00Z",
      identityEvidence: inferred,
      parentEdge: {
        status: "inferred",
        parentAgentRunId: "ses_7m3:root",
        reconciliation: {
          inputs: [],
          rule: "agent_message_time_correlation",
          selectedValue: "ses_7m3:root",
          confidence: "medium",
        },
      },
    },
    {
      id: "ses_7m3:docs",
      kind: "subagent",
      codexThreadId: "019f6f79-docs",
      agentType: "documentation",
      firstObservedAt: "2026-07-17T10:04:00Z",
      lastObservedAt: "2026-07-17T10:13:00Z",
      identityEvidence: exact,
      parentEdge: {
        status: "exact",
        parentAgentRunId: "ses_7m3:root",
        reconciliation: {
          inputs: [],
          rule: "source_reported_parent",
          selectedValue: "ses_7m3:root",
          confidence: "high",
        },
      },
    },
  ],
  timeline: [
    {
      sourceEventId: "d47651b0-8ddf-4204-a951-81da494a85c1",
      event: "Turn began",
      occurredAt: "2026-07-17T09:55:00Z",
      turnId: "turn-prepare",
      agentRunId: "ses_7m3:root",
      evidence: exact,
    },
    {
      sourceEventId: "6fba98cf-07c7-4ebf-853a-9f9fd97df14a",
      event: "Subagent delegated",
      occurredAt: "2026-07-17T10:02:00Z",
      turnId: "turn-prepare",
      agentRunId: "ses_7m3:tests",
      evidence: inferred,
    },
    {
      sourceEventId: "267970de-5149-41a7-96bf-10d2798a2d88",
      event: "Context compacted",
      occurredAt: "2026-07-17T10:12:00Z",
      turnId: "turn-prepare",
      agentRunId: "ses_7m3:root",
      evidence: exact,
    },
  ],
  evidence: {
    tools: [
      {
        id: "tool-read-spec",
        toolName: "filesystem.read",
        occurredAt: "2026-07-17T09:57:00Z",
        identifiers: { hookToolUseId: "hook-11", otelCallId: "call-91" },
        input: { path: "src/retry-policy.ts" },
        result: { bytes: 4812 },
        durationMs: 42,
        outcome: "success",
        approval: "approved",
        retryCount: 0,
        turnAssociation: {
          turnId: "turn-prepare",
          strength: "exact",
          method: "hook_turn_id",
        },
        evidence: exact,
        coverageGaps: [],
      },
      {
        id: "tool-failed-shell",
        toolName: "shell.command",
        occurredAt: "2026-07-17T10:09:00Z",
        identifiers: { hookToolUseId: "hook-17", otelCallId: "call-97" },
        input: { command: "pnpm typecheck" },
        result: { exitCode: 2, summary: "TS2322 at retry-policy.ts:84" },
        durationMs: 2148,
        outcome: "failure",
        approval: "approved",
        retryCount: 1,
        turnAssociation: {
          turnId: "turn-verify",
          strength: "exact_unstable",
          method: "otel_turn_correlation",
        },
        evidence: inferred,
        coverageGaps: ["logical_retry_identity_unavailable"],
      },
      {
        id: "tool-patch",
        toolName: "filesystem.patch",
        occurredAt: "2026-07-17T10:14:00Z",
        identifiers: { hookToolUseId: "hook-19", otelCallId: null },
        input: { path: "src/retry-policy.ts", lines: "78–91" },
        result: { changed: true },
        durationMs: 87,
        outcome: "success",
        approval: "approved",
        retryCount: null,
        turnAssociation: {
          turnId: "turn-prepare",
          strength: "exact",
          method: "hook_turn_id",
        },
        evidence: exact,
        coverageGaps: [],
      },
    ],
    lifecycle: [
      {
        id: "life-compact",
        kind: "compaction",
        event: "Context compacted",
        occurredAt: "2026-07-17T10:12:00Z",
        details: { reason: "auto_compaction_limit" },
        turnAssociation: {
          turnId: "turn-prepare",
          strength: "exact",
          method: "hook_turn_id",
        },
        evidence: exact,
      },
      {
        id: "life-skill",
        kind: "skill",
        event: "tdd explicitly mentioned",
        occurredAt: "2026-07-17T09:56:00Z",
        details: { skill: "tdd" },
        turnAssociation: {
          turnId: "turn-prepare",
          strength: "inferred",
          method: "content_mention",
        },
        evidence: inferred,
      },
    ],
    tokenUsage: [
      {
        id: "tokens-1",
        occurredAt: "2026-07-17T09:59:00Z",
        sourceKind: "provider_completion",
        model: "gpt-5.6",
        serviceTier: "priority",
        categories: {
          input: 41800,
          cachedInput: 28900,
          output: 2100,
          reasoningOutput: 1200,
          total: 45100,
        },
        turnAssociation: {
          turnId: "turn-prepare",
          strength: "exact_unstable",
          method: "trace_span",
        },
        evidence: inferred,
      },
      {
        id: "tokens-2",
        occurredAt: "2026-07-17T10:16:00Z",
        sourceKind: "provider_completion",
        model: "gpt-5.6",
        serviceTier: "priority",
        categories: {
          input: 187300,
          cachedInput: 121400,
          output: 4800,
          reasoningOutput: 3600,
          total: 195700,
        },
        turnAssociation: {
          turnId: "turn-prepare",
          strength: "exact_unstable",
          method: "trace_span",
        },
        evidence: inferred,
      },
    ],
    context: {
      limits: [
        {
          model: "gpt-5.6",
          contextWindow: 200000,
          autoCompactionLimit: 180000,
          evidence: exact,
        },
      ],
      occupancy: [
        {
          tokenUsageId: "tokens-1",
          occupancyTokens: 41800,
          occupancyPercent: 20.9,
          method: "provider_input_tokens_over_reported_context_window",
          inputs: { inputTokens: 41800, contextWindow: 200000 },
          missingAssumptions: ["Per-item contribution unavailable."],
          evidence: inferred,
        },
        {
          tokenUsageId: "tokens-2",
          occupancyTokens: 187300,
          occupancyPercent: 93.65,
          method: "provider_input_tokens_over_reported_context_window",
          inputs: { inputTokens: 187300, contextWindow: 200000 },
          missingAssumptions: ["Provider cache semantics not exposed."],
          evidence: inferred,
        },
      ],
      firstRequestBaseline: {
        tokenUsageId: "tokens-1",
        occupancyTokens: 41800,
        occupancyPercent: 20.9,
        method: "provider_input_tokens_over_reported_context_window",
        inputs: { inputTokens: 41800, contextWindow: 200000 },
        missingAssumptions: [],
        evidence: inferred,
      },
      contribution: {
        status: "unavailable",
        method: "not_reported_by_source",
        note: "Per-item Context contribution is not emitted by this producer.",
        evidence: unavailable,
      },
    },
    costEstimates: [],
    capabilities: [
      {
        capability: "explicit_skill_mention",
        state: "observed",
        note: "The tdd skill was explicitly mentioned in captured content.",
        evidence: inferred,
      },
      {
        capability: "complete_passive_capability_snapshot",
        state: "unavailable",
        note: "The producer does not expose a complete passive capability snapshot.",
        evidence: unavailable,
      },
    ],
  },
} as unknown as ExecutionSessionDetail;

export function fixtureDetailFor(sessionId: string) {
  const selected = edgeActivity.items.find((item) => item.id === sessionId);
  if (!selected) return edgeDetail;
  return {
    ...edgeDetail,
    session: {
      ...edgeDetail.session,
      ...selected,
      owner: {
        memberId: selected.owner.memberId,
        deviceId: selected.owner.deviceId,
      },
    },
  } as ExecutionSessionDetail;
}
