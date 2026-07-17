import { type FormEvent, useEffect, useMemo, useState } from "react";

import type {
  CandidatePackage,
  CandidateSubmissionResponse,
  OrganizationStandardDistribution,
} from "@workspace/contracts";

type Message = { tone: "success" | "error"; text: string };

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

  async function load() {
    const [candidateResponse, standardResponse] = await Promise.all([
      fetch("/api/v1/candidates"),
      fetch("/api/v1/organization-standards"),
    ]);
    if (!candidateResponse.ok || !standardResponse.ok) {
      setMessage({
        tone: "error",
        text: "Candidate approvals or distribution status could not be loaded.",
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
    await load();
  }

  async function reject(
    event: FormEvent<HTMLFormElement>,
    item: CandidateSubmissionResponse,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(
      `/api/v1/candidates/${item.candidate.id}/versions/${item.version.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: data.get("note") }),
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
    await load();
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
    const artifactHash = await hashPackage(candidatePackage);
    const response = await fetch(
      `/api/v1/candidates/${item.candidate.id}/versions/${item.version.id}/edit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: data.get("version"),
          reviewerContext: data.get("reviewerContext"),
          uncertainty: {
            level: data.get("uncertaintyLevel"),
            statement: data.get("uncertaintyStatement"),
          },
          claims: item.version.claims,
          package: candidatePackage,
          artifactHash,
        }),
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
    await load();
  }

  async function distributionAction(
    standardId: string,
    action: "pause" | "resume" | "rollback",
    releaseId?: string,
  ) {
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
    await load();
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
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone}>
          {message.text}
        </p>
      )}
      {orderedCandidates.length === 0 && (
        <p className="empty-copy">No Candidate versions are awaiting review.</p>
      )}
      <div className="candidate-list">
        {orderedCandidates.map((item) => (
          <article className="candidate-review" key={item.version.id}>
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
            <div className="artifact-files">
              {item.version.package.files.map((file) => (
                <details key={file.path} open={file.path === "SKILL.md"}>
                  <summary>{file.path}</summary>
                  <pre>{file.content}</pre>
                </details>
              ))}
            </div>
            <div className="citation-list" aria-label="Evidence citations">
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
            <p>
              {standard.installations.length} Device status report
              {standard.installations.length === 1 ? "" : "s"}
            </p>
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
