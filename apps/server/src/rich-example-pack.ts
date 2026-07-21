import { createHash } from "node:crypto";

import {
  ActivityEpisodeSchema,
  ApiRequestEvidenceSchema,
  CapabilityEvidenceSchema,
  ContextEvidenceSchema,
  ContextLimitSchema,
  ContextOccupancySchema,
  CostEstimateSchema,
  LifecycleEvidenceSchema,
  TimelineEventSchema,
  TokenUsageSampleSchema,
  ToolEvidenceSchema,
  type Evidence,
  type EvidenceReference,
  type ExecutionSessionDetail,
} from "@workspace/contracts";

export const richExamplePackVersion = "rich-v1" as const;
export const richExampleSessionId = "seeded-rich-v1-provenance-safe-00";
export const richExampleMemberName = "Ada Lovelace · Example";

export type RichExampleRecordKind =
  | "activity_episode"
  | "turn_evidence"
  | "agent_identity"
  | "timeline_event"
  | "tool"
  | "lifecycle"
  | "api_request"
  | "token_usage"
  | "context_limit"
  | "context_occupancy"
  | "context_contribution"
  | "cost_estimate"
  | "capability";

export type RichExampleEvidenceReference = Extract<
  EvidenceReference,
  { origin: "example_pack_server_controlled" }
> & { examplePackVersion: typeof richExamplePackVersion };

export type RichExampleEvidence = Omit<Evidence, "sourceEventIds" | "references"> & {
  sourceEventIds: [];
  references: RichExampleEvidenceReference[];
};

export interface RichExampleRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  packVersion: typeof richExamplePackVersion;
  recordKind: RichExampleRecordKind;
  ordinal: number;
  payload: Record<string, unknown>;
}

export interface RichExamplePackSeed {
  member: { id: string; displayName: typeof richExampleMemberName };
  session: {
    databaseId: string;
    canonicalId: typeof richExampleSessionId;
    firstObservedAt: Date;
    lastObservedAt: Date;
    activityState: "resumed";
    rootAgentRunId: string;
    searchText: string;
  };
  annotation: {
    id: string;
    outcome: "partial";
    reviewStatus: "needs_help";
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
    parentStatus: "exact" | null;
    parentAgentRunId: string | null;
    parentReconciliation: Record<string, unknown> | null;
  }>;
  records: RichExampleRecord[];
}

type StoredRichExampleRecord = Pick<RichExampleRecord, "ordinal"> & {
  recordKind: string;
  payload: unknown;
};

export function projectRichExampleDetail(
  records: StoredRichExampleRecord[],
): Pick<ExecutionSessionDetail, "activities" | "timeline" | "evidence"> {
  const payloads = (kind: RichExampleRecordKind) =>
    records
      .filter((record) => record.recordKind === kind)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((record) => record.payload);
  const occupancy = payloads("context_occupancy").map((payload) =>
    ContextOccupancySchema.parse(payload),
  );
  const contribution = payloads("context_contribution")[0];
  if (!contribution) {
    throw new Error("RICH_EXAMPLE_CONTEXT_CONTRIBUTION_MISSING");
  }
  return {
    activities: payloads("activity_episode").map((payload) =>
      ActivityEpisodeSchema.parse(payload),
    ),
    timeline: payloads("timeline_event").map((payload) =>
      TimelineEventSchema.parse(payload),
    ),
    evidence: {
      tools: payloads("tool").map((payload) => ToolEvidenceSchema.parse(payload)),
      lifecycle: payloads("lifecycle").map((payload) =>
        LifecycleEvidenceSchema.parse(payload),
      ),
      apiRequests: payloads("api_request").map((payload) =>
        ApiRequestEvidenceSchema.parse(payload),
      ),
      tokenUsage: payloads("token_usage").map((payload) =>
        TokenUsageSampleSchema.parse(payload),
      ),
      context: {
        limits: payloads("context_limit").map((payload) =>
          ContextLimitSchema.parse(payload),
        ),
        occupancy,
        firstRequestBaseline: occupancy[0] ?? null,
        contribution: ContextEvidenceSchema.shape.contribution.parse(contribution),
      },
      costEstimates: payloads("cost_estimate").map((payload) =>
        CostEstimateSchema.parse(payload),
      ),
      capabilities: payloads("capability").map((payload) =>
        CapabilityEvidenceSchema.parse(payload),
      ),
    },
  };
}

