export type Evidence = {
  stability: Array<"documented" | "observed" | "inferred" | "unstable" | "unavailable">;
  derivation: "exact" | "inferred" | "unavailable";
  sourceEventIds: string[];
};

export type Session = {
  id: string;
  owner: { memberId: string; deviceId: string | null; displayName?: string; isExample?: boolean };
  ownerProfile: { displayName: string; isExample: boolean };
  gitContext: null | {
    status: "available" | "unavailable";
    repositoryRoot?: string | null;
    remoteIdentity?: string | null;
    branch?: string | null;
    worktree?: string | null;
    commit?: string | null;
  };
  firstObservedAt: string;
  lastObservedAt: string;
  activityState: "live" | "idle" | "resumed";
  completion: { status: "not_assumed"; evidence: "unavailable" };
  rootAgentRunId: string;
  projectionVersion: "1";
  ownershipReconciliation: { rule: string; confidence: "high" | "medium" | "low" | "none" };
  annotations: {
    outcome: "successful" | "partial" | "failed" | "unknown";
    reviewStatus: "exemplar" | "needs_help" | "ordinary";
    tags: string[];
    updatedAt: string | null;
  };
  synthetic: { kind: "real" | "seeded"; examplePackVersion: string | null };
  deepLink: string;
  repository?: { repositoryRoot: string | null; remoteIdentity: string | null; branch: string | null };
};

export type ToolEvidence = {
  id: string;
  toolName: string;
  occurredAt: string;
  identifiers: { hookToolUseId: string | null; otelCallId: string | null };
  input: unknown | null;
  result: unknown | null;
  durationMs: number | null;
  outcome: "success" | "failure" | "unknown";
  approval: "approved" | "denied" | "requested" | "unavailable";
  retryCount: number | null;
  turnAssociation: { turnId: string | null; strength: "exact" | "exact_unstable" | "inferred" | "unavailable"; method: string };
  evidence: Evidence;
  coverageGaps: string[];
};

export type TokenUsage = {
  id: string;
  occurredAt: string;
  sourceKind: "provider_completion" | "turn_total";
  model: string | null;
  serviceTier: string | null;
  categories: { input: number | null; cachedInput: number | null; output: number | null; reasoningOutput: number | null; total: number | null };
  turnAssociation: ToolEvidence["turnAssociation"];
  evidence: Evidence;
};

export type SessionDetail = {
  session: Session;
  activities: Array<{ id: string; source: string; state: string; startedAt: string; endedAt: string | null; sourceEventId: string }>;
  turns: Array<{ id: string; agentRunId: string; firstObservedAt: string; lastObservedAt: string; evidence: Evidence }>;
  agentRuns: Array<{
    id: string;
    kind: "root" | "subagent";
    codexThreadId: string | null;
    agentType: string | null;
    firstObservedAt: string;
    lastObservedAt: string;
    identityEvidence: Evidence;
    parentEdge: null | { status: "exact" | "inferred" | "unresolved"; parentAgentRunId: string | null; reconciliation: { confidence: string; rule: string } };
  }>;
  timeline: Array<{ sourceEventId: string; event: string; occurredAt: string; turnId: string | null; agentRunId: string | null; evidence: Evidence }>;
  evidence: {
    tools: ToolEvidence[];
    lifecycle: Array<{ id: string; kind: string; event: string; occurredAt: string; details: Record<string, unknown>; turnAssociation: ToolEvidence["turnAssociation"]; evidence: Evidence }>;
    tokenUsage: TokenUsage[];
    context: {
      limits: Array<{ model: string | null; contextWindow: number | null; autoCompactionLimit: number | null; evidence: Evidence }>;
      occupancy: Array<{ tokenUsageId: string; occupancyTokens: number; occupancyPercent: number | null; method: string; inputs: { inputTokens: number; contextWindow: number | null }; missingAssumptions: string[]; evidence: Evidence }>;
      firstRequestBaseline: null | { tokenUsageId: string };
      contribution: { status: "estimated" | "unavailable"; method: string; note: string; evidence: Evidence };
    };
    costEstimates: Array<{ tokenUsageId: string; status: "estimated" | "unavailable"; amount: number | null; currency: string | null; reason: string | null; billingCaveat: string }>;
    capabilities: Array<{ capability: string; state: string; note: string; evidence: Evidence }>;
  };
};

export type ActivityResponse = {
  items: Session[];
  syntheticInclusion: "excluded" | "included";
  filters: Record<string, unknown>;
  page: { page: number; pageSize: number; total: number; hasMore: boolean; nextPage: number | null };
  aggregates: {
    sessions: number;
    members: number;
    repositories: number;
    activityStates: { live: number; idle: number; resumed: number };
    outcomes: { successful: number; partial: number; failed: number; unknown: number };
  };
  members: Array<{ id: string; displayName: string; isExample: boolean; sessionCount: number }>;
  repositories: Array<{ identity: string; sessionCount: number }>;
};

export type ComparisonResponse = {
  population: { selectedSessions: number; distinctRealTurns: number; seededTurns: number };
  syntheticInclusion: string;
  completeness: { status: "complete" | "partial" | "unavailable"; evidenceGaps: string[] };
  subjects: Array<{
    selection: { scope: "session" | "turn"; sessionId: string; turnId?: string };
    synthetic: "real" | "seeded";
    ownerDisplayName: string;
    outcome: string;
    reviewStatus: string;
    durationMs: number | null;
    toolCount: number;
    tokenTotal: number | null;
    modelChoices: string[];
    completeness: { tokenUsage: string; toolEvidence: string; humanOutcome: string };
  }>;
  citations: Array<{ id: string; sessionId: string; turnId: string; synthetic: string; links: { browser: string } }>;
  claim: { classification: string; status: "supported" | "refused"; refusal: null | { code: string; message: string }; caveats: string[] };
};

export type SearchFilters = {
  q: string;
  activityState: string;
  outcome: string;
  memberId: string;
  repository: string;
  tool: string;
  error: string;
  includeSeeded: boolean;
};
