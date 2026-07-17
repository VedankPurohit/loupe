import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

import { compareCases, NotebookApiError, readSession, searchOrganization } from "./api.js";
import {
  EvidenceNotebook,
  type ComparisonSummary,
  normalizeComparison,
} from "./EvidenceNotebook.js";
import { fixtureActivity, fixtureDetails } from "./fixture.js";
import {
  beginInvestigation,
  openCase as openInvestigationCase,
  revealFirstFailure,
} from "./investigation.js";

const isEdgeFixture = new URLSearchParams(window.location.search).get("fixture") === "edge";

const label = (value: string) => value.replaceAll("_", " ");
const relativeTime = (value: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export function App() {
  const [activity, setActivity] = useState<OrganizationActivityResponse>();
  const [detail, setDetail] = useState<ExecutionSessionDetail>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [caseLoading, setCaseLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [liveState, setLiveState] = useState<"fixture" | "connecting" | "connected" | "interrupted">(
    isEdgeFixture ? "fixture" : "connecting",
  );
  const [investigation, setInvestigation] = useState(beginInvestigation);
  const [comparisonPeerId, setComparisonPeerId] = useState<string>();
  const [comparison, setComparison] = useState<ComparisonSummary>();
  const [comparisonBusy, setComparisonBusy] = useState(false);

  const loadActivity = useCallback(async (search = "") => {
    setLoading(true);
    try {
      if (isEdgeFixture) {
        const normalized = search.trim().toLowerCase();
        setActivity({
          ...fixtureActivity,
          items: normalized
            ? fixtureActivity.items.filter((item) =>
                [item.id, item.ownerProfile.displayName, item.repository.remoteIdentity, ...item.annotations.tags]
                  .join(" ")
                  .toLowerCase()
                  .includes(normalized),
              )
            : fixtureActivity.items,
          filters: { ...fixtureActivity.filters, q: search.trim() || undefined },
        });
      } else {
        setActivity(await searchOrganization(search));
      }
      setError(undefined);
    } catch (caught) {
      const apiError = caught instanceof NotebookApiError ? caught : undefined;
      setError(
        apiError?.status === 401
          ? "This prototype needs an authenticated browser session. Sign in through the main Loupe app, then reopen this page."
          : apiError?.message ?? "Organization activity could not be read from /api/v1.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
    if (isEdgeFixture) return;
    const source = new EventSource("/api/v1/live", { withCredentials: true });
    source.onopen = () => setLiveState("connected");
    source.addEventListener("session.updated", () => void loadActivity(query));
    source.onerror = () => setLiveState("interrupted");
    return () => source.close();
  }, [loadActivity]);

  async function openCase(id: string) {
    setCaseLoading(true);
    setComparison(undefined);
    setInvestigation((current) => openInvestigationCase(current, id));
    try {
      setDetail(isEdgeFixture ? fixtureDetails[id] : await readSession(id));
      const url = new URL(window.location.href);
      url.searchParams.set("session", id);
      window.history.replaceState(null, "", url);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected Session could not be opened.");
    } finally {
      setCaseLoading(false);
    }
  }

  function jumpToFailure() {
    if (!detail) return;
    const next = revealFirstFailure(investigation, { tools: detail.evidence.tools });
    setInvestigation(next);
    if (next.focusedEvidenceId) {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(`evidence-${next.focusedEvidenceId}`);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        target?.focus({ preventScroll: true });
      });
    }
  }

  async function compareSelectedCases() {
    if (!detail || !comparisonPeerId) return;
    setComparisonBusy(true);
    try {
      if (isEdgeFixture) {
        setComparison({
          classification: "repeated pattern",
          status: "supported",
          population: "4 distinct real Turns · 0 Seeded Turns",
          caveats: [
            "Both cases show retry-related Tool evidence; this does not establish productivity or causation.",
            "Deterministic edge fixture result — do not cite as captured Organization evidence.",
          ],
        });
      } else {
        const response = await compareCases({
          selections: [
            { scope: "session", sessionId: detail.session.id },
            { scope: "session", sessionId: comparisonPeerId },
          ],
          filters: query.trim() ? { q: query.trim() } : {},
          includeSeeded: false,
          claim: {
            kind: "pattern",
            statement: "The selected Sessions show a repeated Tool-failure and retry pattern.",
            signals: ["tool_count", "token_usage", "duration"],
          },
        });
        setComparison(normalizeComparison(response));
      }
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comparison could not be completed.");
    } finally {
      setComparisonBusy(false);
    }
  }

  const peers = useMemo(
    () =>
      (activity?.items ?? [])
        .filter(({ id }) => id !== detail?.session.id)
        .map((item) => ({ id: item.id, label: `${item.ownerProfile.displayName} · ${item.repository.remoteIdentity ?? item.id}` })),
    [activity, detail],
  );

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadActivity(query);
  }

  return (
    <div className="prototype-shell">
      {isEdgeFixture && (
        <div className="fixture-banner" role="status">
          <strong>Deterministic edge fixture mode</strong>
          <span>UI evaluation only · this evidence was not captured</span>
          <a href={window.location.pathname}>Return to real /api/v1 evidence</a>
        </div>
      )}

      <header className="product-bar">
        <a className="wordmark" href="/" aria-label="Loupe prototype home">
          <span className="lens-mark">◉</span>
          <span>Loupe</span>
          <small>prototype / evidence notebook</small>
        </a>
        <div className={`connection-state connection-${liveState}`} role="status">
          <i />
          {liveState === "fixture" ? "Fixture, offline" : liveState === "connected" ? "Live evidence connected" : liveState === "interrupted" ? "Live updates interrupted" : "Connecting live evidence"}
        </div>
      </header>

      <div className="workspace">
        <aside className="casebook" aria-labelledby="casebook-title">
          <header>
            <p className="kicker">Organization activity</p>
            <h2 id="casebook-title">Casebook</h2>
            <p>Choose a Session, then read its evidence in chronological chapters.</p>
          </header>

          <form className="case-search" onSubmit={search} role="search">
            <label htmlFor="case-query">Search cases</label>
            <div>
              <input id="case-query" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Tool, error, repository…" />
              <button type="submit" aria-label="Search Organization activity">↵</button>
            </div>
          </form>

          {activity && (
            <div className="case-aggregates" aria-label="Filtered Organization summary">
              <span><strong>{activity.aggregates.sessions}</strong> Sessions</span>
              <span><strong>{activity.aggregates.members}</strong> Members</span>
              <span><strong>{activity.aggregates.outcomes.failed}</strong> failed</span>
            </div>
          )}

          {loading && <p className="case-state">Opening the Organization casebook…</p>}
          {!loading && activity?.items.length === 0 && <p className="case-state">No real captured Sessions match this search.</p>}

          <nav className="case-list" aria-label="Organization activity cases">
            {activity?.items.map((item, index) => (
              <article className={detail?.session.id === item.id ? "case-card selected" : "case-card"} key={item.id}>
                <div className="case-card-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="case-card-copy">
                  <div className="case-card-topline">
                    <span className={`activity-dot activity-${item.activityState}`}>{label(item.activityState)}</span>
                    <time>{relativeTime(item.lastObservedAt)}</time>
                  </div>
                  <h3>{item.repository.remoteIdentity ?? "Repository unavailable"}</h3>
                  <p>{item.ownerProfile.displayName} · {label(item.annotations.outcome)}</p>
                  <div className="case-tags">{item.annotations.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  {item.synthetic.kind === "seeded" && <strong className="seeded-label">Seeded · Example</strong>}
                  <button type="button" onClick={() => void openCase(item.id)} aria-label={`Open evidence notebook for ${item.id}`}>
                    Open notebook <span>→</span>
                  </button>
                </div>
              </article>
            ))}
          </nav>
          <p className="casebook-footer">Seeded Sessions are {activity?.syntheticInclusion ?? "excluded"}. No productivity ranking is shown.</p>
        </aside>

        <section className="notebook-stage" aria-busy={caseLoading}>
          {error && <div className="api-error" role="alert"><strong>Evidence unavailable</strong><p>{error}</p></div>}
          {caseLoading && <div className="opening-case" role="status">Collating chronological evidence…</div>}
          {!caseLoading && detail ? (
            <EvidenceNotebook
              detail={detail}
              focusedEvidenceId={investigation.focusedEvidenceId}
              comparison={comparison}
              comparisonBusy={comparisonBusy}
              comparisonPeerId={comparisonPeerId}
              onComparisonPeerChange={setComparisonPeerId}
              peers={peers}
              onCompare={() => void compareSelectedCases()}
              onRevealFailure={jumpToFailure}
            />
          ) : !caseLoading && (
            <div className="empty-notebook">
              <span aria-hidden="true">⌁</span>
              <p className="kicker">Notebook unopened</p>
              <h1>Start with a case, not a dashboard.</h1>
              <p>Select an Organization Session from the casebook. Its Turns become chapters; Agent runs become inline branches; provenance stays one footnote away.</p>
              <ol>
                <li><kbd>Tab</kbd> to an “Open notebook” action.</li>
                <li><kbd>Enter</kbd> to read the case.</li>
                <li><kbd>Tab</kbd> to “Jump to first failure,” then <kbd>Enter</kbd> for the exact Tool.</li>
              </ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
