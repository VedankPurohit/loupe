import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AgentRun,
  AuthenticatedSessionResponse,
  ComparisonResponse,
  ExecutionSessionDetail,
  LiveExecutionEvent,
  OrganizationActivityResponse,
} from "@workspace/contracts";

import {
  buildMapNodes,
  firstFailedTool,
  type InvestigationTarget,
  targetMatches,
  timePercent,
} from "./investigation.js";

type LiveStatus = "connecting" | "connected" | "interrupted";
type Evidence = AgentRun["identityEvidence"];
type MutationError = {
  message: string;
  retryLabel: string;
  retry: () => void | Promise<void>;
};

function words(value: string) {
  return value.replaceAll("_", " ");
}

function title(value: string) {
  const text = words(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clock(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-7)}` : value;
}

function evidenceText(evidence: Evidence) {
  return `${evidence.stability.map((value, index) => index === 0 ? title(value) : value).join(", ")} · ${evidence.derivation}`;
}

function EvidenceMark({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  const text = evidenceText(evidence);
  return (
    <span className={`fidelity fidelity-${evidence.derivation}`} title={text}>
      <span aria-hidden="true" className="fidelity-dot" />
      {compact ? <span className="sr-only">Evidence: {text}</span> : text}
    </span>
  );
}

function ProvenanceFootnote({ evidence, label = "Provenance" }: { evidence: Evidence; label?: string }) {
  return (
    <details className="provenance-footnote">
      <summary>{label} · {evidence.derivation}</summary>
      <p>{evidenceText(evidence)}.</p>
      {evidence.sourceEventIds.length ? (
        <ul>{evidence.sourceEventIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
      ) : (
        <p>No source-event identifier is available for this derived view.</p>
      )}
    </details>
  );
}

function json(value: unknown) {
  return value === null ? "Unavailable from captured evidence" : JSON.stringify(value, null, 2);
}

function operationFailure(operation: string, cause: unknown) {
  console.error(`${operation} failed:`, cause);
  const reason =
    cause instanceof Error && !(cause instanceof TypeError) && cause.message.trim().length > 0
      ? cause.message.trim().replace(/([^.!?])$/, "$1.")
      : "The server could not be reached.";
  return `${operation} failed. ${reason} Check the connection and try again.`;
}

const relayRedactionPlaceholders = [
  "[REDACTED:openai_api_key]",
  "[REDACTED:github_personal_access_token]",
  "[REDACTED:aws_access_key_id]",
  "[REDACTED:slack_token]",
  "[REDACTED:google_api_key]",
  "[REDACTED:stripe_secret_key]",
  "[REDACTED:gitlab_personal_access_token]",
  "[REDACTED:npm_access_token]",
  "[REDACTED:pem_private_key]",
  "[REDACTED:demo_canary]",
] as const;

function containsRelayRedactionPlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    return relayRedactionPlaceholders.some((placeholder) => value.includes(placeholder));
  }
  if (Array.isArray(value)) return value.some(containsRelayRedactionPlaceholder);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsRelayRedactionPlaceholder);
  }
  return false;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new TypeError("The server could not be reached.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    throw new Error(body?.error?.message ?? `Evidence request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function sessionRepository(session: OrganizationActivityResponse["items"][number]) {
  return session.repository.remoteIdentity ?? session.repository.branch ?? "Repository unavailable";
}

function parentLabel(agent: AgentRun) {
  if (agent.kind === "root") return "Root agent run";
  if (!agent.parentEdge || agent.parentEdge.status === "unresolved") return "Unresolved parent";
  return `${title(agent.parentEdge.status)} parent`;
}

function OrganizationRail({
  activity,
  selectedId,
  selectedForComparison,
  onOpen,
  onToggleComparison,
}: {
  activity?: OrganizationActivityResponse;
  selectedId?: string;
  selectedForComparison: string[];
  onOpen: (id: string) => void;
  onToggleComparison: (id: string) => void;
}) {
  return (
    <aside className="organization-rail" aria-labelledby="activity-field-title">
      <header className="rail-heading">
        <div>
          <span className="section-code">Organization / activity</span>
          <h2 id="activity-field-title">Activity field</h2>
        </div>
        <strong>{activity?.page.total ?? "—"}</strong>
      </header>
      {activity && (
        <div className="aggregate-tape" aria-label="Organization activity summary">
          <span><b>{activity.aggregates.activityStates.live}</b> live</span>
          <span><b>{activity.aggregates.outcomes.failed}</b> failed</span>
          <span><b>{activity.aggregates.members}</b> members</span>
        </div>
      )}
      <div className="session-stack">
        {activity?.items.map((session) => (
          <article className={`session-slip ${selectedId === session.id ? "is-selected" : ""}`} key={session.id}>
            <button
              aria-current={selectedId === session.id ? "page" : undefined}
              className="session-open"
              onClick={() => onOpen(session.id)}
              type="button"
            >
              <span className={`activity-lamp state-${session.activityState}`} aria-hidden="true" />
              <span>
                <strong>{session.owner.displayName}</strong>
                <small>{sessionRepository(session)}</small>
                <code>{shortId(session.id)}</code>
              </span>
              <time dateTime={session.lastObservedAt}>{clock(session.lastObservedAt)}</time>
            </button>
            <footer>
              <span>{title(session.annotations.outcome)}</span>
              {session.synthetic.kind === "seeded" && <b className="seeded-label">Seeded</b>}
              {session.owner.isExample && <b className="seeded-label">Example member</b>}
              <label>
                <input
                  aria-label={`Compare ${session.id}`}
                  checked={selectedForComparison.includes(session.id)}
                  onChange={() => onToggleComparison(session.id)}
                  type="checkbox"
                />
                Compare
              </label>
            </footer>
          </article>
        ))}
      </div>
      {activity?.items.length === 0 && (
        <div className="rail-empty">
          <strong>No Sessions match this evidence search.</strong>
          <span>Clear the query or include Seeded examples.</span>
        </div>
      )}
    </aside>
  );
}

function ExecutionMap({
  detail,
  target,
  cursor,
  onTarget,
}: {
  detail: ExecutionSessionDetail;
  target: InvestigationTarget;
  cursor: number;
  onTarget: (target: InvestigationTarget) => void;
}) {
  const lanes = detail.agentRuns;
  const nodes = buildMapNodes(detail);
  const yFor = (agentId: string) =>
    112 + Math.max(0, lanes.findIndex(({ id }) => id === agentId)) * 126;
  const height = Math.max(410, 220 + (lanes.length - 1) * 126);

  return (
    <div className="execution-viewport" aria-label="Spatial execution topology">
      <div className="execution-canvas" style={{ height }}>
        <div className="time-ruler" aria-hidden="true">
          <span>Session start</span><span>25%</span><span>50%</span><span>75%</span><span>Latest</span>
        </div>
        <svg aria-hidden="true" className="tracks" preserveAspectRatio="none" viewBox={`0 0 1080 ${height}`}>
          {lanes.map((lane) => {
            const y = yFor(lane.id);
            const start = lane.kind === "root" ? 178 : 178 + timePercent(lane.firstObservedAt, detail) * 7.7;
            const parentY = lane.parentEdge?.parentAgentRunId
              ? yFor(lane.parentEdge.parentAgentRunId)
              : y;
            return (
              <g className={`track track-${lane.parentEdge?.status ?? "exact"}`} key={lane.id}>
                {lane.kind === "subagent" && (
                  <path d={`M ${start} ${parentY} C ${start + 34} ${parentY}, ${start - 34} ${y}, ${start} ${y}`} />
                )}
                <line x1={start} x2="1015" y1={y} y2={y} />
              </g>
            );
          })}
        </svg>

        {lanes.map((lane) => {
          const selected = target.kind === "agent" && target.id === lane.id;
          const edge = parentLabel(lane);
          const runLabel = lane.kind === "root" ? "Root agent run" : "Subagent run";
          return (
            <button
              aria-label={`${runLabel}, ${lane.agentType ?? shortId(lane.id)}, ${edge}, ${lane.identityEvidence.derivation} evidence`}
              aria-pressed={selected}
              className={`lane-label ${selected ? "is-selected" : ""}`}
              key={lane.id}
              onClick={() => onTarget({ kind: "agent", id: lane.id })}
              style={{ top: yFor(lane.id) - 34 }}
              type="button"
            >
              <span>{runLabel}</span>
              <strong>{lane.agentType ?? shortId(lane.id)}</strong>
              <small>{edge}</small>
            </button>
          );
        })}

        {nodes.map((node) => {
          const position = timePercent(node.occurredAt, detail);
          const selected = target.kind === node.kind && target.id === node.id;
          return (
            <button
              aria-label={`${title(node.kind)}: ${node.label}; ${node.evidence.derivation} evidence${node.outcome === "failure" ? "; failed" : ""}`}
              aria-pressed={selected}
              className={`map-node node-${node.kind} fidelity-border-${node.evidence.derivation} ${node.outcome === "failure" ? "node-failure" : ""} ${selected ? "is-selected" : ""} ${position > cursor ? "is-future" : ""}`}
              key={`${node.kind}-${node.id}`}
              onClick={() => onTarget({ kind: node.kind, id: node.id })}
              style={{ left: `${18 + position * 0.76}%`, top: yFor(node.agentRunId) - 18 }}
              title={`${clock(node.occurredAt)} · ${node.label}`}
              type="button"
            >
              <i aria-hidden="true" />
              <span>{node.label}</span>
            </button>
          );
        })}
        <div className="time-scanline" aria-hidden="true" style={{ left: `${18 + cursor * 0.76}%` }}>
          <span>{Math.round(cursor)}%</span>
        </div>
      </div>
    </div>
  );
}

function AgentTree({
  detail,
  target,
  onTarget,
}: {
  detail: ExecutionSessionDetail;
  target: InvestigationTarget;
  onTarget: (target: InvestigationTarget) => void;
}) {
  const agentsById = new Map(detail.agentRuns.map((agent) => [agent.id, agent]));
  const childrenByParent = new Map<string, AgentRun[]>();
  const nestedAgentIds = new Set<string>();
  for (const agent of detail.agentRuns) {
    const parentId = agent.parentEdge?.parentAgentRunId;
    if (!parentId || !agentsById.has(parentId) || agent.parentEdge?.status === "unresolved") continue;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), agent]);
    nestedAgentIds.add(agent.id);
  }
  const topLevelAgents = detail.agentRuns.filter((agent) => !nestedAgentIds.has(agent.id));

  const agentItem = (agent: AgentRun): ReactNode => {
    const selected = target.kind === "agent" && target.id === agent.id;
    const runLabel = agent.kind === "root" ? "Root agent run" : "Subagent run";
    const children = childrenByParent.get(agent.id) ?? [];
    return (
      <li key={agent.id}>
        <button
          aria-label={`${runLabel}, ${agent.agentType ?? shortId(agent.id)}, ${parentLabel(agent)}`}
          aria-pressed={selected}
          onClick={() => onTarget({ kind: "agent", id: agent.id })}
          type="button"
        >
          <span>{runLabel}</span>
          <strong>{agent.agentType ?? shortId(agent.id)}</strong>
          <small>{parentLabel(agent)}</small>
          <EvidenceMark evidence={agent.identityEvidence} />
        </button>
        {children.length > 0 && <ul>{children.map(agentItem)}</ul>}
      </li>
    );
  };

  return (
    <section className="linear-agent-tree" aria-labelledby="linear-tree-title">
      <header>
        <span className="section-code">Non-spatial fallback</span>
        <h3 id="linear-tree-title">Agent hierarchy</h3>
      </header>
      <ul aria-label="Agent run hierarchy">{topLevelAgents.map(agentItem)}</ul>
    </section>
  );
}

