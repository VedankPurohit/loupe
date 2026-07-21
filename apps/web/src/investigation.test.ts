import { describe, expect, it } from "vitest";

import {
  buildMapNodes,
  buildTurnNodes,
  evidenceState,
  modelEvidence,
  tokenCategorySummary,
  turnEvidence,
} from "./investigation.js";
import type { Evidence, ExecutionSessionDetail } from "@workspace/contracts";

const observed: Evidence = {
  stability: ["observed"],
  derivation: "exact",
  sourceEventIds: [],
} as const;

const unavailable: Evidence = {
  stability: ["unavailable"],
  derivation: "unavailable",
  sourceEventIds: [],
} as const;

function fixture(): ExecutionSessionDetail {
  return {
    session: {
      id: "session-test",
      organizationId: "organization-test",
      owner: { memberId: "member-test", displayName: "Test" },
      ownerProfile: { memberId: "member-test", displayName: "Test", isExample: false },
      activityState: "idle",
      firstObservedAt: "2026-01-01T00:00:00.000Z",
      lastObservedAt: "2026-01-01T00:01:00.000Z",
      rootAgentRunId: "agent-test",
      projectionVersion: "1",
      ownershipReconciliation: { inputs: [], rule: "test", selectedValue: "member-test", confidence: "high" },
      annotations: { outcome: "unknown", reviewStatus: "ordinary", tags: [], updatedAt: null },
      synthetic: { kind: "real", examplePackVersion: null },
      deepLink: "/?session=session-test",
      completion: { status: "not_assumed", evidence: "unavailable" },
      gitContext: null,
    },
    activities: [],
    turns: [{ id: "turn-test", agentRunId: "agent-test", firstObservedAt: "2026-01-01T00:00:01.000Z", lastObservedAt: "2026-01-01T00:00:10.000Z", evidence: observed }],
    agentRuns: [{ id: "agent-test", sessionId: "session-test", kind: "root", parentAgentRunId: null, parentEdge: null, agentType: "codex", firstObservedAt: "2026-01-01T00:00:00.000Z", lastObservedAt: "2026-01-01T00:01:00.000Z", identityEvidence: observed }],
    timeline: [],
    evidence: {
      tools: [{ id: "tool-test", toolName: "shell", occurredAt: "2026-01-01T00:00:02.000Z", identifiers: { hookToolUseId: null, otelCallId: null }, input: null, result: null, durationMs: null, outcome: "unknown", approval: "unavailable", retryCount: null, turnAssociation: { turnId: "turn-test", strength: "unavailable", method: "test" }, evidence: unavailable, coverageGaps: [] }],
      lifecycle: [],
      apiRequests: [],
      tokenUsage: [{ id: "token-test", occurredAt: "2026-01-01T00:00:03.000Z", sourceKind: "provider_completion", model: "gpt-test", serviceTier: null, categories: { input: 1, cachedInput: null, output: 2, reasoningOutput: null, total: 3 }, turnAssociation: { turnId: "turn-test", strength: "exact", method: "test" }, evidence: observed }],
      context: { limits: [], occupancy: [], firstRequestBaseline: null, contribution: { status: "unavailable", method: "test", note: "No contribution", evidence: unavailable } },
      costEstimates: [],
      capabilities: [],
    },
  } as unknown as ExecutionSessionDetail;
}

describe("investigation evidence helpers", () => {
  it("keeps Turn identity as a navigable map node and partitions associated evidence", () => {
    const detail = fixture();
    expect(buildTurnNodes(detail).some((node) => node.kind === "turn" && node.id === "turn-test")).toBe(true);
    expect(turnEvidence(detail, "turn-test").tools).toHaveLength(1);
    expect(turnEvidence(detail, "turn-test").tokenUsage[0]?.id).toBe("token-test");
  });

  it("keeps lifecycle events and provider API attempts as navigable evidence nodes", () => {
    const detail = fixture();
    detail.evidence.lifecycle = [{
      id: "lifecycle-test",
      kind: "resume",
      event: "session_resumed",
      occurredAt: "2026-01-01T00:00:04.000Z",
      details: { source: "controlled-test" },
      turnAssociation: { turnId: "turn-test", strength: "exact", method: "test" },
      evidence: observed,
    }];
    detail.evidence.apiRequests = [{
      id: "request-test",
      occurredAt: "2026-01-01T00:00:05.000Z",
      attempt: 2,
      statusCode: 429,
      durationMs: 41,
      success: false,
      error: "rate limited",
      turnAssociation: { turnId: "turn-test", strength: "exact", method: "test" },
      evidence: observed,
    }];

    expect(buildMapNodes(detail)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "lifecycle-test", kind: "lifecycle", label: "session_resumed", turnId: "turn-test" }),
      expect.objectContaining({ id: "request-test", kind: "apiRequest", label: "API attempt 2 · 429", turnId: "turn-test", outcome: "failure" }),
    ]));
  });

  it("does not collapse unavailable evidence into exact or numeric omissions", () => {
    const detail = fixture();
    expect(evidenceState(unavailable)).toBe("unavailable");
    expect(tokenCategorySummary(detail.evidence.tokenUsage[0]!)).toMatchObject({ cachedInput: "unavailable", total: 3 });
    expect(modelEvidence(detail, "turn-test").logicalModels).toEqual(["gpt-test"]);
    expect(modelEvidence(detail, "turn-test").caveat).toMatch(/transport attempts/);
  });
});
