import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AgentRun,
  ComparisonResponse,
  ExecutionSessionDetail,
  OrganizationActivityResponse,
  ToolEvidence,
} from "@workspace/contracts";

import { compareEvidence, loadOrganizationActivity, loadSessionDetail } from "./api";
import { edgeActivity, fixtureDetailFor } from "./fixtures";
import {
  followFailureFromActivity,
  type InvestigationTarget,
  timePercent,
} from "./investigation";

type LiveState = "connected" | "connecting" | "interrupted" | "fixture";

function words(value: string) {
  return value.replaceAll("_", " ");
}

function clock(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

type Evidence = AgentRun["identityEvidence"];

function EvidenceMark({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  const label = `${evidence.derivation}; ${evidence.stability.join(", ")}`;
  return (
    <span className={`fidelity fidelity--${evidence.derivation}`} title={label}>
      <span aria-hidden="true" />
      {!compact && label}
      <span className="sr-only">Evidence: {label}</span>
    </span>
  );
}

function OrganizationMiniMap({ activity }: { activity?: OrganizationActivityResponse }) {
  const items = activity?.items ?? [];
  return (
    <div className="org-minimap" aria-label="Organization activity mini-map">
      <div className="org-minimap__track" />
      {items.slice(0, 12).map((item, index) => (
        <span
          aria-label={`${item.owner.displayName}, ${item.activityState}`}
          className={`org-minimap__dot state--${item.activityState}`}
          key={item.id}
          style={{ left: `${10 + ((index * 29) % 82)}%`, top: `${18 + ((index * 47) % 62)}%` }}
        />
      ))}
    </div>
  );
}

function SessionRail({
  activity,
  selectedId,
  compareIds,
  onOpen,
  onToggleCompare,
}: {
  activity?: OrganizationActivityResponse;
  selectedId?: string;
  compareIds: string[];
  onOpen: (id: string) => void;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <div className="session-stack" aria-label="Organization Sessions">
      {activity?.items.map((item) => (
        <article
          className={`session-slip ${selectedId === item.id ? "session-slip--selected" : ""}`}
          key={item.id}
        >
          <button className="session-slip__open" onClick={() => onOpen(item.id)}>
            <span className={`activity-lamp state--${item.activityState}`} />
            <span>
              <strong>{item.owner.displayName}</strong>
              <small>{item.repository.branch ?? "Repository unavailable"}</small>
            </span>
            <time dateTime={item.lastObservedAt}>{clock(item.lastObservedAt)}</time>
          </button>
          <div className="session-slip__meta">
            <span>{words(item.annotations.outcome)}</span>
            {item.synthetic.kind === "seeded" && <b>Seeded</b>}
            <label>
              <input
                aria-label={`Compare ${item.owner.displayName} Session`}
                checked={compareIds.includes(item.id)}
                onChange={() => onToggleCompare(item.id)}
                type="checkbox"
              />
              compare
            </label>
          </div>
        </article>
      ))}
    </div>
  );
}

type MapNode = {
  id: string;
  kind: InvestigationTarget["kind"];
  label: string;
  occurredAt: string;
  agentRunId: string;
  evidence: Evidence;
  outcome?: ToolEvidence["outcome"];
};

function buildMapNodes(detail: ExecutionSessionDetail): MapNode[] {
  const turnAgent = new Map(detail.turns.map((turn) => [turn.id, turn.agentRunId]));
  return [
    // Synthetic timeline entries carry no backing source event, so they have no
    // stable identity to select or key by on the map; only project targetable ones.
    ...detail.timeline.flatMap((event) =>
      event.sourceEventId === null
        ? []
        : [
            {
              id: event.sourceEventId,
              kind: "activity" as const,
              label: event.event,
              occurredAt: event.occurredAt,
              agentRunId: event.agentRunId ?? detail.session.rootAgentRunId,
              evidence: event.evidence,
            },
          ],
    ),
    ...detail.evidence.tools.map((tool) => ({
      id: tool.id,
      kind: "tool" as const,
      label: tool.toolName,
      occurredAt: tool.occurredAt,
      agentRunId:
        (tool.turnAssociation.turnId && turnAgent.get(tool.turnAssociation.turnId)) ??
        detail.session.rootAgentRunId,
      evidence: tool.evidence,
      outcome: tool.outcome,
    })),
    ...detail.evidence.tokenUsage.map((sample) => ({
      id: sample.id,
      kind: "token" as const,
      label: `${sample.categories.total?.toLocaleString() ?? "?"} tokens`,
      occurredAt: sample.occurredAt,
      agentRunId:
        (sample.turnAssociation.turnId && turnAgent.get(sample.turnAssociation.turnId)) ??
        detail.session.rootAgentRunId,
      evidence: sample.evidence,
    })),
  ];
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
  const yFor = (agentId: string) => 114 + Math.max(0, lanes.findIndex(({ id }) => id === agentId)) * 132;
  const height = Math.max(410, 230 + (lanes.length - 1) * 132);

  return (
    <div className="execution-viewport">
      <div className="execution-canvas" style={{ height }}>
        <div className="time-ruler" aria-hidden="true">
          <span>start</span><span>+6m</span><span>+12m</span><span>now</span>
        </div>
        <svg aria-hidden="true" className="tracks" preserveAspectRatio="none" viewBox={`0 0 1000 ${height}`}>
          <defs>
            <pattern id="inferred-track" height="8" patternUnits="userSpaceOnUse" width="8">
              <path d="M0 8L8 0" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          {lanes.map((lane, index) => {
            const y = yFor(lane.id);
            const start = lane.kind === "root" ? 160 : 160 + timePercent(lane.firstObservedAt, detail) * 7.2;
            const parentIndex = lanes.findIndex(({ id }) => id === lane.parentEdge?.parentAgentRunId);
            const parentY = parentIndex < 0 ? y : 114 + parentIndex * 132;
            return (
              <g className={`track track--${lane.identityEvidence.derivation}`} key={lane.id}>
                {lane.kind === "subagent" && <path d={`M ${start} ${parentY} C ${start + 28} ${parentY}, ${start - 28} ${y}, ${start} ${y}`} />}
                <line x1={start} x2="930" y1={y} y2={y} />
              </g>
            );
          })}
        </svg>

        {lanes.map((lane) => (
          <button
            className={`lane-label ${target.kind === "agent" && target.id === lane.id ? "is-selected" : ""}`}
            key={lane.id}
            onClick={() => onTarget({ kind: "agent", id: lane.id })}
            style={{ top: yFor(lane.id) - 34 }}
          >
            <span>{lane.kind === "root" ? "ROOT" : "SUB"}</span>
            <strong>{lane.agentType ?? lane.kind}</strong>
            <EvidenceMark compact evidence={lane.identityEvidence} />
          </button>
        ))}

        {nodes.map((node) => {
          const position = timePercent(node.occurredAt, detail);
          const beyondCursor = position > cursor;
          const selected = target.kind === node.kind && target.id === node.id;
          return (
            <button
              aria-label={`${node.kind}: ${node.label}, ${node.evidence.derivation} evidence${node.outcome === "failure" ? ", failed" : ""}`}
              className={`map-node map-node--${node.kind} fidelity-border--${node.evidence.derivation} ${node.outcome === "failure" ? "map-node--failure" : ""} ${selected ? "is-selected" : ""} ${beyondCursor ? "is-future" : ""}`}
              key={`${node.kind}-${node.id}`}
              onClick={() => onTarget({ kind: node.kind, id: node.id })}
              style={{ left: `${18 + position * 0.74}%`, top: yFor(node.agentRunId) - 19 }}
              title={`${clock(node.occurredAt)} · ${node.label}`}
            >
              <span className="map-node__shape" aria-hidden="true" />
              <span className="map-node__label">{node.label}</span>
            </button>
          );
        })}

        <div className="time-scanline" style={{ left: `${18 + cursor * 0.74}%` }}>
          <span>{Math.round(cursor)}%</span>
        </div>

        <div className="map-minimap" aria-label="Execution map overview">
          {lanes.map((lane, index) => <i key={lane.id} style={{ top: 8 + index * 9 }} />)}
          <b style={{ left: `${cursor}%` }} />
        </div>
      </div>
    </div>
  );
}

function TargetInspector({
  detail,
  target,
  onFailure,
}: {
  detail: ExecutionSessionDetail;
  target: InvestigationTarget;
  onFailure: () => void;
}) {
  const tool = target.kind === "tool" ? detail.evidence.tools.find(({ id }) => id === target.id) : undefined;
  const agent = target.kind === "agent" ? detail.agentRuns.find(({ id }) => id === target.id) : undefined;
  const activity = target.kind === "activity" ? detail.timeline.find(({ sourceEventId }) => sourceEventId === target.id) : undefined;
  const token = target.kind === "token" ? detail.evidence.tokenUsage.find(({ id }) => id === target.id) : undefined;
  const latestOccupancy = detail.evidence.context.occupancy.at(-1);
  const selectedEvidence = tool?.evidence ?? agent?.identityEvidence ?? activity?.evidence ?? token?.evidence ?? {
    stability: ["observed"] as const,
    derivation: "exact" as const,
    sourceEventIds: [],
  };

  return (
    <aside className="inspector" aria-live="polite" aria-label="Evidence inspector">
      <header>
        <span>Evidence lens</span>
        <EvidenceMark evidence={selectedEvidence} compact />
      </header>

      {tool && (
        <div className="inspector__body failure-card">
          <p className="eyebrow">{tool.outcome === "failure" ? "Failed Tool" : "Tool invocation"}</p>
          <h2>{tool.toolName}</h2>
          <code>{tool.id}</code>
          <dl>
            <div><dt>Outcome</dt><dd className={tool.outcome === "failure" ? "ink-failure" : ""}>{tool.outcome}</dd></div>
            <div><dt>Occurred</dt><dd>{clock(tool.occurredAt)}</dd></div>
            <div><dt>Duration</dt><dd>{tool.durationMs === null ? "Unavailable" : `${tool.durationMs} ms`}</dd></div>
            <div><dt>Retries</dt><dd>{tool.retryCount ?? "Unavailable"}</dd></div>
            <div><dt>Turn link</dt><dd>{words(tool.turnAssociation.strength)}</dd></div>
          </dl>
          <section>
            <h3>What went in</h3>
            <pre>{tool.input === null ? "Unavailable" : JSON.stringify(tool.input, null, 2)}</pre>
          </section>
          <section>
            <h3>What came back</h3>
            <pre>{tool.result === null ? "Unavailable" : JSON.stringify(tool.result, null, 2)}</pre>
          </section>
          {tool.coverageGaps.length > 0 && <p className="coverage-gap">Coverage gap · {tool.coverageGaps.map(words).join(", ")}</p>}
        </div>
      )}

      {agent && (
        <div className="inspector__body">
          <p className="eyebrow">{agent.kind} agent run</p>
          <h2>{agent.agentType ?? "Unlabelled agent"}</h2>
          <code>{agent.id}</code>
          <dl>
            <div><dt>First seen</dt><dd>{clock(agent.firstObservedAt)}</dd></div>
            <div><dt>Last seen</dt><dd>{clock(agent.lastObservedAt)}</dd></div>
            <div><dt>Parent edge</dt><dd>{agent.parentEdge?.status ?? "Root"}</dd></div>
            <div><dt>Confidence</dt><dd>{agent.parentEdge?.reconciliation.confidence ?? "Exact root"}</dd></div>
          </dl>
        </div>
      )}

      {activity && (
        <div className="inspector__body">
          <p className="eyebrow">Causal activity</p>
          <h2>{activity.event}</h2>
          <dl>
            <div><dt>Occurred</dt><dd>{clock(activity.occurredAt)}</dd></div>
            <div><dt>Turn</dt><dd>{activity.turnId ?? "Unavailable"}</dd></div>
            <div><dt>Agent</dt><dd>{activity.agentRunId ? shortId(activity.agentRunId) : "Unavailable"}</dd></div>
          </dl>
          <button className="follow-failure" onClick={onFailure}>Follow to failed Tool <kbd>F</kbd></button>
        </div>
      )}

      {token && (
        <div className="inspector__body">
          <p className="eyebrow">Provider Token usage</p>
          <h2>{token.categories.total?.toLocaleString() ?? "Unavailable"} tokens</h2>
          <dl>
            <div><dt>Input</dt><dd>{token.categories.input?.toLocaleString() ?? "Unavailable"}</dd></div>
            <div><dt>Cached</dt><dd>{token.categories.cachedInput?.toLocaleString() ?? "Unavailable"}</dd></div>
            <div><dt>Output</dt><dd>{token.categories.output?.toLocaleString() ?? "Unavailable"}</dd></div>
            <div><dt>Model</dt><dd>{token.model ?? "Unavailable"}</dd></div>
          </dl>
        </div>
      )}

      {target.kind === "session" && (
        <div className="inspector__body">
          <p className="eyebrow">Selected Session</p>
          <h2>{detail.session.ownerProfile.displayName}</h2>
          <code>{detail.session.id}</code>
          <dl>
            <div><dt>State</dt><dd>{detail.session.activityState}</dd></div>
            <div><dt>Outcome</dt><dd>{detail.session.annotations.outcome}</dd></div>
            <div><dt>Agent runs</dt><dd>{detail.agentRuns.length}</dd></div>
            <div><dt>Failed tools</dt><dd>{detail.evidence.tools.filter(({ outcome }) => outcome === "failure").length}</dd></div>
          </dl>
          <button className="follow-failure" onClick={onFailure}>Jump to failed Tool <kbd>F</kbd></button>
        </div>
      )}

      <footer className="context-meter">
        <div>
          <span>Context occupancy</span>
          <strong>{latestOccupancy?.occupancyPercent === null || latestOccupancy === undefined ? "Unavailable" : `${latestOccupancy.occupancyPercent.toFixed(1)}%`}</strong>
        </div>
        <meter max="100" min="0" value={latestOccupancy?.occupancyPercent ?? 0} />
        <small>{detail.evidence.context.contribution.status === "unavailable" ? "Per-item contribution unavailable" : "Estimated contribution"}</small>
      </footer>
    </aside>
  );
}

export default function App() {
  const fixtureMode = new URLSearchParams(window.location.search).get("fixture") === "edge";
  const [activity, setActivity] = useState<OrganizationActivityResponse>();
  const [detail, setDetail] = useState<ExecutionSessionDetail>();
  const [target, setTarget] = useState<InvestigationTarget>();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonResponse>();
  const [fixtureComparison, setFixtureComparison] = useState<string>();
  const [cursor, setCursor] = useState(100);
  const [live, setLive] = useState<LiveState>(fixtureMode ? "fixture" : "connecting");
  const [error, setError] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);

  const openSession = useCallback(async (id: string) => {
    try {
      const nextDetail = fixtureMode ? fixtureDetailFor(id) : await loadSessionDetail(id);
      setDetail(nextDetail);
      setTarget({ kind: "session", id });
      setCursor(100);
      const url = new URL(window.location.href);
      url.searchParams.set("session", id);
      window.history.replaceState(null, "", url);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Session could not be opened.");
    }
  }, [fixtureMode]);

  const refresh = useCallback(async (search = submittedQuery) => {
    try {
      const nextActivity = fixtureMode
        ? ({
            ...edgeActivity,
            items: edgeActivity.items.filter((item) =>
              `${item.owner.displayName} ${item.repository.branch} ${item.annotations.tags.join(" ")}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ),
          } as OrganizationActivityResponse)
        : await loadOrganizationActivity(search);
      setActivity(nextActivity);
      const requested = new URLSearchParams(window.location.search).get("session");
      const id = requested && nextActivity.items.some((item) => item.id === requested)
        ? requested
        : nextActivity.items[0]?.id;
      if (id) await openSession(id);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Organization activity could not be loaded.");
    }
  }, [fixtureMode, openSession, submittedQuery]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (fixtureMode) return;
    const stream = new EventSource("/api/v1/live", { withCredentials: true });
    stream.onopen = () => setLive("connected");
    stream.onerror = () => setLive("interrupted");
    const onUpdate = () => { void refresh(); };
    stream.addEventListener("session.updated", onUpdate);
    return () => {
      stream.removeEventListener("session.updated", onUpdate);
      stream.close();
    };
  }, [fixtureMode, refresh]);

  const followFailure = useCallback(() => {
    if (!detail) return;
    const next = followFailureFromActivity(detail);
    if (!next) return;
    setTarget(next);
    const tool = detail.evidence.tools.find(({ id }) => id === next.id);
    if (tool) setCursor(timePercent(tool.occurredAt, detail));
  }, [detail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const editable = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.isContentEditable;
      if (editable) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        followFailure();
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

  const selectedSessionId = detail?.session.id;
  const activeTarget = target ?? (selectedSessionId ? { kind: "session" as const, id: selectedSessionId } : undefined);
  const failureCount = activity?.items.filter(({ annotations }) => annotations.outcome === "failed").length ?? 0;
  const totalTokens = useMemo(
    () => detail?.evidence.tokenUsage.reduce((total, sample) => total + (sample.categories.total ?? 0), 0) ?? 0,
    [detail],
  );

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query);
  }

  async function runComparison() {
    if (!compareIds.length) return;
    if (fixtureMode) {
      setFixtureComparison(`${compareIds.length} Sessions selected · descriptive only · Seeded evidence remains visibly labelled.`);
      return;
    }
    try {
      setComparison(await compareEvidence({
        selections: compareIds.map((sessionId) => ({ scope: "session", sessionId })),
        filters: submittedQuery ? { q: submittedQuery } : {},
        includeSeeded: false,
        claim: {
          kind: "pattern",
          statement: "Selected Sessions show a repeated Tool failure pattern.",
          signals: ["tool_count", "correlation"],
        },
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Comparison failed.");
    }
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="wordmark"><span>LOUPE</span><small>execution cartography / prototype</small></div>
        <div className="masthead__session">
          <span className={`activity-lamp state--${detail?.session.activityState ?? "idle"}`} />
          <strong>{detail ? shortId(detail.session.id) : "No Session"}</strong>
          <span>{detail?.session.ownerProfile.displayName ?? "Waiting for activity"}</span>
        </div>
        <div className="live-indicator"><i className={`live--${live}`} />{live === "fixture" ? "EDGE FIXTURE" : `API ${live}`}</div>
      </header>

      {fixtureMode && (
        <div className="fixture-banner" role="status">
          <strong>EDGE FIXTURE MODE</strong>
          Deterministic synthetic investigation data. Remove <code>?fixture=edge</code> to use authenticated, real <code>/api/v1</code> evidence.
        </div>
      )}

      <div className="workspace">
        <aside className="organization-rail">
          <div className="rail-heading">
            <div><span>Organization</span><h1>Activity field</h1></div>
            <b>{activity?.page.total ?? 0}</b>
          </div>
          <OrganizationMiniMap activity={activity} />
          <form className="search" onSubmit={submitSearch}>
            <label htmlFor="activity-search">Find Session evidence</label>
            <div><input id="activity-search" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="error, tool, branch…" ref={searchRef} value={query} /><kbd>/</kbd></div>
          </form>
          <div className="aggregate-line">
            <span><b>{activity?.aggregates.activityStates.live ?? 0}</b> live</span>
            <span><b>{failureCount}</b> failed</span>
            <span><b>{activity?.aggregates.members ?? 0}</b> people</span>
          </div>
          <SessionRail
            activity={activity}
            compareIds={compareIds}
            onOpen={(id) => void openSession(id)}
            onToggleCompare={(id) => setCompareIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])}
            selectedId={selectedSessionId}
          />
          <div className="compare-dock">
            <div><span>Comparison tray</span><strong>{compareIds.length} selected</strong></div>
            <button disabled={!compareIds.length} onClick={() => void runComparison()}>Compare evidence</button>
            {(fixtureComparison || comparison) && (
              <p>{fixtureComparison ?? `${comparison?.claim.classification}: ${comparison?.claim.status}; ${comparison?.population.distinctRealTurns} real Turns.`}</p>
            )}
          </div>
        </aside>

        <section className="map-stage">
          <header className="map-stage__header">
            <div>
              <span className="eyebrow">Execution graph</span>
              <h2>Where did the run bend?</h2>
            </div>
            <div className="map-summary">
              <span><b>{detail?.agentRuns.length ?? 0}</b> routes</span>
              <span><b>{detail?.evidence.tools.length ?? 0}</b> tools</span>
              <span><b>{totalTokens.toLocaleString()}</b> tokens</span>
            </div>
          </header>

          <div className="legend" aria-label="Map legend">
            <span><i className="legend-node legend-node--tool" />Tool</span>
            <span><i className="legend-node legend-node--activity" />Activity</span>
            <span><i className="legend-node legend-node--token" />Token sample</span>
            <EvidenceMark evidence={{ stability: ["observed"], derivation: "exact", sourceEventIds: [] }} />
            <EvidenceMark evidence={{ stability: ["inferred"], derivation: "inferred", sourceEventIds: [] }} />
            <EvidenceMark evidence={{ stability: ["unavailable"], derivation: "unavailable", sourceEventIds: [] }} />
          </div>

          {error && <div className="error-note" role="alert">{error} <span>Authenticate in the main app, or use <code>?fixture=edge</code>.</span></div>}
          {detail && activeTarget ? (
            <ExecutionMap cursor={cursor} detail={detail} onTarget={setTarget} target={activeTarget} />
          ) : (
            <div className="empty-map">No captured Sessions match this field.</div>
          )}

          <div className="scrubber">
            <button onClick={() => setCursor(0)} title="Start of Session">|‹</button>
            <label>
              <span>Time scan</span>
              <input aria-label="Session time scan" max="100" min="0" onChange={(event) => setCursor(Number(event.currentTarget.value))} type="range" value={cursor} />
            </label>
            <button onClick={() => setCursor(100)} title="Latest evidence">›|</button>
            <output>{Math.round(cursor)}%</output>
          </div>

          <div className="keyboard-route">
            <span>Keyboard route</span>
            <kbd>J/K</kbd> Session <i /> <kbd>F</kbd> failed Tool <i /> <kbd>←/→</kbd> scrub <i /> <kbd>/</kbd> search
          </div>
        </section>

        {detail && activeTarget ? <TargetInspector detail={detail} onFailure={followFailure} target={activeTarget} /> : <aside className="inspector inspector--empty">Select a Session to inspect evidence.</aside>}
      </div>
    </main>
  );
}
