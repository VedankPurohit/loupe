import type { Evidence, SessionDetail } from "./types";

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortId(value: string, length = 18): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

export function EvidenceChip({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  const unavailable = evidence.derivation === "unavailable";
  const primary = evidence.stability.includes("unstable") ? "unstable" : evidence.derivation;
  return (
    <span className={`evidence-chip evidence-${primary} ${compact ? "compact" : ""}`} title={`Stability: ${evidence.stability.join(", ")}; derivation: ${evidence.derivation}`}>
      <span aria-hidden="true" className="evidence-dot" />
      {unavailable ? "unavailable" : primary}
    </span>
  );
}

type AgentRun = SessionDetail["agentRuns"][number];

export function AgentTree({
  runs,
  selectedId,
  onSelect,
}: {
  runs: AgentRun[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const children = new Map<string, AgentRun[]>();
  for (const run of runs) {
    const parent = run.parentEdge?.parentAgentRunId;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), run]);
  }
  const roots = runs.filter((run) => run.kind === "root");
  const unresolved = runs.filter((run) => run.kind === "subagent" && !run.parentEdge?.parentAgentRunId);

  function Branch({ run, depth }: { run: AgentRun; depth: number }) {
    const nested = children.get(run.id) ?? [];
    const edge = run.parentEdge?.status ?? "root";
    return (
      <li className={`agent-branch edge-${edge}`}>
        <button
          type="button"
          className={selectedId === run.id ? "agent-node selected" : "agent-node"}
          onClick={() => onSelect(selectedId === run.id ? null : run.id)}
          style={{ "--depth": depth } as React.CSSProperties}
          aria-pressed={selectedId === run.id}
        >
          <span className="tree-joint" aria-hidden="true">{depth === 0 ? "◆" : edge === "exact" ? "├" : edge === "inferred" ? "┊" : "?"}</span>
          <span className="agent-copy">
            <strong>{run.agentType ?? (run.kind === "root" ? "Root agent" : "Subagent")}</strong>
            <code>{shortId(run.id, 24)}</code>
          </span>
          <EvidenceChip evidence={run.identityEvidence} compact />
        </button>
        {nested.length > 0 && <ul>{nested.map((child) => <Branch key={child.id} run={child} depth={depth + 1} />)}</ul>}
      </li>
    );
  }

  return (
    <div className="agent-tree">
      <button className="show-all" type="button" onClick={() => onSelect(null)} aria-pressed={selectedId === null}>All agents</button>
      <ul>{roots.map((root) => <Branch key={root.id} run={root} depth={0} />)}</ul>
      {unresolved.length > 0 && (
        <div className="unresolved-zone">
          <span>Unresolved parentage</span>
          <ul>{unresolved.map((run) => <Branch key={run.id} run={run} depth={0} />)}</ul>
        </div>
      )}
    </div>
  );
}
