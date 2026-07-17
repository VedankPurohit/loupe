import type {
  ComparisonResponse,
  ExecutionSessionDetail,
  ToolEvidence,
} from "@workspace/contracts";

import { Sparkline } from "./Sparkline.js";

export type ComparisonSummary = {
  classification: string;
  status: string;
  population: string;
  caveats: string[];
  refusal?: string;
};

type EvidenceNotebookProps = {
  detail: ExecutionSessionDetail;
  focusedEvidenceId: string | null;
  comparison?: ComparisonSummary;
  comparisonBusy: boolean;
  comparisonPeerId?: string;
  onComparisonPeerChange: (id: string) => void;
  peers: Array<{ id: string; label: string }>;
  onCompare: () => void;
  onRevealFailure: () => void;
};

const label = (value: string) => value.replaceAll("_", " ");
const time = (value: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));

function Footnote({
  index,
  evidence,
  note,
}: {
  index: number;
  evidence: { stability: string[]; derivation: string; sourceEventIds: string[] };
  note?: string;
}) {
  return (
    <details className="footnote">
      <summary>
        [{index}] {evidence.derivation} · {evidence.stability.join(" + ")}
      </summary>
      <div>
        <p>{note ?? "This display preserves the API evidence classification."}</p>
        <p>
          {evidence.sourceEventIds.length
            ? `Source event${evidence.sourceEventIds.length === 1 ? "" : "s"}: ${evidence.sourceEventIds.join(", ")}`
            : "Source event unavailable from captured evidence."}
        </p>
      </div>
    </details>
  );
}

function ToolCard({ tool, number }: { tool: ToolEvidence; number: number }) {
  const isFailure = tool.outcome === "failure";
  return (
    <article
      className={`evidence-card tool-card outcome-${tool.outcome}`}
      id={`evidence-${tool.id}`}
      tabIndex={-1}
      aria-label={`${tool.toolName}, ${tool.outcome}`}
    >
      <header>
        <span className="evidence-number">E{number.toString().padStart(2, "0")}</span>
        <div>
          <p className="evidence-kind">Tool invocation · {time(tool.occurredAt)}</p>
          <h4>{tool.toolName}</h4>
        </div>
        <span className={`outcome outcome-${tool.outcome}`}>
          {isFailure ? "Failed" : label(tool.outcome)}
        </span>
      </header>
      <dl className="tool-facts">
        <div><dt>Duration</dt><dd>{tool.durationMs == null ? "Unavailable" : `${tool.durationMs.toLocaleString()} ms`}</dd></div>
        <div><dt>Retry count</dt><dd>{tool.retryCount == null ? "Unavailable" : tool.retryCount}</dd></div>
        <div><dt>Approval</dt><dd>{label(tool.approval)}</dd></div>
        <div><dt>Turn link</dt><dd>{tool.turnAssociation.turnId ?? "Unavailable"}</dd></div>
      </dl>
      {isFailure && tool.result != null && (
        <div className="failure-reading">
          <strong>What the evidence says</strong>
          <p>{typeof tool.result === "object" && "summary" in tool.result ? String(tool.result.summary) : JSON.stringify(tool.result)}</p>
          <p className="caution">This is a captured failure, not a causal diagnosis.</p>
        </div>
      )}
      {tool.coverageGaps.map((gap) => <p className="gap" key={gap}>Gap · {gap}</p>)}
      <Footnote index={number} evidence={tool.evidence} note={`Hook id ${tool.identifiers.hookToolUseId ?? "unavailable"}; OTel call id ${tool.identifiers.otelCallId ?? "unavailable"}.`} />
    </article>
  );
}

export function normalizeComparison(response: ComparisonResponse): ComparisonSummary {
  return {
    classification: label(response.claim.classification),
    status: response.claim.status,
    population: `${response.population.distinctRealTurns} distinct real Turns · ${response.population.seededTurns} Seeded Turns`,
    caveats: response.claim.caveats,
    refusal: response.claim.refusal?.message,
  };
}

