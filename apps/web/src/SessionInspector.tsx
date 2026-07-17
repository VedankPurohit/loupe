import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentRun,
  ExecutionSession,
  ExecutionSessionDetail,
  LiveExecutionEvent,
} from "@workspace/contracts";

type LiveStatus = "connecting" | "connected" | "interrupted";

function formatDate(value: string | null) {
  if (!value) return "Ongoing";
  return new Date(value).toLocaleString();
}

function label(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
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

export function SessionInspector() {
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  const [detail, setDetail] = useState<ExecutionSessionDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const selectedSessionId = useRef<string | undefined>(undefined);

  const loadSession = useCallback(async (sessionId: string) => {
    selectedSessionId.current = sessionId;
    setDetail(
      await fetchJson<ExecutionSessionDetail>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      ),
    );
  }, []);

  const refreshThroughQuery = useCallback(
    async (fallbackSessionId?: string) => {
      try {
        const response = await fetchJson<{ sessions: ExecutionSession[] }>(
          "/api/v1/sessions",
        );
        setSessions(response.sessions);
        const sessionId =
          selectedSessionId.current ?? fallbackSessionId ?? response.sessions[0]?.id;
        if (sessionId && response.sessions.some(({ id }) => id === sessionId)) {
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
    [loadSession],
  );

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
            </button>
          ))}
        </nav>
      )}

      {detail && (
        <div className="inspector-content">
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
