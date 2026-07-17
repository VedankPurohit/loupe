import { type FormEvent, useEffect, useMemo, useState } from "react";

import type {
  CandidatePackage,
  CandidateSubmissionResponse,
  OrganizationStandardDistribution,
} from "@workspace/contracts";

type Message = {
  tone: "success" | "error";
  text: string;
  retry?: { label: string; action: () => void | Promise<void> };
};

const claimClassificationLabels = {
  repeated_pattern: "Repeated pattern",
  single_case_hypothesis: "Single-case hypothesis",
  descriptive: "Descriptive",
} as const;

const installationStateLabels = {
  idle: "Idle",
  deferred_active_session: "Deferred active session",
  installed: "Installed",
  download_failed: "Download failed",
  verification_failed: "Verification failed",
  staging_failed: "Staging failed",
  switch_failed: "Switch failed",
  rolled_back: "Rolled back",
} as const;

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined;
  return body?.error?.message ?? fallback;
}

async function hashPackage(candidatePackage: CandidatePackage) {
  const canonical = {
    files: [...candidatePackage.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function CandidateStandards() {
  const [candidates, setCandidates] = useState<CandidateSubmissionResponse[]>([]);
  const [standards, setStandards] = useState<OrganizationStandardDistribution[]>([]);
  const [message, setMessage] = useState<Message>();
  const [editingId, setEditingId] = useState<string>();

  async function load(clearMessageOnSuccess = true) {
    try {
      const [candidateResponse, standardResponse] = await Promise.all([
        fetch("/api/v1/candidates"),
        fetch("/api/v1/organization-standards"),
      ]);
      if (!candidateResponse.ok || !standardResponse.ok) {
        setMessage({
          tone: "error",
          text: "Candidate approvals or distribution status could not be loaded.",
          retry: {
            label: "Try loading Candidate Standards again",
            action: load,
          },
        });
        return;
      }
      const candidateBody = (await candidateResponse.json()) as {
        items: CandidateSubmissionResponse[];
      };
      const standardBody = (await standardResponse.json()) as {
        items: OrganizationStandardDistribution[];
      };
      setCandidates(candidateBody.items);
      setStandards(standardBody.items);
      if (clearMessageOnSuccess) setMessage(undefined);
    } catch {
      setMessage({
        tone: "error",
        text: "Loading Candidate approvals and distribution status failed because the server could not be reached. Check the connection and try again.",
        retry: {
          label: "Try loading Candidate Standards again",
          action: load,
        },
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const orderedCandidates = useMemo(() => {
    const selectedCandidate = new URLSearchParams(window.location.search).get(
      "candidate",
    );
    const selectedVersion = new URLSearchParams(window.location.search).get("version");
    return [...candidates].sort((left, right) => {
      const leftSelected =
        left.candidate.id === selectedCandidate &&
        (!selectedVersion || left.version.id === selectedVersion);
      const rightSelected =
        right.candidate.id === selectedCandidate &&
        (!selectedVersion || right.version.id === selectedVersion);
      return Number(rightSelected) - Number(leftSelected);
    });
  }, [candidates]);

  async function approve(item: CandidateSubmissionResponse) {
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/candidates/${item.candidate.id}/versions/${item.version.id}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ artifactHash: item.version.artifactHash }),
        },
      );
      if (!response.ok) {
        setMessage({
          tone: "error",
          text: await errorMessage(response, "The exact artifact could not be approved."),
        });
        return;
      }
      setMessage({
        tone: "success",
        text: "Approved the exact artifact as a mandatory Organization standard release.",
      });
      await load(false);
    } catch {
      setMessage({
        tone: "error",
        text: "Approving the exact Candidate artifact failed because the server could not be reached. Check the connection and try again.",
        retry: {
          label: "Try approving exact artifact again",
          action: () => approve(item),
        },
      });
    }
  }

  async function reject(
    event: FormEvent<HTMLFormElement>,
    item: CandidateSubmissionResponse,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await rejectWithNote(item, String(data.get("note") ?? ""));
  }

  async function rejectWithNote(item: CandidateSubmissionResponse, note: string) {
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/candidates/${item.candidate.id}/versions/${item.version.id}/reject`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      if (!response.ok) {
        setMessage({
          tone: "error",
          text: await errorMessage(response, "The Candidate could not be rejected."),
        });
        return;
      }
      setMessage({ tone: "success", text: "Rejected this immutable Candidate version." });
      await load(false);
    } catch {
      setMessage({
        tone: "error",
        text: "Rejecting the Candidate version failed because the server could not be reached. Check the connection and try again.",
        retry: {
          label: "Try rejecting Candidate version again",
          action: () => rejectWithNote(item, note),
        },
      });
    }
  }

  async function edit(
    event: FormEvent<HTMLFormElement>,
    item: CandidateSubmissionResponse,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const candidatePackage: CandidatePackage = {
      files: item.version.package.files.map((file, index) => ({
        path: file.path,
        content: String(data.get(`file-${index}`) ?? ""),
      })),
    };
    const claims = item.version.claims.map((claim, index) => ({
      id: claim.id,
      statement: String(data.get(`claim-statement-${index}`) ?? ""),
      classification: String(
        data.get(`claim-classification-${index}`) ?? claim.classification,
      ) as typeof claim.classification,
      citationIds: data
        .getAll(`claim-citations-${index}`)
        .map((citationId) => String(citationId)),
    }));
    const artifactHash = await hashPackage(candidatePackage);
    await saveEdit(item, {
      version: data.get("version"),
      reviewerContext: data.get("reviewerContext"),
      uncertainty: {
        level: data.get("uncertaintyLevel"),
        statement: data.get("uncertaintyStatement"),
      },
      claims,
      package: candidatePackage,
      artifactHash,
    });
  }

  async function saveEdit(item: CandidateSubmissionResponse, payload: object) {
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/candidates/${item.candidate.id}/versions/${item.version.id}/edit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        setMessage({
          tone: "error",
          text: await errorMessage(response, "A new immutable version could not be created."),
        });
        return;
      }
      setEditingId(undefined);
      setMessage({
        tone: "success",
        text: "Created a new immutable version. It is unapproved and requires fresh review.",
      });
      await load(false);
    } catch {
      setMessage({
        tone: "error",
        text: "Creating a new immutable Candidate version failed because the server could not be reached. Check the connection and try again.",
        retry: {
          label: "Try saving unapproved version again",
          action: () => saveEdit(item, payload),
        },
      });
    }
  }

  async function distributionAction(
    standardId: string,
    action: "pause" | "resume" | "rollback",
    releaseId?: string,
  ) {
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/organization-standards/${standardId}/${action}`,
        {
          method: "POST",
          headers: releaseId ? { "content-type": "application/json" } : undefined,
          body: releaseId ? JSON.stringify({ releaseId }) : undefined,
        },
      );
      if (!response.ok) {
        setMessage({
          tone: "error",
          text: await errorMessage(response, `Distribution could not ${action}.`),
        });
        return;
      }
      setMessage({ tone: "success", text: `Distribution ${action} completed.` });
      await load(false);
    } catch {
      const operation = action === "pause"
        ? "Pausing distribution"
        : action === "resume"
          ? "Resuming distribution"
          : "Rolling back distribution";
      const retryLabel = action === "pause"
        ? "Try pausing distribution again"
        : action === "resume"
          ? "Try resuming distribution again"
          : "Try rolling back distribution again";
      setMessage({
        tone: "error",
        text: `${operation} failed because the server could not be reached. Check the connection and try again.`,
        retry: {
          label: retryLabel,
          action: () => distributionAction(standardId, action, releaseId),
        },
      });
    }
  }

  return (
    <section className="card standards-workbench" aria-labelledby="candidates-title">
      <p className="eyebrow">Organization learning</p>
      <h2 id="candidates-title">Candidate approvals</h2>
      <p className="lede">
        Review immutable files, evidence, uncertainty, and the exact artifact hash.
        Only a human Administrator can publish a mandatory release.
      </p>
      {message && (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`${message.tone}${message.retry ? " operation-error" : ""}`}
        >
          <span>{message.text}</span>
          {message.retry && (
            <button
              className="secondary-button"
              onClick={() => void message.retry?.action()}
              type="button"
            >
              {message.retry.label}
            </button>
          )}
        </div>
      )}
      {orderedCandidates.length === 0 && (
        <p className="empty-copy">No Candidate versions are awaiting review.</p>
      )}
      <div className="candidate-list">
        {orderedCandidates.map((item) => (
          <article
            className="candidate-review"
            aria-label={`${item.candidate.name} Candidate version ${item.version.version}`}
            key={item.version.id}
          >
            <header className="candidate-heading">
              <div>
                <span className="detail-label">Candidate skill</span>
                <h3>{item.candidate.name}</h3>
                <p>Version {item.version.version} · immutable</p>
              </div>
              <span className={`review-state review-${item.version.review.state}`}>
                {item.version.review.state === "pending_review"
                  ? "Pending review"
                  : item.version.review.state === "approved"
                    ? "Approved"
                    : "Rejected"}
              </span>
            </header>
            <dl className="candidate-metadata">
              <div>
                <dt>Exact artifact hash</dt>
                <dd><code>{item.version.artifactHash}</code></dd>
              </div>
              <div>
                <dt>Reviewer context</dt>
                <dd>{item.version.reviewerContext}</dd>
              </div>
              <div>
                <dt>Uncertainty</dt>
                <dd>
                  {item.version.uncertainty.level}: {item.version.uncertainty.statement}
                </dd>
              </div>
            </dl>
            <section className="claim-review" aria-label="Factual claims">
              <div className="section-heading">
                <div>
                  <span className="detail-label">Evidence review</span>
                  <h4>Factual claims</h4>
                </div>
                <span>{item.version.claims.length} claim{item.version.claims.length === 1 ? "" : "s"}</span>
              </div>
              <div className="claim-list">
                {item.version.claims.map((claim) => {
                  const supportingCitations = item.version.citations.filter((citation) =>
                    claim.citationIds.includes(citation.id),
                  );
                  const missingCitationIds = claim.citationIds.filter(
                    (citationId) =>
                      !item.version.citations.some(
                        (citation) => citation.id === citationId,
                      ),
                  );
                  return (
                    <article
                      className="claim-card"
                      aria-label={`Factual claim ${claim.statement}`}
                      key={claim.id}
                    >
                      <header>
                        <strong>{claim.statement}</strong>
                        <span className="claim-classification">
                          {claimClassificationLabels[claim.classification]}
                        </span>
                      </header>
                      <div className="claim-citations">
                        <span className="detail-label">Supporting evidence</span>
                        {supportingCitations.length === 0 && missingCitationIds.length === 0 ? (
                          <p>No citations mapped to this claim.</p>
                        ) : (
                          <div className="citation-list">
                            {supportingCitations.map((citation) => (
                              <a href={citation.links.browser} key={citation.id}>
                                {citation.sessionId} · {citation.turnId}
                              </a>
                            ))}
                            {missingCitationIds.map((citationId) => (
                              <span className="missing-citation" key={citationId}>
                                Missing citation · {citationId}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <div className="artifact-files">
              {item.version.package.files.map((file) => (
                <details key={file.path} open={file.path === "SKILL.md"}>
                  <summary>{file.path}</summary>
                  <pre>{file.content}</pre>
                </details>
              ))}
            </div>
            <div className="citation-list citation-inventory" aria-label="Evidence citation inventory">
              {item.version.citations.map((citation) => (
                <a href={citation.links.browser} key={citation.id}>
                  {citation.sessionId} · {citation.turnId}
                </a>
              ))}
            </div>
            {item.version.review.state === "pending_review" && (
              <div className="candidate-actions">
                <button type="button" onClick={() => void approve(item)}>
                  Approve exact artifact
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditingId(item.version.id)}
                >
                  Edit as new version
                </button>
                <form onSubmit={(event) => void reject(event, item)}>
                  <label>
                    Rejection reason
                    <input name="note" required maxLength={4_000} />
                  </label>
                  <button type="submit" className="danger">Reject version</button>
                </form>
              </div>
            )}
            {editingId === item.version.id && (
              <form className="candidate-edit" onSubmit={(event) => void edit(event, item)}>
                <h4>Create a new immutable version</h4>
                <label>
                  New version
                  <input name="version" placeholder="1.1.0" required />
                </label>
                <label>
                  Reviewer context
                  <textarea
                    name="reviewerContext"
                    defaultValue={item.version.reviewerContext}
                    required
                  />
                </label>
                <label>
                  Uncertainty level
                  <select name="uncertaintyLevel" defaultValue={item.version.uncertainty.level}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Uncertainty statement
                  <textarea
                    name="uncertaintyStatement"
                    defaultValue={item.version.uncertainty.statement}
                    required
                  />
                </label>
                <section className="claim-editors" aria-label="Edit factual claims">
                  <h5>Factual claims and supporting evidence</h5>
                  {item.version.claims.map((claim, index) => (
                    <fieldset key={claim.id}>
                      <legend>Factual claim {index + 1}</legend>
                      <label>
                        Claim statement
                        <textarea
                          name={`claim-statement-${index}`}
                          defaultValue={claim.statement}
                          required
                          maxLength={2_000}
                        />
                      </label>
                      <label>
                        Classification
                        <select
                          name={`claim-classification-${index}`}
                          defaultValue={claim.classification}
                        >
                          <option value="descriptive">Descriptive</option>
                          <option value="single_case_hypothesis">
                            Single-case hypothesis
                          </option>
                          <option value="repeated_pattern">Repeated pattern</option>
                        </select>
                      </label>
                      <div className="citation-checkboxes">
                        <span className="detail-label">Claim citations</span>
                        {item.version.citations.length === 0 ? (
                          <p>No evidence citations are available.</p>
                        ) : (
                          item.version.citations.map((citation) => (
                            <label key={citation.id}>
                              <input
                                type="checkbox"
                                name={`claim-citations-${index}`}
                                value={citation.id}
                                defaultChecked={claim.citationIds.includes(citation.id)}
                              />
                              <span>{citation.sessionId} · {citation.turnId}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </fieldset>
                  ))}
                </section>
                {item.version.package.files.map((file, index) => (
                  <label key={file.path}>
                    {file.path}
                    <textarea
                      className="artifact-editor"
                      name={`file-${index}`}
                      defaultValue={file.content}
                      required
                    />
                  </label>
                ))}
                <div className="inline-actions">
                  <button type="submit">Save unapproved version</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingId(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>

      <div className="distribution-section">
        <h3>Mandatory distribution</h3>
        {standards.length === 0 && <p>No approved releases yet.</p>}
        {standards.map((standard) => (
          <article className="distribution-card" key={standard.standardId}>
            <header>
              <strong>{standard.name}</strong>
              <span>{standard.state === "active" ? "Active" : "Paused"}</span>
            </header>
            <p>
              Target {standard.target?.version ?? "none"} · manifest sequence {standard.sequence}
            </p>
            <section className="release-history" aria-label="Release history">
              <h4>Release history</h4>
              {standard.releases.length === 0 ? (
                <p>No releases have been approved.</p>
              ) : (
                <div className="release-list">
                  {standard.releases.map((release) => (
                    <article key={release.releaseId}>
                      <header>
                        <strong>Version {release.version}</strong>
                        {release.releaseId === standard.target?.releaseId && (
                          <span className="current-release">Current target</span>
                        )}
                      </header>
                      <dl>
                        <div>
                          <dt>Release ID</dt>
                          <dd><code>{release.releaseId}</code></dd>
                        </div>
                        <div>
                          <dt>Approved at</dt>
                          <dd><time dateTime={release.approvedAt}>{release.approvedAt}</time></dd>
                        </div>
                        <div>
                          <dt>Artifact hash</dt>
                          <dd><code>{release.artifactHash}</code></dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="installation-reports" aria-label="Device installation reports">
              <h4>
                Device installation reports <span>{standard.installations.length}</span>
              </h4>
              {standard.installations.length === 0 ? (
                <p>No Device installation reports received.</p>
              ) : (
                <div className="installation-list">
                  {standard.installations.map((installation) => (
                    <article
                      className="installation-report"
                      aria-label={`Device ${installation.deviceId}`}
                      key={`${installation.deviceId}-${installation.serverReceivedAt}`}
                    >
                      <header>
                        <div>
                          <span className="detail-label">Device</span>
                          <strong>{installation.deviceId}</strong>
                        </div>
                        <span className={`installation-state installation-${installation.state}`}>
                          {installationStateLabels[installation.state]}
                        </span>
                      </header>
                      <dl>
                        <div>
                          <dt>Installed release</dt>
                          <dd>
                            {installation.installedReleaseId ? (
                              <code>{installation.installedReleaseId}</code>
                            ) : "None"}
                          </dd>
                        </div>
                        <div>
                          <dt>Reported release</dt>
                          <dd>
                            {installation.releaseId ? (
                              <code>{installation.releaseId}</code>
                            ) : "None"}
                          </dd>
                        </div>
                        <div>
                          <dt>Observed at</dt>
                          <dd>
                            <time dateTime={installation.observedAt}>
                              {installation.observedAt}
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>Received at</dt>
                          <dd>
                            <time dateTime={installation.serverReceivedAt}>
                              {installation.serverReceivedAt}
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>Active Session IDs</dt>
                          <dd>
                            {installation.activeSessionIds.length === 0 ? (
                              "None"
                            ) : (
                              <ul className="session-id-list">
                                {installation.activeSessionIds.map((sessionId) => (
                                  <li key={sessionId}><code>{sessionId}</code></li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Failure stage</dt>
                          <dd>{installation.failure?.stage ?? "None"}</dd>
                        </div>
                        <div>
                          <dt>Failure code</dt>
                          <dd>{installation.failure?.code ?? "None"}</dd>
                        </div>
                        <div className="installation-message">
                          <dt>Failure message</dt>
                          <dd>{installation.failure?.message ?? "None"}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <div className="inline-actions">
              <button
                type="button"
                onClick={() =>
                  void distributionAction(
                    standard.standardId,
                    standard.state === "active" ? "pause" : "resume",
                  )
                }
              >
                {standard.state === "active" ? "Pause distribution" : "Resume distribution"}
              </button>
              {standard.previousReleaseId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void distributionAction(
                      standard.standardId,
                      "rollback",
                      standard.previousReleaseId!,
                    )
                  }
                >
                  Roll back to previous release
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