export function EvidenceNotebook({
  detail,
  focusedEvidenceId,
  comparison,
  comparisonBusy,
  comparisonPeerId,
  onComparisonPeerChange,
  peers,
  onCompare,
  onRevealFailure,
}: EvidenceNotebookProps) {
  const { session, evidence } = detail;
  const failures = evidence.tools.filter(({ outcome }) => outcome === "failure");
  const tokenValues = evidence.tokenUsage.map(({ categories }) => categories.total).filter((value): value is number => value != null);
  const contextValues = evidence.context.occupancy.map(({ occupancyPercent }) => occupancyPercent).filter((value): value is number => value != null);
  const root = detail.agentRuns.find(({ kind }) => kind === "root");
  const branches = detail.agentRuns.filter(({ kind }) => kind === "subagent");

  return (
    <main className="notebook" aria-labelledby="case-title">
      <header className="case-heading">
        <div className="case-stamp" aria-hidden="true">CASE<br />{session.id.slice(-5).toUpperCase()}</div>
        <div className="case-title-block">
          <p className="kicker">Investigation notebook · {session.annotations.reviewStatus === "needs_help" ? "review requested" : "recorded case"}</p>
          <h1 id="case-title">{session.ownerProfile.displayName} / {session.annotations.tags.join(" · ") || "untagged Session"}</h1>
          <p className="case-deck">
            A chronological reading of <strong>{session.id}</strong>. Session completion is not assumed; its current Activity state is {session.activityState}.
          </p>
        </div>
        <button className="failure-jump" type="button" onClick={onRevealFailure} disabled={!failures.length}>
          <span>{failures.length ? `${failures.length} failed Tool${failures.length === 1 ? "" : "s"}` : "No failed Tool captured"}</span>
          <strong>{failures.length ? "Jump to first failure ↘" : "Continue reading"}</strong>
        </button>
      </header>

      <section className="reading-strip" aria-label="Case signals">
        <div><span>Repository</span><strong>{session.gitContext?.repositoryRoot ?? "Unavailable from captured evidence"}</strong></div>
        <div><span>Outcome</span><strong>{label(session.annotations.outcome)} · human assigned</strong></div>
        <Sparkline label="Provider Token total" values={tokenValues} tone="token" />
        <Sparkline label="Context occupancy %" values={contextValues} tone="context" />
      </section>

      <div className="notebook-grid">
        <article className="chapters" aria-label="Chronological evidence chapters">
          <header className="chapter-opener">
            <p>Reading order</p>
            <h2>The case unfolded in {detail.turns.length} Turns.</h2>
            <p>Agent branches are stitched into the chronology where captured evidence places them. Expand numbered footnotes for provenance.</p>
          </header>

          {detail.turns.map((turn, turnIndex) => {
            const turnTools = evidence.tools.filter(({ turnAssociation }) => turnAssociation.turnId === turn.id);
            const events = detail.timeline.filter(({ turnId }) => turnId === turn.id);
            const turnBranches = branches.filter(({ firstObservedAt }) => firstObservedAt >= turn.firstObservedAt && firstObservedAt <= turn.lastObservedAt);
            return (
              <section className="chapter" id={`turn-${turn.id}`} key={turn.id}>
                <div className="chapter-marker"><span>{turnIndex + 1}</span><i /></div>
                <div className="chapter-body">
                  <header>
                    <p>Chapter {turnIndex + 1} · {time(turn.firstObservedAt)}–{time(turn.lastObservedAt)}</p>
                    <h3>{turnIndex === 0 ? "The root run delegates a narrow search" : "The Session resumes with the failure still open"}</h3>
                    <Footnote index={turnIndex + 1} evidence={turn.evidence} note={`Turn association belongs to agent run ${turn.agentRunId}.`} />
                  </header>

                  <div className="branch-thread">
                    <div className="agent-line root-line">
                      <span className="agent-glyph">R</span>
                      <div><strong>Root agent run</strong><small>{root?.id ?? turn.agentRunId}</small></div>
                    </div>
                    {turnBranches.map((branch) => (
                      <div className="agent-line branch-line" key={branch.id}>
                        <span className="agent-glyph">↳</span>
                        <div>
                          <strong>{branch.agentType ?? "Subagent run"}</strong>
                          <small>{branch.parentEdge?.status ?? "unresolved"} parent edge · {branch.id}</small>
                        </div>
                      </div>
                    ))}
                  </div>

                  <ol className="event-notes">
                    {events.map((event) => (
                      <li key={`${event.sourceEventId}-${event.event}`}>
                        <time>{time(event.occurredAt)}</time>
                        <span>{label(event.event)}</span>
                        <em>{event.evidence.derivation}</em>
                      </li>
                    ))}
                  </ol>

                  <div className="evidence-stack">
                    {turnTools.map((tool) => (
                      <ToolCard key={tool.id} tool={tool} number={evidence.tools.indexOf(tool) + 1} />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </article>

        <aside className="case-margin" aria-label="Investigator margin">
          <section className="margin-note">
            <p className="margin-label">Working diagnosis</p>
            <h2>{failures.length ? "A Tool failure, followed by retry and resume." : "No failure appears in captured Tools."}</h2>
            <p>{failures.length ? "The notebook can prove the command failed. It cannot prove the failure caused the Session outcome." : "Absence of a captured failure is not proof that no failure occurred."}</p>
          </section>

          <section className="margin-note fidelity-note">
            <p className="margin-label">Fidelity ledger</p>
            <dl>
              <div><dt>Exact / observed</dt><dd>{evidence.tools.filter((tool) => tool.evidence.derivation === "exact").length} Tools</dd></div>
              <div><dt>Inferred</dt><dd>{evidence.tools.filter((tool) => tool.evidence.derivation === "inferred").length} Tools</dd></div>
              <div><dt>Unavailable</dt><dd>{evidence.tools.filter((tool) => tool.evidence.derivation === "unavailable").length} Tools</dd></div>
            </dl>
            <p className="unavailable-callout">{evidence.context.contribution.note}</p>
          </section>

          <section className="margin-note comparison-note">
            <p className="margin-label">Evidence comparison</p>
            <h2>Test the reading against another case</h2>
            <label>
              Comparison case
              <select value={comparisonPeerId ?? ""} onChange={(event) => onComparisonPeerChange(event.currentTarget.value)}>
                <option value="">Choose a case</option>
                {peers.map((peer) => <option value={peer.id} key={peer.id}>{peer.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={onCompare} disabled={!comparisonPeerId || comparisonBusy}>
              {comparisonBusy ? "Reading evidence…" : "Compare captured pattern"}
            </button>
            {comparison && (
              <div className="comparison-reading" role="status">
                <strong>{comparison.classification}</strong>
                <span>{comparison.status}</span>
                <p>{comparison.population}</p>
                {comparison.refusal && <p>{comparison.refusal}</p>}
                {comparison.caveats.map((caveat) => <small key={caveat}>{caveat}</small>)}
              </div>
            )}
          </section>
        </aside>
      </div>

      <p className="focus-announcement" aria-live="polite">
        {focusedEvidenceId ? `Focused exact Tool evidence ${focusedEvidenceId}.` : ""}
      </p>
    </main>
  );
}
