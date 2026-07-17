import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentRun,
  AuthenticatedSessionResponse,
  ExecutionSession,
  ExecutionSessionDetail,
  LiveExecutionEvent,
  OrganizationActivityResponse,
} from "@workspace/contracts";

type LiveStatus = "connecting" | "connected" | "interrupted";

function formatDate(value: string | null) {
  if (!value) return "Ongoing";
  return new Date(value).toLocaleString();
}

function label(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function available(value: string | number | null) {
  return value === null ? "Unavailable" : String(value);
}

function jsonEvidence(value: unknown) {
  return value === null ? "Unavailable" : JSON.stringify(value, null, 2);
}

function EvidenceLabel({
  evidence,
}: {
  evidence: AgentRun["identityEvidence"];
}) {
  const stability = evidence.stability
    .map((value, index) => (index === 0 ? label(value) : value))
    .join(", ");
  return (
    <span className={`evidence evidence-${evidence.derivation}`}>
      {stability} · {evidence.derivation}
    </span>
  );
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}

function ParentEvidence({ agentRun }: { agentRun: AgentRun }) {
  if (agentRun.kind === "root") {
    return <span className="parent-edge parent-root">Root agent run</span>;
  }
  const edge = agentRun.parentEdge;
  if (!edge) return null;
  return (
    <div className="parent-evidence">
      <span className={`parent-edge parent-${edge.status}`}>
        {edge.status === "unresolved"
          ? "Unresolved parent"
          : `${label(edge.status)} parent`}
      </span>
      {edge.parentAgentRunId && <code>{edge.parentAgentRunId}</code>}
      <small>
        {edge.reconciliation.rule.replaceAll("_", " ")} · confidence {edge.reconciliation.confidence}
      </small>
    </div>
  );
}

export function SessionInspector({
  member,
}: {
  member: AuthenticatedSessionResponse["member"];
}) {
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  const [detail, setDetail] = useState<ExecutionSessionDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [searchText, setSearchText] = useState("");
  const [includeSeeded, setIncludeSeeded] = useState(
    new URLSearchParams(window.location.search).get("includeSeeded") === "true",
  );
  const [activity, setActivity] = useState<OrganizationActivityResponse>();
  const selectedSessionId = useRef<string | undefined>(
    new URLSearchParams(window.location.search).get("session") ?? undefined,
  );

  const loadSession = useCallback(async (sessionId: string) => {
    selectedSessionId.current = sessionId;
    const url = new URL(window.location.href);
    url.searchParams.set("session", sessionId);
    if (includeSeeded) url.searchParams.set("includeSeeded", "true");
    else url.searchParams.delete("includeSeeded");
    window.history.replaceState(null, "", url);
    setDetail(
      await fetchJson<ExecutionSessionDetail>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      ),
    );
  }, [includeSeeded]);

  const refreshThroughQuery = useCallback(
    async (fallbackSessionId?: string) => {
      try {
        const parameters = new URLSearchParams();
        if (searchText.trim()) parameters.set("q", searchText.trim());
        if (includeSeeded) parameters.set("includeSeeded", "true");
        const response = await fetchJson<OrganizationActivityResponse>(
          `/api/v1/organization/activity?${parameters.toString()}`,
        );
        setActivity(response);
        setSessions(response.items);
        const sessionId =
          selectedSessionId.current ?? fallbackSessionId ?? response.items[0]?.id;
        if (sessionId && response.items.some(({ id }) => id === sessionId)) {
          await loadSession(sessionId);
        } else {
          selectedSessionId.current = undefined;
          setDetail(undefined);
        }
        setError(undefined);
      } catch {
        setError("Session history could not be refreshed through /api/v1.");
      } finally {
        setLoading(false);
      }
    },
    [includeSeeded, loadSession, searchText],
  );

  async function annotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch(
      `/api/v1/sessions/${encodeURIComponent(detail.session.id)}/annotations`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome: data.get("outcome"),
          reviewStatus: data.get("reviewStatus"),
          tags: String(data.get("tags") ?? "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      },
    );
    if (!response.ok) {
      setError("The Session annotation could not be saved.");
      return;
    }
    await loadSession(detail.session.id);
    await refreshThroughQuery(detail.session.id);
  }

  useEffect(() => {
    void refreshThroughQuery();

    const events = new EventSource("/api/v1/live");
    events.onopen = () => {
      setLiveStatus("connected");
      void refreshThroughQuery();
    };
    events.addEventListener("session.updated", (message) => {
      const event = JSON.parse(message.data) as LiveExecutionEvent;
      void refreshThroughQuery(event.sessionId);
    });
    events.onerror = () => {
      setLiveStatus("interrupted");
      void refreshThroughQuery();
    };

    return () => events.close();
  }, [refreshThroughQuery]);

  const rootRuns = detail?.agentRuns.filter(({ kind }) => kind === "root") ?? [];
  const subagentRuns =
    detail?.agentRuns.filter(({ kind }) => kind === "subagent") ?? [];

  return (
    <section className="card inspector-card" aria-labelledby="inspector-title">
      <div className="inspector-heading">
        <div>
          <p className="eyebrow">Canonical execution</p>
          <h2 id="inspector-title">Session inspector</h2>
        </div>
        <p
          className={`live-status live-${liveStatus}`}
          role="status"
          aria-label="Live updates"
        >
          {liveStatus === "connected"
            ? "Live updates connected"
            : liveStatus === "interrupted"
              ? "Live updates interrupted; reconnecting through /api/v1"
              : "Connecting live updates"}
        </p>
      </div>

      <form
        className="discovery-form"
        onSubmit={(event) => {
          event.preventDefault();
          void refreshThroughQuery();
        }}
      >
        <label>
          Search Sessions, repositories, annotations, models, tools, capabilities, and errors
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.currentTarget.value)}
            placeholder="Search captured evidence"
          />
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={includeSeeded}
            onChange={(event) => setIncludeSeeded(event.currentTarget.checked)}
          />
          Include clearly labelled Seeded examples
        </label>
        <button type="submit">Search activity</button>
      </form>
      {activity && (
        <p className="section-note">
          {activity.aggregates.sessions} Sessions · {activity.aggregates.members} Members · {activity.aggregates.repositories} repositories · Seeded {activity.syntheticInclusion}
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Loading captured Sessions…</p>}
      {!loading && sessions.length === 0 && (
        <p className="lede">No captured Sessions yet.</p>
      )}

      {sessions.length > 0 && (
        <nav className="session-picker" aria-label="Captured Sessions">
          {sessions.map((session) => (
            <button
              className={detail?.session.id === session.id ? "selected" : ""}
              key={session.id}
              type="button"
              onClick={() => void loadSession(session.id)}
            >
              <code>{session.id}</code>
              <span>{label(session.activityState)}</span>
              {session.synthetic.kind === "seeded" && <span>Seeded · {session.synthetic.examplePackVersion}</span>}
              <span>{session.ownerProfile.displayName}{session.ownerProfile.isExample ? " · Example" : ""}</span>
            </button>
          ))}
        </nav>
      )}

      {detail && (
        <div className="inspector-content">
          <section aria-labelledby="annotations-title">
            <h3 id="annotations-title">Session annotations</h3>
            <p className="section-note">
              Outcome {label(detail.session.annotations.outcome)} · review {label(detail.session.annotations.reviewStatus)} · tags {detail.session.annotations.tags.join(", ") || "none"}
              {detail.session.synthetic.kind === "seeded" ? ` · Seeded ${detail.session.synthetic.examplePackVersion}` : " · Real capture"}
            </p>
            {(member.role === "administrator" || member.id === detail.session.owner.memberId) && (
              <form className="annotation-form" onSubmit={annotate}>
                <label>
                  Outcome
                  <select name="outcome" defaultValue={detail.session.annotations.outcome}>
                    <option value="successful">Successful</option>
                    <option value="partial">Partial</option>
                    <option value="failed">Failed</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label>
                  Review
                  <select name="reviewStatus" defaultValue={detail.session.annotations.reviewStatus}>
                    <option value="exemplar">Exemplar</option>
                    <option value="needs_help">Needs help</option>
                    <option value="ordinary">Ordinary</option>
                  </select>
                </label>
                <label>
                  Tags (comma separated)
                  <input name="tags" defaultValue={detail.session.annotations.tags.join(", ")} />
                </label>
                <button type="submit">Save annotation</button>
              </form>
            )}
          </section>
          <section aria-labelledby="canonical-session-title">
            <h3 id="canonical-session-title">Canonical Session</h3>
            <dl className="fact-grid">
              <div><dt>Session identity</dt><dd><code>{detail.session.id}</code></dd></div>
              <div><dt>Owner member</dt><dd><code>{detail.session.owner.memberId}</code></dd></div>
              <div><dt>Owning device</dt><dd><code>{detail.session.owner.deviceId}</code></dd></div>
              <div><dt>Activity state</dt><dd>{label(detail.session.activityState)}</dd></div>
              <div><dt>Root agent identity</dt><dd><code>{detail.session.rootAgentRunId}</code></dd></div>
              <div><dt>Projection</dt><dd>Version {detail.session.projectionVersion}</dd></div>
              <div><dt>Completion</dt><dd>Permanent completion not assumed</dd></div>
              <div><dt>Completion evidence</dt><dd>{label(detail.session.completion.evidence)}</dd></div>
            </dl>
            <p className="reconciliation-note">
              Ownership reconciliation: {detail.session.ownershipReconciliation.rule.replaceAll("_", " ")}
              {" · "}confidence {detail.session.ownershipReconciliation.confidence}
            </p>
            {detail.session.gitContext && (
              <div className="git-context">
                <h4>Relay-local Git sample</h4>
                <p>
                  Sampled {formatDate(detail.session.gitContext.sampledAt)} from
                  {" "}<code>{detail.session.gitContext.provenance.cwd}</code>.
                  This local observation is not source-reported proof of earlier Git state.
                </p>
                {detail.session.gitContext.status === "available" ? (
                  <dl className="fact-grid">
                    <div><dt>Repository root</dt><dd><code>{detail.session.gitContext.repositoryRoot}</code></dd></div>
                    <div><dt>Remote identity</dt><dd><code>{detail.session.gitContext.remoteIdentity ?? "Unavailable"}</code></dd></div>
                    <div><dt>Branch</dt><dd>{detail.session.gitContext.detached ? "Detached HEAD" : detail.session.gitContext.branch}</dd></div>
                    <div><dt>Worktree</dt><dd><code>{detail.session.gitContext.worktree}</code></dd></div>
                    <div><dt>Commit</dt><dd><code>{detail.session.gitContext.commit}</code></dd></div>
                  </dl>
                ) : (
                  <p>Git context {label(detail.session.gitContext.status)}: {label(detail.session.gitContext.reason ?? "unavailable")}</p>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="activity-title">
            <h3 id="activity-title">Activity episodes</h3>
            <div className="plain-list">
              {detail.activities.map((activity) => (
                <article key={activity.id}>
                  <strong>{label(activity.source)}</strong>
                  <span className={`activity-state state-${activity.state}`}>
                    {label(activity.state)}
                  </span>
                  <span>{formatDate(activity.startedAt)} — {formatDate(activity.endedAt)}</span>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="agents-title">
            <h3 id="agents-title">Root and Subagents</h3>
            <div className="agent-list">
              {[...rootRuns, ...subagentRuns].map((agentRun) => (
                <article
                  className={agentRun.kind === "subagent" ? "subagent" : ""}
                  key={agentRun.id}
                >
                  <div className="agent-title-row">
                    <strong>
                      {agentRun.kind === "root" ? "Root agent run" : "Subagent run"}
                    </strong>
                    <EvidenceLabel evidence={agentRun.identityEvidence} />
                  </div>
                  <code>{agentRun.id}</code>
                  {agentRun.agentType && <span>Type: {agentRun.agentType}</span>}
                  <ParentEvidence agentRun={agentRun} />
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="turns-title">
            <h3 id="turns-title">Turns</h3>
            <div className="plain-list turns-list">
              {detail.turns.map((turn) => (
                <article key={turn.id}>
                  <div className="agent-title-row">
                    <strong><code>{turn.id}</code></strong>
                    <EvidenceLabel evidence={turn.evidence} />
                  </div>
                  <span>Agent run <code>{turn.agentRunId}</code></span>
                  <span>{formatDate(turn.firstObservedAt)} — {formatDate(turn.lastObservedAt)}</span>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="tools-title">
            <h3 id="tools-title">Tool evidence</h3>
            <p className="section-note">
              Hook and OTel identifiers remain separate. A coverage gap means the
              source did not expose the fact; it does not mean the activity did not happen.
            </p>
            <div className="evidence-grid">
              {detail.evidence.tools.length === 0 && (
                <p className="unavailable-panel">Tool evidence unavailable for this Session.</p>
              )}
              {detail.evidence.tools.map((tool) => (
                <article key={tool.id}>
                  <div className="agent-title-row">
                    <strong>{tool.toolName}</strong>
                    <EvidenceLabel evidence={tool.evidence} />
                  </div>
                  <dl className="compact-facts">
                    <div><dt>Hook id</dt><dd>{available(tool.identifiers.hookToolUseId)}</dd></div>
                    <div><dt>OTel id</dt><dd>{available(tool.identifiers.otelCallId)}</dd></div>
                    <div><dt>Outcome</dt><dd>{label(tool.outcome)}</dd></div>
                    <div><dt>Approval</dt><dd>{label(tool.approval)}</dd></div>
                    <div><dt>Duration</dt><dd>{tool.durationMs === null ? "Unavailable" : `${tool.durationMs} ms`}</dd></div>
                    <div><dt>Retries</dt><dd>{available(tool.retryCount)}</dd></div>
                  </dl>
                  <details>
                    <summary>Input and result evidence</summary>
                    <pre>{jsonEvidence(tool.input)}</pre>
                    <pre>{jsonEvidence(tool.result)}</pre>
                  </details>
                  {tool.coverageGaps.length > 0 && (
                    <small>Coverage gaps: {tool.coverageGaps.map(label).join("; ")}</small>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="usage-title">
            <h3 id="usage-title">Token and Context evidence</h3>
            <p className="section-note">
              Token usage is provider-reported consumption. Context occupancy is a
              separate inference from input Tokens and an emitted Context-window limit.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th><th>Model</th><th>Input</th><th>Cached input</th>
                    <th>Output</th><th>Reasoning</th><th>Total</th><th>Turn association</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.evidence.tokenUsage.map((sample) => (
                    <tr key={sample.id}>
                      <td>{formatDate(sample.occurredAt)}</td>
                      <td>{available(sample.model)}</td>
                      <td>{available(sample.categories.input)}</td>
                      <td>{available(sample.categories.cachedInput)}</td>
                      <td>{available(sample.categories.output)}</td>
                      <td>{available(sample.categories.reasoningOutput)}</td>
                      <td>{available(sample.categories.total)}</td>
                      <td>{label(sample.turnAssociation.strength)} · {sample.turnAssociation.method.replaceAll("_", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.evidence.tokenUsage.length === 0 && (
              <p className="unavailable-panel">Provider Token usage unavailable for this Session.</p>
            )}
            <div className="evidence-grid context-grid">
              {detail.evidence.context.limits.map((limit, index) => (
                <article key={`${limit.model ?? "unknown"}-${index}`}>
                  <strong>Reported limits · {available(limit.model)}</strong>
                  <span>Context window: {available(limit.contextWindow)} Tokens</span>
                  <span>Auto-compaction: {available(limit.autoCompactionLimit)} Tokens</span>
                  <EvidenceLabel evidence={limit.evidence} />
                </article>
              ))}
              {detail.evidence.context.occupancy.map((item) => (
                <article key={item.tokenUsageId}>
                  <strong>
                    {detail.evidence.context.firstRequestBaseline?.tokenUsageId === item.tokenUsageId
                      ? "First-request Context baseline"
                      : "Inferred Context occupancy"}
                  </strong>
                  <span>{item.occupancyTokens} Tokens · {item.occupancyPercent === null ? "percentage unavailable" : `${item.occupancyPercent}%`}</span>
                  <span>Method: {item.method.replaceAll("_", " ")}</span>
                  <small>{item.missingAssumptions.join(" ")}</small>
                  <EvidenceLabel evidence={item.evidence} />
                </article>
              ))}
              <article className="unavailable-panel">
                <strong>Per-item Context contribution: {label(detail.evidence.context.contribution.status)}</strong>
                <span>{detail.evidence.context.contribution.note}</span>
                <span>Method: {detail.evidence.context.contribution.method.replaceAll("_", " ")}</span>
              </article>
            </div>
          </section>

          <section aria-labelledby="cost-title">
            <h3 id="cost-title">Estimated cost</h3>
            <p className="section-note">
              These are API-equivalent estimates only. Provider-billed currency and
              ChatGPT plan-credit accounting are not passively reported.
            </p>
            <div className="evidence-grid">
              {detail.evidence.costEstimates.length === 0 && (
                <p className="unavailable-panel">Cost unavailable because no Token sample was captured.</p>
              )}
              {detail.evidence.costEstimates.map((cost) => (
                <article key={cost.tokenUsageId}>
                  <strong>{cost.status === "estimated" ? `${cost.currency} ${cost.amount}` : "Estimate unavailable"}</strong>
                  <span>Table: {available(cost.priceTableVersion)} · effective {available(cost.effectiveDate)}</span>
                  <span>Model: {available(cost.modelMapping.observedModel)} → {available(cost.modelMapping.pricedModel)}</span>
                  <small>{cost.reason ?? cost.billingCaveat}</small>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="lifecycle-title">
            <h3 id="lifecycle-title">Lifecycle and capability evidence</h3>
            <div className="plain-list lifecycle-list">
              {detail.evidence.lifecycle.map((item) => (
                <article key={item.id}>
                  <strong>{label(item.kind)} · {label(item.event)}</strong>
                  <span>{formatDate(item.occurredAt)}</span>
                  <EvidenceLabel evidence={item.evidence} />
                </article>
              ))}
            </div>
            <div className="evidence-grid">
              {detail.evidence.capabilities.map((capability) => (
                <article key={capability.capability}>
                  <div className="agent-title-row">
                    <strong>{label(capability.capability)}</strong>
                    <span className={`capability-state capability-${capability.state}`}>{label(capability.state)}</span>
                  </div>
                  <span>{capability.note}</span>
                  <EvidenceLabel evidence={capability.evidence} />
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="timeline-title">
            <h3 id="timeline-title">Chronological timeline</h3>
            <ol className="timeline">
              {detail.timeline.map((event) => (
                <li key={event.sourceEventId}>
                  <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
                  <strong>{label(event.event)}</strong>
                  {event.turnId && <code>{event.turnId}</code>}
                  <EvidenceLabel evidence={event.evidence} />
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </section>
  );
}
