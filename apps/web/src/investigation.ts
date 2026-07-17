import type { AgentRun, ExecutionSessionDetail, ToolEvidence } from "@workspace/contracts";

export type InvestigationTarget =
  | { kind: "session"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "activity"; id: string }
  | { kind: "tool"; id: string }
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
    ...detail.evidence.tools.map((tool) => tool.occurredAt),
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

export function buildMapNodes(detail: ExecutionSessionDetail): MapNode[] {
  const turnAgents = new Map(detail.turns.map((turn) => [turn.id, turn.agentRunId]));
  return [
    ...detail.timeline.map((event) => ({
      id: event.sourceEventId,
      kind: "activity" as const,
      label: event.event,
      occurredAt: event.occurredAt,
      agentRunId: event.agentRunId ?? detail.session.rootAgentRunId,
      evidence: event.evidence,
      turnId: event.turnId,
    })),
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

export function firstFailedTool(detail: ExecutionSessionDetail) {
  return detail.evidence.tools
    .filter((tool) => tool.outcome === "failure")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0];
}

export function targetMatches(left: InvestigationTarget, right: InvestigationTarget) {
  return left.kind === right.kind && left.id === right.id;
}
