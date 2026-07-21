import type {
  AgentRun,
  Evidence,
  ExecutionSessionDetail,
  TokenUsageSample,
  ToolEvidence,
} from "@workspace/contracts";

export type InvestigationTarget =
  | { kind: "session"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "turn"; id: string }
  | { kind: "activity"; id: string }
  | { kind: "tool"; id: string }
  | { kind: "lifecycle"; id: string }
  | { kind: "apiRequest"; id: string }
  | { kind: "token"; id: string };

export type MapNode = {
  id: string;
  kind: Exclude<InvestigationTarget["kind"], "session" | "agent">;
  label: string;
  occurredAt: string;
  agentRunId: string;
  evidence: AgentRun["identityEvidence"];
  outcome?: ToolEvidence["outcome"];
  turnId?: string | null;
};

export function investigationBounds(detail: ExecutionSessionDetail) {
  const values = [
    detail.session.firstObservedAt,
    detail.session.lastObservedAt,
    ...detail.timeline.map((event) => event.occurredAt),
    ...detail.turns.flatMap((turn) => [turn.firstObservedAt, turn.lastObservedAt]),
    ...detail.evidence.tools.map((tool) => tool.occurredAt),
    ...detail.evidence.lifecycle.map((event) => event.occurredAt),
    ...detail.evidence.apiRequests.map((request) => request.occurredAt),
    ...detail.evidence.tokenUsage.map((sample) => sample.occurredAt),
  ].map((value) => new Date(value).getTime());
  const start = Math.min(...values);
  const end = Math.max(...values);
  return { start, end: start === end ? start + 1 : end };
}

export function timePercent(occurredAt: string, detail: ExecutionSessionDetail) {
  const { start, end } = investigationBounds(detail);
  return Math.max(
    0,
    Math.min(100, ((new Date(occurredAt).getTime() - start) / (end - start)) * 100),
  );
}

export function timelineEventId(
  event: ExecutionSessionDetail["timeline"][number],
): string | null {
  if (event.sourceEventId) return event.sourceEventId;
  if (event.reference?.origin === "example_pack_server_controlled") {
    return event.reference.syntheticEvidenceId;
  }
  return event.reference?.sourceEventId ?? null;
}

export function buildMapNodes(detail: ExecutionSessionDetail): MapNode[] {
  const turnAgents = new Map(detail.turns.map((turn) => [turn.id, turn.agentRunId]));
  return [
    ...detail.timeline.flatMap((event) => {
      const id = timelineEventId(event);
      return id
        ? [{
            id,
            kind: "activity" as const,
            label: event.event,
            occurredAt: event.occurredAt,
            agentRunId: event.agentRunId ?? detail.session.rootAgentRunId,
            evidence: event.evidence,
            turnId: event.turnId,
          }]
        : [];
    }),
    ...detail.evidence.tools.map((tool) => ({
      id: tool.id,
      kind: "tool" as const,
      label: tool.toolName,
      occurredAt: tool.occurredAt,
      agentRunId:
        (tool.turnAssociation.turnId && turnAgents.get(tool.turnAssociation.turnId)) ??
        detail.session.rootAgentRunId,
      evidence: tool.evidence,
      outcome: tool.outcome,
      turnId: tool.turnAssociation.turnId,
    })),
    ...detail.evidence.lifecycle.map((event) => ({
      id: event.id,
      kind: "lifecycle" as const,
      label: event.event,
      occurredAt: event.occurredAt,
      agentRunId:
        (event.turnAssociation.turnId && turnAgents.get(event.turnAssociation.turnId)) ??
        detail.session.rootAgentRunId,
      evidence: event.evidence,
      turnId: event.turnAssociation.turnId,
    })),
    ...detail.evidence.apiRequests.map((request) => ({
      id: request.id,
      kind: "apiRequest" as const,
      label: `API attempt ${request.attempt ?? "unavailable"} · ${request.statusCode ?? "status unavailable"}`,
      occurredAt: request.occurredAt,
      agentRunId:
        (request.turnAssociation.turnId && turnAgents.get(request.turnAssociation.turnId)) ??
        detail.session.rootAgentRunId,
      evidence: request.evidence,
      outcome: request.success === false ? "failure" as const : request.success === true ? "success" as const : "unknown" as const,
      turnId: request.turnAssociation.turnId,
    })),
    ...detail.evidence.tokenUsage.map((sample) => ({
      id: sample.id,
      kind: "token" as const,
      label: `${sample.categories.total?.toLocaleString() ?? "Unavailable"} tokens`,
      occurredAt: sample.occurredAt,
      agentRunId:
        (sample.turnAssociation.turnId && turnAgents.get(sample.turnAssociation.turnId)) ??
        detail.session.rootAgentRunId,
      evidence: sample.evidence,
      turnId: sample.turnAssociation.turnId,
    })),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** Turn rows are kept separate from the activity/tool map so their provenance
 * does not duplicate an activity event that happens to share its evidence id. */
export function buildTurnNodes(detail: ExecutionSessionDetail): MapNode[] {
  return detail.turns.map((turn) => ({
    id: turn.id,
    kind: "turn" as const,
    label: `Turn ${turn.id}`,
    occurredAt: turn.firstObservedAt,
    agentRunId: turn.agentRunId,
    evidence: turn.evidence,
    turnId: turn.id,
  }));
}

export function buildInvestigationNodes(detail: ExecutionSessionDetail): MapNode[] {
  return [...buildMapNodes(detail), ...buildTurnNodes(detail)]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

export function firstFailedTool(detail: ExecutionSessionDetail) {
  return detail.evidence.tools
    .filter((tool) => tool.outcome === "failure")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0];
}

export function targetMatches(left: InvestigationTarget, right: InvestigationTarget) {
  return left.kind === right.kind && left.id === right.id;
}

/** A compact, stable label for the four evidence states used by browser and CLI. */
export function evidenceState(evidence: Evidence): "exact" | "inferred" | "unstable" | "unavailable" {
  if (evidence.derivation === "unavailable" || evidence.stability.includes("unavailable")) return "unavailable";
  if (evidence.stability.includes("unstable")) return "unstable";
  if (evidence.derivation === "inferred" || evidence.stability.includes("inferred")) return "inferred";
  return "exact";
}

export function turnEvidence(detail: ExecutionSessionDetail, turnId: string) {
  const matches = <T extends { turnAssociation: { turnId: string | null } }>(items: T[]) =>
    items.filter((item) => item.turnAssociation.turnId === turnId);
  const turn = detail.turns.find((item) => item.id === turnId);
  return {
    turn,
    tools: matches(detail.evidence.tools),
    apiRequests: matches(detail.evidence.apiRequests),
    tokenUsage: matches(detail.evidence.tokenUsage),
    lifecycle: matches(detail.evidence.lifecycle),
    capabilities: detail.evidence.capabilities,
  };
}

export function tokenCategorySummary(sample: TokenUsageSample): Record<string, number | "unavailable"> {
  return Object.fromEntries(
    Object.entries(sample.categories).map(([key, value]) => [key, value ?? "unavailable"]),
  );
}

export function modelEvidence(detail: ExecutionSessionDetail, turnId?: string) {
  const samples = turnId ? turnEvidence(detail, turnId).tokenUsage : detail.evidence.tokenUsage;
  const models = [...new Set(samples.map((sample) => sample.model).filter((model): model is string => Boolean(model)))];
  return {
    logicalModels: models,
    transportAttempts: turnId
      ? turnEvidence(detail, turnId).apiRequests
      : detail.evidence.apiRequests,
    caveat: "Provider transport attempts are not stable logical model requests.",
  };
}