function LinearTimeline({
  detail,
  target,
  onTarget,
}: {
  detail: ExecutionSessionDetail;
  target: InvestigationTarget;
  onTarget: (target: InvestigationTarget) => void;
}) {
  const nodes = buildMapNodes(detail);
  return (
    <section className="linear-timeline" aria-label="Linear execution timeline">
      <header>
        <span className="section-code">Chronological route</span>
        <h3>Timeline and provenance</h3>
      </header>
      <ol>
        {nodes.map((node) => {
          const nodeTarget: InvestigationTarget = { kind: node.kind, id: node.id };
          const selected = targetMatches(target, nodeTarget);
          return (
            <li className={selected ? "is-selected" : ""} key={`${node.kind}-${node.id}`}>
              <button aria-current={selected ? "true" : undefined} onClick={() => onTarget(nodeTarget)} type="button">
                <time dateTime={node.occurredAt}>{clock(node.occurredAt)}</time>
                <span><b>{title(node.kind)}</b>{node.label}{node.turnId && <code>{node.turnId}</code>}</span>
                {node.outcome === "failure" && <strong className="failure-label">Failed</strong>}
                <EvidenceMark compact evidence={node.evidence} />
              </button>
              <ProvenanceFootnote evidence={node.evidence} />
            </li>
          );
        })}
      </ol>
      {!nodes.length && <p className="empty-note">No chronological evidence is available for this Session.</p>}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function EvidenceInspector({
  detail,
  target,
  headingRef,
  onFailure,
}: {
  detail: ExecutionSessionDetail;
  target: InvestigationTarget;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onFailure: (focus?: boolean) => void;
}) {
  const tool = target.kind === "tool" ? detail.evidence.tools.find(({ id }) => id === target.id) : undefined;
  const agent = target.kind === "agent" ? detail.agentRuns.find(({ id }) => id === target.id) : undefined;
  const activity = target.kind === "activity" ? detail.timeline.find(({ sourceEventId }) => sourceEventId === target.id) : undefined;
  const token = target.kind === "token" ? detail.evidence.tokenUsage.find(({ id }) => id === target.id) : undefined;
  const evidence = tool?.evidence ?? agent?.identityEvidence ?? activity?.evidence ?? token?.evidence ?? {
    stability: ["observed"] as const,
    derivation: "exact" as const,
    sourceEventIds: [],
  };
  const occupancy = detail.evidence.context.occupancy.at(-1);

  return (
    <aside className="evidence-inspector" aria-label="Evidence inspector" role="region">
      <header className="inspector-bar">
        <span>Evidence inspector</span>
        <EvidenceMark compact evidence={evidence} />
      </header>
      <div className="inspector-body">
        {tool && (
          <>
            <p className="eyebrow">{tool.outcome === "failure" ? "Failed Tool" : "Tool invocation"}</p>
            <h2 ref={headingRef} tabIndex={-1}>{tool.toolName}</h2>
            <code>{tool.id}</code>
            <dl className="inspector-facts">
              <Fact label="Outcome"><span className={tool.outcome === "failure" ? "ink-failure" : ""}>{title(tool.outcome)}</span></Fact>
              <Fact label="Occurred">{clock(tool.occurredAt)}</Fact>
              <Fact label="Duration">{tool.durationMs === null ? "Unavailable" : `${tool.durationMs} ms`}</Fact>
              <Fact label="Retries">{tool.retryCount ?? "Unavailable"}</Fact>
              <Fact label="Approval">{title(tool.approval)}</Fact>
              <Fact label="Turn association">{title(tool.turnAssociation.strength)}</Fact>
            </dl>
            {(containsRelayRedactionPlaceholder(tool.input) || containsRelayRedactionPlaceholder(tool.result)) && (
              <p className="redaction-label">Redacted content · capture policy preserved the evidence boundary</p>
            )}
            <section className="evidence-payload"><h3>Input</h3><pre>{json(tool.input)}</pre></section>
            <section className="evidence-payload"><h3>Result</h3><pre>{json(tool.result)}</pre></section>
            {!!tool.coverageGaps.length && <p className="coverage-gap">Coverage gap · {tool.coverageGaps.map(words).join(", ")}</p>}
          </>
        )}
        {agent && (
          <>
            <p className="eyebrow">{agent.kind === "root" ? "Root agent run" : "Subagent run"}</p>
            <h2 ref={headingRef} tabIndex={-1}>{agent.agentType ?? "Unlabelled agent"}</h2>
            <code>{agent.id}</code>
            <dl className="inspector-facts">
              <Fact label="Route">{agent.kind === "root" ? "Root" : "Delegated"}</Fact>
              <Fact label="Parent edge">{parentLabel(agent)}</Fact>
              <Fact label="Confidence">{agent.parentEdge?.reconciliation.confidence ?? "Exact root"}</Fact>
              <Fact label="First seen">{clock(agent.firstObservedAt)}</Fact>
            </dl>
            {agent.parentEdge && (
              <p className={`edge-note edge-${agent.parentEdge.status}`}>
                {title(agent.parentEdge.reconciliation.rule)}. This edge is {agent.parentEdge.status}; the map does not promote inference to fact.
              </p>
            )}
          </>
        )}
        {activity && (
          <>
            <p className="eyebrow">Causal activity</p>
            <h2 ref={headingRef} tabIndex={-1}>{title(activity.event)}</h2>
            <dl className="inspector-facts">
              <Fact label="Occurred">{clock(activity.occurredAt)}</Fact>
              <Fact label="Turn">{activity.turnId ?? "Unavailable"}</Fact>
              <Fact label="Agent run">{activity.agentRunId ? shortId(activity.agentRunId) : "Unavailable"}</Fact>
            </dl>
            <button className="failure-jump" onClick={() => onFailure(true)} type="button">Follow to first failed Tool <kbd>F</kbd></button>
          </>
        )}
        {token && (
          <>
            <p className="eyebrow">Provider Token usage</p>
            <h2 ref={headingRef} tabIndex={-1}>{token.categories.total?.toLocaleString() ?? "Unavailable"} tokens</h2>
            <dl className="inspector-facts">
              <Fact label="Input">{token.categories.input?.toLocaleString() ?? "Unavailable"}</Fact>
              <Fact label="Cached">{token.categories.cachedInput?.toLocaleString() ?? "Unavailable"}</Fact>
              <Fact label="Output">{token.categories.output?.toLocaleString() ?? "Unavailable"}</Fact>
              <Fact label="Model">{token.model ?? "Unavailable"}</Fact>
            </dl>
          </>
        )}
        {target.kind === "session" && (
          <>
            <p className="eyebrow">Selected Session</p>
            <h2 ref={headingRef} tabIndex={-1}>{detail.session.ownerProfile.displayName}</h2>
            <code>{detail.session.id}</code>
            <dl className="inspector-facts">
              <Fact label="Activity">{title(detail.session.activityState)}</Fact>
              <Fact label="Outcome">{title(detail.session.annotations.outcome)}</Fact>
              <Fact label="Routes">{detail.agentRuns.length}</Fact>
              <Fact label="Failed tools">{detail.evidence.tools.filter(({ outcome }) => outcome === "failure").length}</Fact>
            </dl>
            {detail.session.synthetic.kind === "seeded" && <p className="seeded-panel">Seeded Session · {detail.session.synthetic.examplePackVersion} · owned by an Example member</p>}
            <button className="failure-jump" disabled={!firstFailedTool(detail)} onClick={() => onFailure(true)} type="button">
              {firstFailedTool(detail) ? "Jump to first failed Tool" : "No failed Tool captured"} <kbd>F</kbd>
            </button>
          </>
        )}
        <ProvenanceFootnote evidence={evidence} label="Evidence provenance" />
      </div>
      <footer className="context-meter">
        <div aria-label={occupancy?.occupancyPercent == null ? "Context occupancy unavailable" : undefined}>
          <span>Context occupancy</span>
          <strong>{occupancy?.occupancyPercent == null ? "Unavailable" : `${occupancy.occupancyPercent.toFixed(1)}%`}</strong>
        </div>
        {occupancy?.occupancyPercent != null && (
          <meter aria-label={`Context occupancy ${occupancy.occupancyPercent.toFixed(1)}%`} max="100" min="0" value={occupancy.occupancyPercent} />
        )}
        <small>{detail.evidence.context.contribution.status === "unavailable" ? "Per-item contribution unavailable" : "Contribution estimated; inspect provenance"}</small>
      </footer>
    </aside>
  );
}

function EvidenceLedger({ detail }: { detail: ExecutionSessionDetail }) {
  const occupancy = new Map(
    detail.evidence.context.occupancy.map((sample) => [sample.tokenUsageId, sample]),
  );
  const cost = new Map(
    detail.evidence.costEstimates.map((estimate) => [estimate.tokenUsageId, estimate]),
  );
  return (
    <section className="evidence-ledger" aria-labelledby="evidence-ledger-title">
      <header>
        <span className="section-code">Progression and coverage</span>
        <h3 id="evidence-ledger-title">Token, Context, and capability evidence</h3>
      </header>
      <div className="progression-table" role="region" aria-label="Token and Context progression" tabIndex={0}>
        <table>
          <thead><tr><th>Observed</th><th>Model</th><th>Total Tokens</th><th>Context occupancy</th><th>Cost estimate</th><th>Fidelity</th></tr></thead>
          <tbody>
            {detail.evidence.tokenUsage.map((sample) => {
              const context = occupancy.get(sample.id);
              const estimate = cost.get(sample.id);
              return (
                <tr key={sample.id}>
                  <td><time dateTime={sample.occurredAt}>{clock(sample.occurredAt)}</time></td>
                  <td>{sample.model ?? "Unavailable"}</td>
                  <td>{sample.categories.total?.toLocaleString() ?? "Unavailable"}</td>
                  <td>{context?.occupancyPercent == null ? "Unavailable" : `${context.occupancyPercent.toFixed(1)}%`}</td>
                  <td>{estimate?.status === "estimated" && estimate.amount !== null ? `${estimate.amount} ${estimate.currency}` : "Unavailable"}</td>
                  <td><EvidenceMark evidence={sample.evidence} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!detail.evidence.tokenUsage.length && <p>Token and Context progression is unavailable for this Session.</p>}
      </div>
      <div className="coverage-columns">
        <div>
          <h4>Capability coverage</h4>
          {detail.evidence.capabilities.map((capability) => (
            <article key={capability.capability}>
              <span className={`capability-state capability-${capability.state}`}>{title(capability.state)}</span>
              <strong>{title(capability.capability)}</strong>
              <small>{capability.note}</small>
              <ProvenanceFootnote evidence={capability.evidence} />
            </article>
          ))}
          {!detail.evidence.capabilities.length && <p>Capability snapshot unavailable.</p>}
        </div>
        <div>
          <h4>Lifecycle evidence</h4>
          {detail.evidence.lifecycle.map((event) => (
            <article key={event.id}>
              <span>{title(event.kind)}</span>
              <strong>{event.event}</strong>
              <small>{clock(event.occurredAt)} · Turn {event.turnAssociation.turnId ?? "unavailable"}</small>
              <ProvenanceFootnote evidence={event.evidence} />
            </article>
          ))}
          {!detail.evidence.lifecycle.length && <p>No lifecycle evidence was captured.</p>}
        </div>
        <div>
          <h4>Relay-local Git sample</h4>
          {detail.session.gitContext ? (
            <article>
              <span>{title(detail.session.gitContext.status)}</span>
              <strong>{detail.session.gitContext.remoteIdentity ?? detail.session.gitContext.repositoryRoot ?? "Repository unavailable"}</strong>
              <small>{detail.session.gitContext.branch ?? "Branch unavailable"} · sampled {clock(detail.session.gitContext.sampledAt)}</small>
              <p>This relay-local observation is not proof of earlier Git state.</p>
            </article>
          ) : <p>Git context unavailable.</p>}
        </div>
      </div>
    </section>
  );
}

export function SessionInspector({ member }: { member: AuthenticatedSessionResponse["member"] }) {
  const parameters = useMemo(() => new URLSearchParams(window.location.search), []);
  const [activity, setActivity] = useState<OrganizationActivityResponse>();
  const [detail, setDetail] = useState<ExecutionSessionDetail>();
  const [target, setTarget] = useState<InvestigationTarget>();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [includeSeeded, setIncludeSeeded] = useState(parameters.get("includeSeeded") === "true");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparisonClaim, setComparisonClaim] = useState("The selected Sessions show a repeated Tool failure pattern.");
  const [comparisonKind, setComparisonKind] = useState<"pattern" | "outcome" | "causal" | "productivity">("pattern");
  const [comparison, setComparison] = useState<ComparisonResponse>();
  const [cursor, setCursor] = useState(100);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mutationError, setMutationError] = useState<MutationError>();
  const selectedSessionId = useRef(parameters.get("session") ?? undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const inspectorHeadingRef = useRef<HTMLHeadingElement>(null);

  const openSession = useCallback(async (sessionId: string) => {
    const sameSession = selectedSessionId.current === sessionId;
    selectedSessionId.current = sessionId;
    try {
      const next = await fetchJson<ExecutionSessionDetail>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
      setDetail(next);
      setTarget((current) => sameSession && current ? current : { kind: "session", id: sessionId });
      setCursor(100);
      const url = new URL(window.location.href);
      url.searchParams.set("session", sessionId);
      if (includeSeeded) url.searchParams.set("includeSeeded", "true");
      else url.searchParams.delete("includeSeeded");
      window.history.replaceState(null, "", url);
      setError(undefined);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Session could not be opened.");
      return false;
    }
  }, [includeSeeded]);

  const refresh = useCallback(async (fallbackSessionId?: string) => {
    try {
      const search = new URLSearchParams();
      if (submittedQuery.trim()) search.set("q", submittedQuery.trim());
      if (includeSeeded) search.set("includeSeeded", "true");
      const next = await fetchJson<OrganizationActivityResponse>(`/api/v1/organization/activity?${search}`);
      setActivity(next);
      const requested = selectedSessionId.current ?? fallbackSessionId;
      const sessionId = requested && next.items.some(({ id }) => id === requested) ? requested : next.items[0]?.id;
      if (sessionId) {
        await openSession(sessionId);
      } else {
        selectedSessionId.current = undefined;
        setDetail(undefined);
        setTarget(undefined);
        setError(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organization activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [includeSeeded, openSession, submittedQuery]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const stream = new EventSource("/api/v1/live", { withCredentials: true });
    stream.onopen = () => {
      setLiveStatus("connected");
      void refresh();
    };
    stream.onerror = () => {
      setLiveStatus("interrupted");
      void refresh();
    };
    const onUpdate = (message: MessageEvent) => {
      const event = JSON.parse(message.data) as LiveExecutionEvent;
      void refresh(event.sessionId);
    };
    stream.addEventListener("session.updated", onUpdate);
    return () => {
      stream.removeEventListener("session.updated", onUpdate);
      stream.close();
    };
  }, [refresh]);

  const followFailure = useCallback((focus = false) => {
    if (!detail) return;
    const failure = firstFailedTool(detail);
    if (!failure) return;
    setTarget({ kind: "tool", id: failure.id });
    setCursor(timePercent(failure.occurredAt, detail));
    const url = new URL(window.location.href);
    if (failure.turnAssociation.turnId) url.searchParams.set("turn", failure.turnAssociation.turnId);
    window.history.replaceState(null, "", url);
    if (focus) requestAnimationFrame(() => inspectorHeadingRef.current?.focus());
  }, [detail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const interactive = element.closest("input, textarea, select, button, a, summary, [contenteditable='true'], [role='tree'], [role='treeitem']");
      if (interactive) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        followFailure(true);
      } else if (["j", "k"].includes(event.key.toLowerCase()) && activity?.items.length) {
        event.preventDefault();
        const current = activity.items.findIndex(({ id }) => id === detail?.session.id);
        const delta = event.key.toLowerCase() === "j" ? 1 : -1;
        const next = activity.items[(current + delta + activity.items.length) % activity.items.length];
        if (next) void openSession(next.id);
      } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        setCursor((current) => Math.max(0, Math.min(100, current + (event.key === "ArrowRight" ? 4 : -4))));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activity, detail?.session.id, followFailure, openSession]);

  useEffect(() => {
    if (!detail) return;
    const deepLink = new URLSearchParams(window.location.search);
    const activityId = deepLink.get("activity");
    const turnId = deepLink.get("turn");
    const event = activityId
      ? detail.timeline.find(({ sourceEventId }) => sourceEventId === activityId)
      : turnId
        ? detail.timeline.find((item) => item.turnId === turnId)
        : undefined;
    if (event) setTarget({ kind: "activity", id: event.sourceEventId });
  }, [detail?.session.id]);

  const activeTarget = target ?? (detail ? { kind: "session" as const, id: detail.session.id } : undefined);
  const tokenTotals = detail?.evidence.tokenUsage.map((sample) => sample.categories.total) ?? [];
  const totalTokens = tokenTotals.length > 0 && tokenTotals.every((value): value is number => value !== null)
    ? tokenTotals.reduce((sum, value) => sum + value, 0)
    : null;

  async function annotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    await saveAnnotation(detail.session.id, {
      outcome: data.get("outcome"),
      reviewStatus: data.get("reviewStatus"),
      tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    });
  }

  async function saveAnnotation(sessionId: string, annotation: Record<string, unknown>) {
    try {
      await fetchJson(`/api/v1/sessions/${encodeURIComponent(sessionId)}/annotations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(annotation),
      });
      await refresh(sessionId);
      setMutationError(undefined);
    } catch (cause) {
      setMutationError({
        message: operationFailure("Saving the Session annotation", cause),
        retryLabel: "Try saving annotation",
        retry: () => saveAnnotation(sessionId, annotation),
      });
    }
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runComparison({
      selections: comparisonIds.map((sessionId) => ({ scope: "session" as const, sessionId })),
      filters: submittedQuery ? { q: submittedQuery } : {},
      includeSeeded,
      claim: { kind: comparisonKind, statement: comparisonClaim },
    });
  }

  async function runComparison(request: Record<string, unknown>) {
    try {
      setComparison(await fetchJson<ComparisonResponse>("/api/v1/comparisons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }));
      setMutationError(undefined);
      setError(undefined);
    } catch (cause) {
      setMutationError({
        message: operationFailure("Running the evidence comparison", cause),
        retryLabel: "Try comparison again",
        retry: () => runComparison(request),
      });
    }
  }

  return (
    <section className="investigation-shell" aria-label="Session investigation">
      <header className="investigation-masthead">
        <div>
          <span className="section-code">Loupe / execution cartography</span>
          <strong>{detail ? shortId(detail.session.id) : "Organization evidence"}</strong>
          <span>{detail?.session.ownerProfile.displayName ?? "Select a captured Session"}</span>
        </div>
        <p className={`live-status live-${liveStatus}`} role="status" aria-label="Live updates">
          <i aria-hidden="true" />
          {liveStatus === "connected" ? "Live updates connected" : liveStatus === "interrupted" ? "Live updates interrupted; reconnecting and refreshing through /api/v1" : "Connecting live updates"}
        </p>
      </header>

      <form className="command-deck" onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query); }}>
        <label className="search-field">
          <span>Find Session evidence</span>
          <div><input aria-label="Find Session evidence" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="error, tool, branch, member…" ref={searchRef} value={query} /><kbd>/</kbd></div>
        </label>
        <label className="seeded-toggle">
          <input checked={includeSeeded} onChange={(event) => setIncludeSeeded(event.currentTarget.checked)} type="checkbox" />
          Include clearly labelled Seeded examples
        </label>
        <button type="submit">Search activity</button>
      </form>

      {error && <div className="error-banner" role="alert"><strong>Evidence request failed</strong><span>{error}</span><button onClick={() => void refresh()} type="button">Try again</button></div>}
      {mutationError && <div className="error-banner" role="alert"><strong>Evidence update failed</strong><span>{mutationError.message}</span><button onClick={() => void mutationError.retry()} type="button">{mutationError.retryLabel}</button></div>}
      {loading && <p className="loading-state" role="status">Reading captured Organization evidence…</p>}

      <div className="investigation-grid">
        <OrganizationRail
          activity={activity}
          onOpen={(id) => void openSession(id)}
          onToggleComparison={(id) => setComparisonIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])}
          selectedForComparison={comparisonIds}
          selectedId={detail?.session.id}
        />

        <section className="map-stage" aria-labelledby="execution-topology-title">
          <header className="map-heading">
            <div><span className="section-code">Execution graph</span><h2 id="execution-topology-title">Execution topology</h2><p>Where did the run bend?</p></div>
            <div className="map-summary"><span><b>{detail?.agentRuns.length ?? 0}</b> routes</span><span><b>{detail?.evidence.tools.length ?? 0}</b> tools</span><span><b>{totalTokens?.toLocaleString() ?? "Unavailable"}</b> tokens</span></div>
          </header>
          {detail && (
            <div className="episode-tape" aria-label="Activity episodes">
              {detail.activities.map((episode) => (
                <span className={`episode-${episode.state}`} key={episode.id}>
                  <b>{title(episode.source)}</b>
                  {title(episode.state)} · {clock(episode.startedAt)}
                </span>
              ))}
            </div>
          )}
          <div className="legend" aria-label="Execution map legend">
            <span><i className="legend-shape shape-tool" />Tool</span>
            <span><i className="legend-shape shape-activity" />Activity</span>
            <span><i className="legend-shape shape-token" />Token sample</span>
            <EvidenceMark evidence={{ stability: ["observed"], derivation: "exact", sourceEventIds: [] }} />
            <EvidenceMark evidence={{ stability: ["inferred"], derivation: "inferred", sourceEventIds: [] }} />
            <EvidenceMark evidence={{ stability: ["unavailable"], derivation: "unavailable", sourceEventIds: [] }} />
          </div>
          {detail && activeTarget ? <ExecutionMap cursor={cursor} detail={detail} onTarget={setTarget} target={activeTarget} /> : <div className="map-empty"><strong>No execution graph to draw.</strong><span>Select a Session or adjust the activity search.</span></div>}
          <div className="scrubber">
            <button aria-label="Scan to Session start" onClick={() => setCursor(0)} type="button">|‹</button>
            <label><span>Time scan</span><input aria-label="Session time scan" max="100" min="0" onChange={(event) => setCursor(Number(event.currentTarget.value))} type="range" value={cursor} /></label>
            <button aria-label="Scan to latest evidence" onClick={() => setCursor(100)} type="button">›|</button>
            <output>{Math.round(cursor)}%</output>
          </div>
          <p className="keyboard-route"><span>Keyboard route</span><kbd>J/K</kbd> Session <i /> <kbd>F</kbd> failed Tool <i /> <kbd>←/→</kbd> scrub <i /> <kbd>/</kbd> search</p>
        </section>

        {detail && activeTarget ? <EvidenceInspector detail={detail} headingRef={inspectorHeadingRef} onFailure={followFailure} target={activeTarget} /> : <aside className="evidence-inspector inspector-empty">Select a Session to inspect evidence.</aside>}
      </div>

      {detail && activeTarget && (
        <div className="linear-fallback">
          <AgentTree detail={detail} onTarget={setTarget} target={activeTarget} />
          <LinearTimeline detail={detail} onTarget={setTarget} target={activeTarget} />
        </div>
      )}

      {detail && (
        <div className="investigation-tools">
          <EvidenceLedger detail={detail} />
          <section className="annotation-panel" aria-labelledby="annotation-title">
            <header><span className="section-code">Human assessment</span><h3 id="annotation-title">Session annotations</h3></header>
            <p>Outcome {title(detail.session.annotations.outcome)} · review {title(detail.session.annotations.reviewStatus)} · {detail.session.annotations.tags.length ? detail.session.annotations.tags.join(", ") : "no tags"}</p>
            {(member.role === "administrator" || member.id === detail.session.owner.memberId) && (
              <form onSubmit={annotate}>
                <label>Outcome<select defaultValue={detail.session.annotations.outcome} name="outcome"><option value="successful">Successful</option><option value="partial">Partial</option><option value="failed">Failed</option><option value="unknown">Unknown</option></select></label>
                <label>Review<select defaultValue={detail.session.annotations.reviewStatus} name="reviewStatus"><option value="exemplar">Exemplar</option><option value="needs_help">Needs help</option><option value="ordinary">Ordinary</option></select></label>
                <label>Tags<input defaultValue={detail.session.annotations.tags.join(", ")} name="tags" placeholder="comma separated" /></label>
                <button type="submit">Save annotation</button>
              </form>
            )}
          </section>

          <section className="comparison-panel" aria-labelledby="comparison-title">
            <header><span className="section-code">Cited evidence</span><h3 id="comparison-title">Comparison tray</h3></header>
            <form onSubmit={compare}>
              <label>Claim<input onChange={(event) => setComparisonClaim(event.currentTarget.value)} required value={comparisonClaim} /></label>
              <label>Claim type<select onChange={(event) => setComparisonKind(event.currentTarget.value as typeof comparisonKind)} value={comparisonKind}><option value="pattern">Pattern</option><option value="outcome">Outcome</option><option value="causal">Causal</option><option value="productivity">Productivity</option></select></label>
              <button disabled={!comparisonIds.length} type="submit">Compare {comparisonIds.length || "selected"}</button>
            </form>
            {comparison && (
              <div className="comparison-result" role="status">
                <strong>{title(comparison.claim.classification)}</strong>
                <p>{comparison.population.selectedSessions} Sessions · {comparison.population.distinctRealTurns} real Turns · completeness {comparison.completeness.status} · Seeded {words(comparison.syntheticInclusion)}</p>
                {comparison.claim.refusal && <p className="comparison-refusal">{comparison.claim.refusal.code}: {comparison.claim.refusal.message}</p>}
                {comparison.claim.caveats.map((caveat) => <small key={caveat}>{caveat}</small>)}
                <nav aria-label="Evidence citations">
                  {comparison.citations.map((citation, index) => <a href={citation.links.browser} key={citation.id}><sup>{index + 1}</sup>{citation.synthetic === "seeded" ? "Seeded · " : ""}{citation.sessionId} / {citation.turnId}</a>)}
                </nav>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
