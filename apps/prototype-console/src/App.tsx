import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LoupeApi } from "./api";
import { AgentTree, EvidenceChip, formatTime, humanize, shortId } from "./components";
import { edgeActivity, edgeComparison, edgeDetailFor } from "./fixture";
import type { ActivityResponse, ComparisonResponse, SearchFilters, Session, SessionDetail, ToolEvidence } from "./types";

type Mode = "real" | "edge";
type EvidenceTab = "tool" | "tokens" | "context" | "errors";

const defaultFilters: SearchFilters = {
  q: "",
  activityState: "",
  outcome: "",
  memberId: "",
  repository: "",
  tool: "",
  error: "",
  includeSeeded: false,
};

const defaultBase = import.meta.env.VITE_API_BASE_URL ?? "";

function json(value: unknown): string {
  return value === null ? "Unavailable from captured evidence" : JSON.stringify(value, null, 2);
}

function repoLabel(session: Session): string {
  return session.repository?.remoteIdentity ?? session.gitContext?.remoteIdentity ?? "Repository unavailable";
}

function filterFixture(filters: SearchFilters): ActivityResponse {
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = edgeActivity.items.filter((item) => {
    const haystack = [item.id, item.ownerProfile.displayName, repoLabel(item), item.annotations.tags.join(" "), item.annotations.outcome].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term))
      && (!filters.activityState || item.activityState === filters.activityState)
      && (!filters.outcome || item.annotations.outcome === filters.outcome)
      && (!filters.memberId || item.owner.memberId === filters.memberId)
      && (!filters.repository || repoLabel(item) === filters.repository)
      && (!filters.tool || filters.tool === "exec_command")
      && (!filters.error || (item.annotations.outcome === "failed" && "permission denied".includes(filters.error.toLowerCase())));
  });
  return { ...edgeActivity, items, page: { ...edgeActivity.page, total: items.length }, aggregates: { ...edgeActivity.aggregates, sessions: items.length } };
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<Mode>(params.get("mode") === "edge" ? "edge" : "real");
  const [apiBase, setApiBase] = useState(defaultBase);
  const [apiDraft, setApiDraft] = useState(defaultBase || "same-origin /api proxy");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolEvidence | null>(null);
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("tool");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparisonClaim, setComparisonClaim] = useState("The selected Sessions show a repeated build-output failure pattern.");
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const api = useMemo(() => new LoupeApi(apiBase), [apiBase]);

  async function loadActivity(nextFilters = filters) {
    setLoading(true);
    setError(null);
    try {
      const response = mode === "edge" ? filterFixture(nextFilters) : await api.search(nextFilters);
      setActivity(response);
    } catch (cause) {
      setActivity(null);
      setError(cause instanceof Error ? cause.message : "Organization activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function inspectSession(id: string) {
    setLoading(true);
    setError(null);
    try {
      const response = mode === "edge" ? edgeDetailFor(id) : await api.session(id);
      setDetail(response);
      setSelectedSource(response.timeline[0]?.sourceEventId ?? null);
      setSelectedAgent(null);
      setSelectedTool(null);
      setEvidenceTab("tool");
      const next = new URL(window.location.href);
      next.searchParams.set("session", id);
      window.history.replaceState({}, "", next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Session evidence could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActivity();
    // Mode and base URL intentionally reset the investigation population.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, api]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const editing = target.matches("input, textarea, select, [contenteditable='true']");
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && !editing) {
        setSelectedTool(null);
        setSelectedAgent(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setDetail(null);
    setComparison(null);
    const next = new URL(window.location.href);
    if (nextMode === "edge") next.searchParams.set("mode", "edge");
    else next.searchParams.delete("mode");
    next.searchParams.delete("session");
    window.history.replaceState({}, "", next);
  }

  function applyApiBase(event: FormEvent) {
    event.preventDefault();
    setApiBase(apiDraft === "same-origin /api proxy" ? "" : apiDraft.trim());
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    void loadActivity();
  }

  function revealFirstFailure() {
    const failure = detail?.evidence.tools.find((tool) => tool.outcome === "failure") ?? null;
    if (!failure) return;
    setSelectedTool(failure);
    setEvidenceTab("tool");
    const source = failure.evidence.sourceEventIds[0] ?? null;
    setSelectedSource(source);
    const event = detail?.timeline.find((item) => item.sourceEventId === source);
    setSelectedAgent(event?.agentRunId ?? null);
  }

  function selectTimelineEvent(sourceEventId: string) {
    setSelectedSource(sourceEventId);
    const event = detail?.timeline.find((item) => item.sourceEventId === sourceEventId);
    if (event?.agentRunId) setSelectedAgent(event.agentRunId);
    const tool = detail?.evidence.tools.find((item) => item.evidence.sourceEventIds.includes(sourceEventId));
    if (tool) {
      setSelectedTool(tool);
      setEvidenceTab(tool.outcome === "failure" ? "errors" : "tool");
    }
  }

  function toggleComparison(id: string) {
    setComparisonIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function runComparison(event: FormEvent) {
    event.preventDefault();
    if (comparisonIds.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      setComparison(mode === "edge" ? edgeComparison : await api.compare(comparisonIds, comparisonClaim, filters.includeSeeded));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comparison could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  const timeline = detail?.timeline.filter((event) => !selectedAgent || event.agentRunId === selectedAgent) ?? [];
  const failedTools = detail?.evidence.tools.filter((tool) => tool.outcome === "failure") ?? [];

  return (
    <div className="console-shell">
      <header className="masthead">
        <div className="wordmark" aria-label="Loupe Evidence Workbench">
          <span className="wordmark-mark">L∕P</span>
          <span><strong>Loupe</strong><small>Evidence workbench / prototype 11</small></span>
        </div>
        <div className="capture-status">
          <span className={`pulse ${mode === "real" ? "live" : "fixture"}`} />
          <span>{mode === "real" ? "Versioned backend · authenticated cookie" : "DETERMINISTIC EDGE FIXTURE · NOT LIVE DATA"}</span>
        </div>
        <div className="mode-switch" aria-label="Data mode">
          <button type="button" className={mode === "real" ? "active" : ""} onClick={() => switchMode("real")}>Real API</button>
          <button type="button" className={mode === "edge" ? "active fixture-button" : "fixture-button"} onClick={() => switchMode("edge")}>Edge fixture</button>
        </div>
      </header>

      <section className="command-deck" aria-label="Search and connection controls">
        <form className="search-strip" onSubmit={applySearch}>
          <label className="search-box">
            <span>QUERY</span>
            <input ref={searchRef} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.currentTarget.value })} placeholder="session, repository, tag…" />
            <kbd>/</kbd>
          </label>
          <label><span>STATE</span><select value={filters.activityState} onChange={(event) => setFilters({ ...filters, activityState: event.currentTarget.value })}><option value="">Any</option><option value="live">Live</option><option value="idle">Idle</option><option value="resumed">Resumed</option></select></label>
          <label><span>OUTCOME</span><select value={filters.outcome} onChange={(event) => setFilters({ ...filters, outcome: event.currentTarget.value })}><option value="">Any</option><option value="failed">Failed</option><option value="partial">Partial</option><option value="successful">Successful</option><option value="unknown">Unknown</option></select></label>
          <label><span>TOOL</span><input value={filters.tool} onChange={(event) => setFilters({ ...filters, tool: event.currentTarget.value })} placeholder="exec_command" /></label>
          <label><span>ERROR</span><input value={filters.error} onChange={(event) => setFilters({ ...filters, error: event.currentTarget.value })} placeholder="permission denied" /></label>
          <button className="execute-query" type="submit">Run query</button>
        </form>
        <form className="api-control" onSubmit={applyApiBase}>
          <label><span>API BASE</span><input value={apiDraft} onChange={(event) => setApiDraft(event.currentTarget.value)} disabled={mode === "edge"} /></label>
          <button type="submit" disabled={mode === "edge"}>Connect</button>
        </form>
      </section>

      {mode === "edge" && <div className="fixture-ribbon" role="status"><strong>Fixture mode</strong> This deterministic population exercises failure, unavailable evidence, inferred parentage, Context estimates, and comparison. Switch to Real API for captured Organization data.</div>}
      {error && <div className="error-banner" role="alert"><strong>Evidence request failed</strong><span>{error}</span></div>}

      <main className="investigation-grid">
        <section className="activity-ledger" aria-labelledby="activity-heading">
          <div className="panel-heading">
            <div><span className="section-code">ORG / ACTIVITY</span><h1 id="activity-heading">Session ledger</h1></div>
            <span className="count-badge">{activity?.page.total ?? "—"}</span>
          </div>
          {activity && <div className="aggregate-tape" aria-label="Activity aggregates"><span><b>{activity.aggregates.activityStates.live}</b> live</span><span><b>{activity.aggregates.outcomes.failed}</b> failed</span><span><b>{activity.aggregates.members}</b> members</span><span><b>{activity.aggregates.repositories}</b> repos</span></div>}
          <div className="table-wrap">
            <table className="session-table">
              <thead><tr><th>Observed</th><th>Session / owner</th><th>State</th><th><span className="sr-only">Compare</span></th></tr></thead>
              <tbody>
                {activity?.items.map((session) => (
                  <tr key={session.id} className={detail?.session.id === session.id ? "active-row" : ""}>
                    <td><time dateTime={session.lastObservedAt}>{formatTime(session.lastObservedAt)}</time><span className="repo-cell">{repoLabel(session)}</span></td>
                    <td><button type="button" className="session-link" onClick={() => void inspectSession(session.id)} aria-label={`Inspect ${session.id}`}><code>{shortId(session.id, 22)}</code><span>{session.ownerProfile.displayName}</span></button></td>
                    <td><span className={`status status-${session.annotations.outcome}`}>{humanize(session.annotations.outcome)}</span><small>{humanize(session.activityState)}</small></td>
                    <td><label className="compare-check"><input type="checkbox" checked={comparisonIds.includes(session.id)} onChange={() => toggleComparison(session.id)} /><span className="sr-only">Compare {session.id}</span></label></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && activity?.items.length === 0 && <div className="empty-state">No Sessions match this evidence query. Clear a facet or inspect the API connection.</div>}
          {loading && <div className="loading-line">Reading captured evidence…</div>}
        </section>

        <section className="trace-workspace" aria-label="Session trace workspace">
          {!detail ? (
            <div className="trace-empty">
              <span className="scope-reticle" aria-hidden="true" />
              <span className="section-code">START HERE</span>
              <h2>Select a Session from the Organization ledger.</h2>
              <p>The synchronized trace will align chronological activity, Agent parentage, and source-backed evidence without requiring raw telemetry.</p>
            </div>
          ) : (
            <>
              <header className="session-header">
                <div>
                  <span className="section-code">SESSION / {detail.session.synthetic.kind.toUpperCase()}</span>
                  <h2>{shortId(detail.session.id, 42)}</h2>
                  <p>{detail.session.ownerProfile.displayName} · {repoLabel(detail.session)} · {detail.session.gitContext?.branch ?? "branch unavailable"}</p>
                </div>
                <div className="session-flags">
                  <span className={`status status-${detail.session.annotations.outcome}`}>{humanize(detail.session.annotations.outcome)}</span>
                  <span className="review-chip">{humanize(detail.session.annotations.reviewStatus)}</span>
                  {failedTools.length > 0 && <button type="button" className="failure-jump" onClick={revealFirstFailure}>Reveal exact failed Tool <span>→</span></button>}
                </div>
              </header>
              <div className="session-meta-tape">
                <span>Root <code>{shortId(detail.session.rootAgentRunId, 26)}</code></span>
                <span>Projection v{detail.session.projectionVersion}</span>
                <span>Completion <b>not assumed</b></span>
                <span>Ownership {detail.session.ownershipReconciliation.confidence}</span>
              </div>
              <div className="synchronized-trace">
                <section className="timeline-panel" aria-labelledby="timeline-heading">
                  <div className="subheading"><div><span className="section-code">TIME AXIS</span><h3 id="timeline-heading">Activity trace</h3></div>{selectedAgent && <button type="button" onClick={() => setSelectedAgent(null)}>Clear Agent focus</button>}</div>
                  <ol className="timeline-list">
                    {timeline.map((event, index) => {
                      const tool = detail.evidence.tools.find((item) => item.evidence.sourceEventIds.includes(event.sourceEventId));
                      return (
                        <li key={event.sourceEventId} className={`${selectedSource === event.sourceEventId ? "selected" : ""} ${tool?.outcome === "failure" ? "failure" : ""}`}>
                          <button type="button" onClick={() => selectTimelineEvent(event.sourceEventId)} aria-pressed={selectedSource === event.sourceEventId}>
                            <span className="trace-index">{String(index + 1).padStart(2, "0")}</span>
                            <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
                            <span className="event-copy"><strong>{humanize(event.event)}</strong><small>{tool ? `${tool.toolName} · ${tool.outcome}` : event.turnId ?? "Session-level"}</small></span>
                            <EvidenceChip evidence={event.evidence} compact />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>
                <section className="tree-panel" aria-labelledby="tree-heading">
                  <div className="subheading"><div><span className="section-code">PARENT AXIS</span><h3 id="tree-heading">Agent hierarchy</h3></div><span className="tree-legend">solid exact · dotted inferred</span></div>
                  <AgentTree runs={detail.agentRuns} selectedId={selectedAgent} onSelect={setSelectedAgent} />
                </section>
              </div>
              <section className="comparison-workspace" aria-labelledby="compare-heading">
                <form onSubmit={runComparison}>
                  <div className="comparison-head"><div><span className="section-code">CROSS-SESSION</span><h3 id="compare-heading">Comparison bench</h3></div><span>{comparisonIds.length} selected</span></div>
                  <div className="comparison-controls"><label><span>CLAIM TO ASSESS</span><input value={comparisonClaim} onChange={(event) => setComparisonClaim(event.currentTarget.value)} /></label><button type="submit" disabled={comparisonIds.length < 2}>Compare evidence</button></div>
                </form>
                {comparison ? <ComparisonResult result={comparison} /> : <p className="comparison-hint">Select two or more Sessions in the ledger. Comparisons remain descriptive; Seeded examples never increase real-Turn evidence.</p>}
              </section>
            </>
          )}
        </section>

        <aside className="evidence-drawer" aria-label="Evidence inspector">
          <div className="panel-heading drawer-heading"><div><span className="section-code">EVIDENCE / EXACT</span><h2>{selectedTool?.outcome === "failure" ? "Failed Tool evidence" : "Evidence inspector"}</h2></div>{selectedTool && <button type="button" className="close-evidence" onClick={() => setSelectedTool(null)} aria-label="Close evidence">×</button>}</div>
          {detail ? (
            <>
              <div className="evidence-tabs" role="tablist" aria-label="Evidence panels">
                {(["tool", "tokens", "context", "errors"] as EvidenceTab[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={evidenceTab === tab} onClick={() => setEvidenceTab(tab)}>{humanize(tab)}{tab === "errors" && failedTools.length > 0 ? ` ${failedTools.length}` : ""}</button>)}
              </div>
              {evidenceTab === "tool" && <ToolPanel tool={selectedTool} />}
              {evidenceTab === "tokens" && <TokenPanel detail={detail} />}
              {evidenceTab === "context" && <ContextPanel detail={detail} />}
              {evidenceTab === "errors" && <ErrorPanel detail={detail} onSelect={(tool) => { setSelectedTool(tool); setEvidenceTab("tool"); }} />}
            </>
          ) : <div className="drawer-empty"><p>Select a Session to expose Tool, Token, Context, and error evidence.</p><small>Unavailable evidence remains unavailable—it is never rendered as zero.</small></div>}
        </aside>
      </main>
      <footer className="keyboard-footer"><span><kbd>/</kbd> focus query</span><span><kbd>Tab</kbd> traverse trace</span><span><kbd>Enter</kbd> inspect</span><span><kbd>Esc</kbd> clear focus</span><span>Prototype direction: evidence-dense console</span></footer>
    </div>
  );
}

function ToolPanel({ tool }: { tool: ToolEvidence | null }) {
  if (!tool) return <div className="drawer-empty"><p>Select a Tool event from the trace, or use “Reveal exact failed Tool.”</p><small>Hook and OTel identifiers remain separate.</small></div>;
  return (
    <div className="drawer-body tool-panel">
      <div className="drawer-subject"><div><span className={`tool-glyph ${tool.outcome}`}>⌁</span><span><strong>{tool.toolName}</strong><small>{formatTime(tool.occurredAt)} · {tool.durationMs === null ? "duration unavailable" : `${tool.durationMs} ms`}</small></span></div><span className={`status status-${tool.outcome}`}>{humanize(tool.outcome)}</span></div>
      <EvidenceChip evidence={tool.evidence} />
      <dl className="evidence-facts">
        <div><dt>Hook Tool use id</dt><dd><code>{tool.identifiers.hookToolUseId ?? "Unavailable from captured evidence"}</code></dd></div>
        <div><dt>OTel call id</dt><dd><code>{tool.identifiers.otelCallId ?? "Unavailable from captured evidence"}</code></dd></div>
        <div><dt>Turn association</dt><dd>{humanize(tool.turnAssociation.strength)}<small>{humanize(tool.turnAssociation.method)}</small></dd></div>
        <div><dt>Approval</dt><dd>{humanize(tool.approval)}</dd></div>
        <div><dt>Retries</dt><dd>{tool.retryCount ?? "Unavailable from captured evidence"}</dd></div>
      </dl>
      <section><h3>Input</h3><pre>{json(tool.input)}</pre></section>
      <section><h3>Result</h3><pre className={tool.outcome === "failure" ? "failure-output" : ""}>{json(tool.result)}</pre></section>
      {tool.coverageGaps.length > 0 && <section className="coverage-gap"><h3>Coverage gaps</h3>{tool.coverageGaps.map((gap) => <p key={gap}>{humanize(gap)}</p>)}</section>}
    </div>
  );
}

function TokenPanel({ detail }: { detail: SessionDetail }) {
  return <div className="drawer-body"><p className="panel-note">Provider-reported Token consumption; not Context occupancy.</p>{detail.evidence.tokenUsage.length === 0 ? <Unavailable text="Provider Token usage unavailable for this Session." /> : <div className="token-stack">{detail.evidence.tokenUsage.map((sample) => <article key={sample.id}><header><strong>{sample.model ?? "Model unavailable"}</strong><EvidenceChip evidence={sample.evidence} compact /></header><div className="token-total">{sample.categories.total?.toLocaleString() ?? "—"}<small>total Tokens</small></div><dl className="mini-grid"><div><dt>Input</dt><dd>{sample.categories.input?.toLocaleString() ?? "Unavailable"}</dd></div><div><dt>Cached</dt><dd>{sample.categories.cachedInput?.toLocaleString() ?? "Unavailable"}</dd></div><div><dt>Output</dt><dd>{sample.categories.output?.toLocaleString() ?? "Unavailable"}</dd></div><div><dt>Reasoning</dt><dd>{sample.categories.reasoningOutput?.toLocaleString() ?? "Unavailable"}</dd></div></dl><small>{humanize(sample.turnAssociation.strength)} · {sample.turnAssociation.turnId ?? "Turn unavailable"}</small></article>)}</div>}</div>;
}

function ContextPanel({ detail }: { detail: SessionDetail }) {
  const context = detail.evidence.context;
  return <div className="drawer-body"><p className="panel-note">Occupancy is inferred from provider input Tokens over the reported Context window.</p>{context.occupancy.map((item) => <article className="context-meter" key={item.tokenUsageId}><div><strong>{context.firstRequestBaseline?.tokenUsageId === item.tokenUsageId ? "First-request baseline" : "Inferred occupancy"}</strong><span>{item.occupancyPercent === null ? "percentage unavailable" : `${item.occupancyPercent.toFixed(1)}%`}</span></div><div className="meter-track"><span style={{ width: `${Math.min(item.occupancyPercent ?? 0, 100)}%` }} /></div><small>{item.occupancyTokens.toLocaleString()} / {item.inputs.contextWindow?.toLocaleString() ?? "unknown"} Tokens</small><EvidenceChip evidence={item.evidence} compact /></article>)}<Unavailable text={context.contribution.note} detail={humanize(context.contribution.method)} /></div>;
}

function ErrorPanel({ detail, onSelect }: { detail: SessionDetail; onSelect: (tool: ToolEvidence) => void }) {
  const errors = detail.evidence.tools.filter((tool) => tool.outcome === "failure" || tool.outcome === "unknown");
  return <div className="drawer-body"><p className="panel-note">Failures and ambiguous Tool outcomes retain source identifiers and coverage gaps.</p>{errors.length === 0 ? <Unavailable text="No failed or ambiguous Tool evidence was captured." /> : <div className="error-stack">{errors.map((tool) => <button type="button" key={tool.id} onClick={() => onSelect(tool)}><span className={`severity ${tool.outcome}`} /> <span><strong>{tool.toolName}</strong><small>{tool.outcome} · {formatTime(tool.occurredAt)}</small></span><span>→</span></button>)}</div>}</div>;
}

function Unavailable({ text, detail }: { text: string; detail?: string }) {
  return <div className="unavailable"><strong>Unavailable from captured evidence</strong><p>{text}</p>{detail && <small>{detail}</small>}</div>;
}

function ComparisonResult({ result }: { result: ComparisonResponse }) {
  return <div className="comparison-result"><div className="comparison-summary"><span className={`comparison-status ${result.claim.status}`}>{humanize(result.claim.classification)}</span><span>{result.population.distinctRealTurns} real Turns</span><span>{result.completeness.status} evidence</span></div>{result.claim.refusal && <p className="comparison-refusal"><strong>{result.claim.refusal.code}</strong> {result.claim.refusal.message}</p>}<div className="subject-strip">{result.subjects.map((subject) => <article key={subject.selection.sessionId}><strong>{shortId(subject.selection.sessionId, 20)}</strong><span>{subject.ownerDisplayName} · {humanize(subject.outcome)}</span><span>{subject.toolCount} Tools · {subject.tokenTotal?.toLocaleString() ?? "Tokens unavailable"}</span></article>)}</div>{result.claim.caveats.map((caveat) => <small key={caveat}>{caveat}</small>)}</div>;
}