export function stableExampleUuid(
  organizationId: string,
  canonicalKey: string,
  recordKind: string,
  ordinal: number,
): string {
  const hex = createHash("sha256")
    .update(
      [
        "loupe-example",
        richExamplePackVersion,
        organizationId,
        canonicalKey,
        recordKind,
        String(ordinal),
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function buildProvenanceSafeRichExamplePack(
  organizationId: string,
): RichExamplePackSeed {
  const sessionKey = richExampleSessionId;
  const sessionDatabaseId = stableExampleUuid(organizationId, sessionKey, "session", 0);
  const rootAgentRunId = "example-agent-rich-v1-root-00";
  const childAgentRunId = "example-agent-rich-v1-review-00";
  const firstObservedAt = new Date("2026-06-08T09:00:00.000Z");
  const lastObservedAt = new Date("2026-06-08T09:19:00.000Z");
  const records: RichExampleRecord[] = [];
  const ordinalByKind = new Map<RichExampleRecordKind, number>();

  const addRecord = (
    recordKind: RichExampleRecordKind,
    buildPayload: (reference: RichExampleEvidenceReference) => Record<string, unknown>,
  ) => {
    const ordinal = ordinalByKind.get(recordKind) ?? 0;
    ordinalByKind.set(recordKind, ordinal + 1);
    const id = stableExampleUuid(organizationId, sessionKey, recordKind, ordinal);
    const reference: RichExampleEvidenceReference = {
      origin: "example_pack_server_controlled",
      examplePackVersion: richExamplePackVersion,
      syntheticEvidenceId: id,
    };
    records.push({
      id,
      organizationId,
      sessionId: sessionDatabaseId,
      packVersion: richExamplePackVersion,
      recordKind,
      ordinal,
      payload: buildPayload(reference),
    });
    return reference;
  };
  const evidence = (
    reference: RichExampleEvidenceReference,
    stability: RichExampleEvidence["stability"] = ["observed"],
    derivation: RichExampleEvidence["derivation"] = "exact",
  ): RichExampleEvidence => ({
    stability,
    derivation,
    sourceEventIds: [],
    references: [reference],
  });

  const rootIdentity = addRecord("agent_identity", (reference) => ({
    agentRunId: rootAgentRunId,
    evidence: evidence(reference),
  }));
  const childIdentity = addRecord("agent_identity", (reference) => ({
    agentRunId: childAgentRunId,
    evidence: evidence(reference),
  }));
  const firstTurnEvidence = addRecord("turn_evidence", (reference) => ({
    turnId: "example-turn-rich-v1-inspect-00",
    evidence: evidence(reference),
  }));
  const secondTurnEvidence = addRecord("turn_evidence", (reference) => ({
    turnId: "example-turn-rich-v1-review-00",
    evidence: evidence(reference, ["unavailable"], "unavailable"),
    coverageGap: "provider_turn_association_unavailable_in_this_example",
  }));

  addRecord("activity_episode", (reference) => ({
    id: "example-activity-rich-v1-startup-00",
    source: "startup",
    state: "resumed",
    startedAt: "2026-06-08T09:00:00.000Z",
    endedAt: "2026-06-08T09:19:00.000Z",
    sourceEventId: null,
    reference,
  }));
  addRecord("timeline_event", (reference) => ({
    sourceEventId: null,
    reference,
    event: "ExampleSessionStarted",
    occurredAt: "2026-06-08T09:00:00.000Z",
    turnId: "example-turn-rich-v1-inspect-00",
    agentRunId: rootAgentRunId,
    evidence: evidence(reference),
  }));
  addRecord("timeline_event", (reference) => ({
    sourceEventId: null,
    reference,
    event: "ExampleToolResultUnavailable",
    occurredAt: "2026-06-08T09:11:00.000Z",
    turnId: "example-turn-rich-v1-review-00",
    agentRunId: childAgentRunId,
    evidence: evidence(reference, ["unavailable"], "unavailable"),
  }));
  addRecord("tool", (reference) => ({
    id: "example-call-rich-v1-file-edit-00",
    toolName: "file_edit",
    occurredAt: "2026-06-08T09:04:00.000Z",
    identifiers: { hookToolUseId: null, otelCallId: null },
    input: {
      operation: "replace synthetic placeholder",
      path: "/examples/rich-v1/example-panel",
    },
    result: { status: "success", description: "synthetic example updated" },
    durationMs: 240,
    outcome: "success",
    approval: "approved",
    retryCount: 0,
    turnAssociation: {
      turnId: "example-turn-rich-v1-inspect-00",
      strength: "exact",
      method: "example_pack_server_controlled",
    },
    evidence: evidence(reference),
    coverageGaps: [],
  }));
  addRecord("tool", (reference) => ({
    id: "example-call-rich-v1-shell-00",
    toolName: "shell",
    occurredAt: "2026-06-08T09:11:00.000Z",
    identifiers: { hookToolUseId: null, otelCallId: null },
    input: { operation: "validate example-contract" },
    result: null,
    durationMs: null,
    outcome: "unknown",
    approval: "unavailable",
    retryCount: null,
    turnAssociation: {
      turnId: "example-turn-rich-v1-review-00",
      strength: "unavailable",
      method: "example_pack_deliberate_unavailable_state",
    },
    evidence: evidence(reference, ["unavailable"], "unavailable"),
    coverageGaps: ["tool_result_not_retained", "tool_duration_unavailable"],
  }));
  addRecord("lifecycle", (reference) => ({
    id: "example-lifecycle-rich-v1-skill-00",
    kind: "skill",
    event: "explicit_skill_mention",
    occurredAt: "2026-06-08T09:02:00.000Z",
    details: { skill: "example-accessibility-review" },
    turnAssociation: {
      turnId: "example-turn-rich-v1-inspect-00",
      strength: "exact",
      method: "example_pack_server_controlled",
    },
    evidence: evidence(reference),
  }));
  addRecord("api_request", (reference) => ({
    id: "example-request-rich-v1-schema-00",
    occurredAt: "2026-06-08T09:13:00.000Z",
    attempt: 1,
    statusCode: 422,
    durationMs: 85,
    success: false,
    error: "synthetic schema validation failed",
    turnAssociation: {
      turnId: "example-turn-rich-v1-review-00",
      strength: "exact",
      method: "example_pack_server_controlled",
    },
    evidence: evidence(reference),
  }));
  addRecord("token_usage", (reference) => ({
    id: "example-token-rich-v1-provider-00",
    occurredAt: "2026-06-08T09:08:00.000Z",
    sourceKind: "provider_completion",
    model: "gpt-5.6-codex",
    serviceTier: "example-standard",
    categories: {
      input: 1200,
      cachedInput: 200,
      output: 300,
      reasoningOutput: 100,
      total: 1800,
    },
    turnAssociation: {
      turnId: "example-turn-rich-v1-inspect-00",
      strength: "exact",
      method: "example_pack_server_controlled",
    },
    evidence: evidence(reference),
  }));
  addRecord("token_usage", (reference) => ({
    id: "example-token-rich-v1-unavailable-00",
    occurredAt: "2026-06-08T09:16:00.000Z",
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
      turnId: "example-turn-rich-v1-review-00",
      strength: "unavailable",
      method: "example_pack_deliberate_unavailable_state",
    },
    evidence: evidence(reference, ["unavailable"], "unavailable"),
  }));
  addRecord("context_limit", (reference) => ({
    model: "gpt-5.6-codex",
    contextWindow: 128000,
    autoCompactionLimit: 112000,
    evidence: evidence(reference),
  }));
  addRecord("context_occupancy", (reference) => ({
    tokenUsageId: "example-token-rich-v1-provider-00",
    occupancyTokens: 1200,
    occupancyPercent: 0.9375,
    method: "provider_input_tokens_over_reported_context_window",
    inputs: { inputTokens: 1200, contextWindow: 128000 },
    missingAssumptions: ["synthetic_context_item_contributions_not_exact"],
    evidence: evidence(reference, ["inferred"], "inferred"),
  }));
  addRecord("context_contribution", (reference) => ({
    status: "unavailable",
    method: "no_exact_per_item_context_contract",
    note: "Unavailable by design in this Seeded Example Session.",
    evidence: evidence(reference, ["unavailable"], "unavailable"),
  }));
  addRecord("cost_estimate", (reference) => ({
    tokenUsageId: "example-token-rich-v1-provider-00",
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
      uncachedInputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 300,
      reasoningOutputTokens: 100,
    },
    billingCaveat: "Illustrative Example-pack estimate; not provider billing evidence.",
    reason: null,
    evidence: evidence(reference, ["inferred"], "inferred"),
  }));
  addRecord("cost_estimate", (reference) => ({
    tokenUsageId: "example-token-rich-v1-unavailable-00",
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
    billingCaveat: "Unknown model and Token categories cannot produce a cost estimate.",
    reason: "unknown_model_and_token_categories",
    evidence: evidence(reference, ["unavailable"], "unavailable"),
  }));
  addRecord("capability", (reference) => ({
    capability: "explicit_skill_mention",
    state: "observed",
    note: "Example skill mention is present in the server-controlled template.",
    evidence: evidence(reference),
  }));
  addRecord("capability", (reference) => ({
    capability: "configured_mcp_servers",
    state: "conditional",
    note: "Example MCP configuration does not claim observed MCP use.",
    evidence: evidence(reference, ["inferred"], "inferred"),
  }));
  addRecord("capability", (reference) => ({
    capability: "complete_passive_capability_snapshot",
    state: "unavailable",
    note: "A complete passive capability snapshot is unavailable.",
    evidence: evidence(reference, ["unavailable"], "unavailable"),
  }));

  return {
    member: {
      id: stableExampleUuid(organizationId, richExampleMemberName, "member", 0),
      displayName: richExampleMemberName,
    },
    session: {
      databaseId: sessionDatabaseId,
      canonicalId: richExampleSessionId,
      firstObservedAt,
      lastObservedAt,
      activityState: "resumed",
      rootAgentRunId,
      searchText:
        "Seeded Example rich-v1 accessibility file edit shell schema validation unavailable context capability",
    },
    annotation: {
      id: stableExampleUuid(organizationId, sessionKey, "annotation", 0),
      outcome: "partial",
      reviewStatus: "needs_help",
      tags: ["Example", "Seeded", "accessibility", "unavailable"],
      updatedAt: new Date("2026-06-08T09:19:00.000Z"),
    },
    turns: [
      {
        id: stableExampleUuid(organizationId, sessionKey, "turn", 0),
        canonicalTurnId: "example-turn-rich-v1-inspect-00",
        agentRunId: rootAgentRunId,
        firstObservedAt: new Date("2026-06-08T09:01:00.000Z"),
        lastObservedAt: new Date("2026-06-08T09:09:00.000Z"),
        evidence: evidence(firstTurnEvidence),
      },
      {
        id: stableExampleUuid(organizationId, sessionKey, "turn", 1),
        canonicalTurnId: "example-turn-rich-v1-review-00",
        agentRunId: childAgentRunId,
        firstObservedAt: new Date("2026-06-08T09:10:00.000Z"),
        lastObservedAt: new Date("2026-06-08T09:18:00.000Z"),
        evidence: evidence(secondTurnEvidence, ["unavailable"], "unavailable"),
      },
    ],
    agentRuns: [
      {
        id: stableExampleUuid(organizationId, sessionKey, "agent_run", 0),
        publicId: rootAgentRunId,
        kind: "root",
        codexThreadId: "example-thread-rich-v1-root-00",
        agentType: "implementation",
        firstObservedAt,
        lastObservedAt,
        identityEvidence: evidence(rootIdentity),
        parentStatus: null,
        parentAgentRunId: null,
        parentReconciliation: null,
      },
      {
        id: stableExampleUuid(organizationId, sessionKey, "agent_run", 1),
        publicId: childAgentRunId,
        kind: "subagent",
        codexThreadId: "example-thread-rich-v1-review-00",
        agentType: "review",
        firstObservedAt: new Date("2026-06-08T09:10:00.000Z"),
        lastObservedAt: new Date("2026-06-08T09:18:00.000Z"),
        identityEvidence: evidence(childIdentity),
        parentStatus: "exact",
        parentAgentRunId: rootAgentRunId,
        parentReconciliation: {
          inputs: [],
          rule: "example_pack_server_controlled_hierarchy",
          selectedValue: rootAgentRunId,
          confidence: "high",
        },
      },
    ],
    records,
  };
}
