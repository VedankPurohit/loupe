import type { ExecutionSessionDetail } from "@workspace/contracts";

export type InvestigationTarget =
  | { kind: "session"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "activity"; id: string }
  | { kind: "tool"; id: string }
  | { kind: "token"; id: string };

/** Public interaction seam: `F` follows the earliest failed Tool in the selected Session. */
export function followFailureFromActivity(
  detail: ExecutionSessionDetail,
): InvestigationTarget | null {
  const failure = detail.evidence.tools
    .filter((tool) => tool.outcome === "failure")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0];

  return failure ? { kind: "tool", id: failure.id } : null;
}

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
  return { start, end: end === start ? start + 1 : end };
}

export function timePercent(occurredAt: string, detail: ExecutionSessionDetail) {
  const { start, end } = investigationBounds(detail);
  return Math.max(
    0,
    Math.min(100, ((new Date(occurredAt).getTime() - start) / (end - start)) * 100),
  );
}
