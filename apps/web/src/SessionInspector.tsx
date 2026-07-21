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
  buildInvestigationNodes,
  evidenceState as canonicalEvidenceState,
  firstFailedTool,
  modelEvidence,
  tokenCategorySummary,
  type InvestigationTarget,
  targetMatches,
  timelineEventId,
  turnEvidence,
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

function investigationKindLabel(kind: InvestigationTarget["kind"]) {
  if (kind === "apiRequest") return "API request";
  return title(kind);
}

function tokenCategoryLabel(category: string) {
  return ({
    input: "Input",
    cachedInput: "Cached input",
    output: "Output",
    reasoningOutput: "Reasoning output",
    total: "Total",
  } as Record<string, string>)[category] ?? title(category);
}

function capabilityDistinction(capability: ExecutionSessionDetail["evidence"]["capabilities"][number]) {
  return ({
    configured_mcp_servers: "MCP configured · not proof of use",
    observed_mcp_use: "MCP observed use · invocation evidence",
    explicit_skill_mention: "Skill explicit mention",
    implicit_skill_activation: "Skill implicit activation · inferred",
    complete_passive_capability_snapshot: capability.state === "unavailable" ? "Unsupported capture · source unavailable" : "Complete passive capability snapshot",
    fork: "Fork capability",
  } as const)[capability.capability];
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
  const state = canonicalEvidenceState(evidence);
  return (
    <span className={`fidelity fidelity-${state}`} title={text}>
      <span aria-hidden="true" className="fidelity-dot" />
      {compact ? <span className="sr-only">Evidence: {text}</span> : text}
    </span>
  );
}

function ProvenanceFootnote({ evidence, label = "Provenance", includeReferences = true }: { evidence: Evidence; label?: string; includeReferences?: boolean }) {
  return (
    <details className="provenance-footnote">
      <summary>{label} · {evidence.derivation}</summary>
      <p>{evidenceText(evidence)}.</p>
      {evidence.sourceEventIds.length ? (
        <ul>{evidence.sourceEventIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
      ) : evidence.references?.some(
          (reference) => reference.origin === "example_pack_server_controlled",
      ) && includeReferences ? (
        <ul>
          {evidence.references.flatMap((reference) =>
            reference.origin === "example_pack_server_controlled"
              ? [
                  <li key={reference.syntheticEvidenceId}>
                    Server-controlled Example-pack evidence · {reference.examplePackVersion} · <code>{reference.syntheticEvidenceId}</code>
                  </li>,
                ]
              : [],
          )}
        </ul>
      ) : evidence.references?.some(
          (reference) => reference.origin === "example_pack_server_controlled",
        ) ? (
        <p>Example-pack provenance is attached to the corresponding Activity evidence.</p>
      ) : (
        <p>No source-event identifier is available for this derived view.</p>
      )}
    </details>
  );
}

function json(value: unknown) {
  return value === null ? "Source unavailable" : JSON.stringify(value, null, 2);
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

function SessionSummary({ detail }: { detail: ExecutionSessionDetail }) {
  const git = detail.session.gitContext;
  const repository = git?.remoteIdentity ?? git?.repositoryRoot;
  const folder = git?.worktree ?? git?.provenance.cwd;
  const models = [...new Set(detail.evidence.tokenUsage.map((sample) => sample.model).filter(Boolean))];
  const evidenceRows: Evidence[] = [
    ...detail.agentRuns.map((agent) => agent.identityEvidence),
    ...detail.turns.map((turn) => turn.evidence),
    ...detail.evidence.tools.map((tool) => tool.evidence),
    ...(detail.evidence.apiRequests ?? []).map((request) => request.evidence),
    ...detail.evidence.lifecycle.map((event) => event.evidence),
    ...detail.evidence.tokenUsage.map((sample) => sample.evidence),
    ...detail.evidence.capabilities.map((capability) => capability.evidence),
    ...detail.evidence.context.limits.map((limit) => limit.evidence),
    ...detail.evidence.context.occupancy.map((sample) => sample.evidence),
    ...(detail.evidence.context.firstRequestBaseline ? [detail.evidence.context.firstRequestBaseline.evidence] : []),
    detail.evidence.context.contribution.evidence,
    ...detail.evidence.costEstimates.flatMap((estimate) => estimate.evidence ? [estimate.evidence] : []),
  ];
  const observed = evidenceRows.filter((row) => canonicalEvidenceState(row) === "exact").length;
  const inferred = evidenceRows.filter((row) => canonicalEvidenceState(row) === "inferred").length;
  const unstable = evidenceRows.filter((row) => canonicalEvidenceState(row) === "unstable").length;
  const unavailable = evidenceRows.filter((row) => canonicalEvidenceState(row) === "unavailable").length;
  const failures = detail.evidence.tools.filter((tool) => tool.outcome === "failure").length +
    (detail.evidence.apiRequests ?? []).filter((request) => request.success === false).length;
  const identity = detail.session.synthetic.kind === "seeded" ? "Seeded Example" : "Real captured";
  const folderLabel = git?.status === "not_repository" ? "Not a repository · folder observed (repository not applicable)" : folder ?? "Folder not yet observed";
  const repositoryLabel = repository ?? (git?.status === "not_repository" ? "Not a repository (not applicable)" : "Repository source unavailable");

  return (
    <section className="session-summary" aria-label="Session summary">
      <header className="session-summary-heading">
        <div>
          <span className="section-code">Evidence-first summary</span>
          <h3>Session summary</h3>
          <p className="session-summary-owner">Owner · {detail.session.ownerProfile.displayName}</p>
        </div>
        <span className={`capture-identity identity-${detail.session.synthetic.kind}`}>{identity}</span>
      </header>
      <dl className="session-summary-facts">
        <Fact label="Owner">{detail.session.ownerProfile.displayName}</Fact>
        <Fact label="Repository"><span title={git?.provenance.source === "relay_local_git" ? "Derived from a relay-local Git observation" : undefined}>{repositoryLabel}</span></Fact>
        <Fact label="Folder / worktree"><span title={folder ? "Observed from relay-local Git context" : undefined}>{folderLabel}</span></Fact>
        <Fact label="Branch / commit">{git?.branch ?? "Branch not yet observed"}{git?.commit ? ` · ${shortId(git.commit)}` : ""}</Fact>
        <Fact label="Activity state">{title(detail.session.activityState)}</Fact>
        <Fact label="Turns">{detail.turns.length} {detail.turns.length === 1 ? "Turn" : "Turns"}</Fact>
        <Fact label="Model evidence">{models.length ? models.join(", ") : "Model not yet observed"}</Fact>
        <Fact label="Coverage"><span className="coverage-summary-value">{observed} observed · {inferred} inferred · {unstable} unstable · {unavailable} source unavailable</span></Fact>
      </dl>
      <div className="session-summary-foot">
        <span>{failures ? `${failures} execution or provider failure${failures === 1 ? "" : "s"} retained` : "No execution or provider failures retained"}</span>
        <details>
          <summary>Coverage details and derivation</summary>
          <p>Observed values come from accepted evidence. Inferred values name their derivation; source-unavailable values were not delivered by the producer.</p>
          <ul>
            <li>Git folder and repository: {git ? "relay-local observation" : "not yet observed"}</li>
            <li>Model selection: {models.length ? "provider Token samples" : "not yet observed"}</li>
            <li>Turn count: canonical Turns attached to this Session</li>
          </ul>
        </details>
      </div>
    </section>
  );
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
  onPageChange,
}: {
  activity?: OrganizationActivityResponse;
  selectedId?: string;
  selectedForComparison: string[];
  onOpen: (id: string) => void;
  onToggleComparison: (id: string) => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <aside className="organization-rail" aria-labelledby="organization-activity-title">
      <header className="rail-heading">
        <div>
          <span className="section-code">Organization evidence</span>
          <h2 id="organization-activity-title">Organization activity</h2>
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
              {session.synthetic.kind === "seeded" ? <b className="seeded-label">Seeded · Example</b> : <b className="real-label">Real capture</b>}
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
          <span>Clear the query and filters, or include Seeded examples.</span>
        </div>
      )}
      {activity && activity.page.total > 0 && (
        <nav className="activity-pagination" aria-label="Activity pagination">
          <button aria-label="Previous activity page" disabled={activity.page.page <= 1} onClick={() => onPageChange(activity.page.page - 1)} type="button">Previous</button>
          <span>Page {activity.page.page} · {activity.page.total.toLocaleString()} Sessions</span>
          <button aria-label="Next activity page" disabled={!activity.page.hasMore} onClick={() => onPageChange(activity.page.nextPage ?? activity.page.page + 1)} type="button">Next</button>
        </nav>
      )}
    </aside>
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
  const nodes = buildInvestigationNodes(detail);
  return (
    <section className="linear-timeline" aria-label="Linear execution timeline">
      <header>
        <span className="section-code">Chronological route</span>
        <h3>Timeline and provenance</h3>
      </header>
      <ol aria-label={`${nodes.length} chronological evidence nodes`}>
        {nodes.map((node) => {
          const nodeTarget: InvestigationTarget = { kind: node.kind, id: node.id };
          const selected = targetMatches(target, nodeTarget);
          return (
            <li className={selected ? "is-selected" : ""} key={`${node.kind}-${node.id}`}>
              <button
                aria-current={selected ? "true" : undefined}
                aria-label={`${detail.session.synthetic.kind === "seeded" ? "Seeded · " : ""}${node.kind === "lifecycle" || node.kind === "apiRequest" ? investigationKindLabel(node.kind) : `${investigationKindLabel(node.kind)}:`} ${node.label}${node.turnId ? ` · ${node.turnId}` : ""}; ${node.evidence.derivation} evidence${node.outcome === "failure" ? "; failed" : ""}`}
                onClick={() => onTarget(nodeTarget)}
                type="button"
              >
                <time dateTime={node.occurredAt}>{clock(node.occurredAt)}</time>
                <span>
                  <b>{investigationKindLabel(node.kind)}</b>
                  {detail.session.synthetic.kind === "seeded" && (
                    <b className="seeded-label">Seeded</b>
                  )}
                  {node.label}
                  {node.turnId && <code>{node.turnId}</code>}
                </span>
                {node.outcome === "failure" && <strong className="failure-label">Failed</strong>}
                <EvidenceMark compact evidence={node.evidence} />
              </button>
              <ProvenanceFootnote evidence={node.evidence} includeReferences={node.kind === "activity"} label={node.kind === "activity" ? "Provenance" : "Turn provenance"} />
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
  const turn = target.kind === "turn" ? detail.turns.find(({ id }) => id === target.id) : undefined;
  const activity = target.kind === "activity" ? detail.timeline.find((event) => timelineEventId(event) === target.id) : undefined;
  const lifecycle = target.kind === "lifecycle" ? detail.evidence.lifecycle.find(({ id }) => id === target.id) : undefined;
  const apiRequest = target.kind === "apiRequest" ? detail.evidence.apiRequests.find(({ id }) => id === target.id) : undefined;
  const token = target.kind === "token" ? detail.evidence.tokenUsage.find(({ id }) => id === target.id) : undefined;
  const evidence = tool?.evidence ?? agent?.identityEvidence ?? turn?.evidence ?? activity?.evidence ?? lifecycle?.evidence ?? apiRequest?.evidence ?? token?.evidence ?? {
    stability: ["observed"] as const,
    derivation: "exact" as const,
    sourceEventIds: [],
  };
  const occupancy = detail.evidence.context.occupancy.at(-1);
  const selectedTurnEvidence = turn ? turnEvidence(detail, turn.id) : undefined;
  const selectedTurnModel = turn ? modelEvidence(detail, turn.id) : undefined;
  const selectedTurnToken = selectedTurnEvidence?.tokenUsage[0];
  const selectedTurnOccupancy = selectedTurnToken
    ? detail.evidence.context.occupancy.find(({ tokenUsageId }) => tokenUsageId === selectedTurnToken.id)
    : undefined;

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
              <Fact label="Duration">{tool.durationMs === null ? "Source unavailable" : `${tool.durationMs} ms`}</Fact>
              <Fact label="Retries">{tool.retryCount ?? "Not yet observed"}</Fact>
              <Fact label="Approval">{tool.approval === "unavailable" ? "Source unavailable" : title(tool.approval)}</Fact>
              <Fact label="Turn association">{tool.turnAssociation.strength === "unavailable" ? "Source unavailable" : title(tool.turnAssociation.strength)}</Fact>
              <Fact label="MCP origin">{/^mcp(?:__|_|$)/i.test(tool.toolName) ? "MCP-style Tool name observed; server identity source unavailable." : "No MCP origin is asserted by captured Tool evidence."}</Fact>
            </dl>
            {(containsRelayRedactionPlaceholder(tool.input) || containsRelayRedactionPlaceholder(tool.result)) && (
              <p className="redaction-label">Redacted content · capture policy preserved the evidence boundary</p>
            )}
            <section className="evidence-payload"><h3>Input</h3><pre>{json(tool.input)}</pre></section>
            <section className="evidence-payload"><h3>Result</h3><pre>{json(tool.result)}</pre></section>
            {!!tool.coverageGaps.length && <p className="coverage-gap">Coverage gap · {tool.coverageGaps.map(words).join(", ")}. Next safe action · Check Device diagnostics and the adapter capture boundary before drawing conclusions.</p>}
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
        {turn && selectedTurnEvidence && selectedTurnModel && (
          <>
            <p className="eyebrow">Turn evidence</p>
            <h2 ref={headingRef} tabIndex={-1}>Turn {shortId(turn.id)}</h2>
            <code>{turn.id}</code>
            <dl className="inspector-facts">
              <Fact label="Evidence state">{title(canonicalEvidenceState(turn.evidence))}</Fact>
              <Fact label="Tools">{selectedTurnEvidence.tools.length || "Not yet observed"}</Fact>
              <Fact label="Logical model evidence">{selectedTurnModel.logicalModels.length ? selectedTurnModel.logicalModels.join(", ") : "Model not yet observed"}</Fact>
              <Fact label="API attempts">{selectedTurnEvidence.apiRequests.length || "Not yet observed"}</Fact>
              <Fact label="Token sample">{selectedTurnToken ? selectedTurnToken.sourceKind === "provider_completion" ? "Provider completion" : "Turn total" : "Not yet observed"}</Fact>
              <Fact label="Capability records">{selectedTurnEvidence.capabilities.length || "Not yet observed"}</Fact>
            </dl>
            <p className="edge-note edge-inferred">Model caveat · {selectedTurnModel.caveat}</p>
            <section aria-label="Provider transport attempts" className="evidence-payload" role="group">
              <h3>Provider transport attempts</h3>
              {selectedTurnModel.transportAttempts.length ? (
                <ul>{selectedTurnModel.transportAttempts.map((request) => (
                  <li key={request.id}>
                    Attempt {request.attempt ?? "unavailable"} · HTTP {request.statusCode ?? "unavailable"} · {request.success === true ? "Success" : request.success === false ? "Failure" : "Source unavailable"}
                  </li>
                ))}</ul>
              ) : <p>No provider transport attempt was observed for this Turn.</p>}
            </section>
            <section aria-label="Token categories" className="evidence-payload" role="group">
              <h3>Token categories</h3>
              {selectedTurnToken ? (
                <dl className="inspector-facts">
                  {Object.entries(tokenCategorySummary(selectedTurnToken)).map(([category, value]) => (
                    <Fact key={category} label={tokenCategoryLabel(category)}>{value === "unavailable" ? "Source unavailable" : value.toLocaleString()}</Fact>
                  ))}
                </dl>
              ) : <p>No Token sample was observed for this Turn.</p>}
            </section>
            <section aria-label="Context occupancy calculation" className="evidence-payload" role="group">
              <h3>Context occupancy calculation</h3>
              {selectedTurnOccupancy ? (
                <>
                  <p>Method · Provider input Tokens ÷ reported Context window</p>
                  <p>{selectedTurnOccupancy.inputs.inputTokens.toLocaleString()} input Tokens ÷ {selectedTurnOccupancy.inputs.contextWindow?.toLocaleString() ?? "source-unavailable"} Token window = {selectedTurnOccupancy.occupancyPercent?.toFixed(1) ?? "source unavailable"}%</p>
                  <p>Missing assumptions · {selectedTurnOccupancy.missingAssumptions.length ? selectedTurnOccupancy.missingAssumptions.join(" · ") : "None reported"}</p>
                </>
              ) : <p>Context occupancy is source unavailable for this Turn.</p>}
              <p>Contribution · {title(detail.evidence.context.contribution.status)} · {detail.evidence.context.contribution.method} · {detail.evidence.context.contribution.note}</p>
            </section>
            <section aria-label="Capability distinctions" className="evidence-payload" role="group">
              <h3>Capability distinctions</h3>
              <p>Capability records are Session-scoped unless their own provenance says otherwise.</p>
              {selectedTurnEvidence.capabilities.length ? (
                <ul>{selectedTurnEvidence.capabilities.map((capability, index) => (
                  <li key={`${capability.capability}-${index}`}>
                    <strong>{capabilityDistinction(capability)}</strong> · {title(capability.state)} · {capability.note}
                    {capability.state === "unavailable" && <> Next safe action · Check the adapter capture boundary; do not infer this capability.</>}
                  </li>
                ))}</ul>
              ) : <p>Capability evidence is source unavailable. Check the adapter capture boundary before drawing conclusions.</p>}
            </section>
            <p className="edge-note edge-inferred">Context caveat · {detail.evidence.context.contribution.note}</p>
            <ProvenanceFootnote evidence={turn.evidence} label="Turn provenance" />
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
            {firstFailedTool(detail) && (
              <button className="failure-jump" onClick={() => onFailure(true)} type="button">Follow to first failed Tool <kbd>F</kbd></button>
            )}
          </>
        )}
        {lifecycle && (
          <>
            <p className="eyebrow">Lifecycle evidence</p>
            <h2 ref={headingRef} tabIndex={-1}>{title(lifecycle.event)}</h2>
            <code>{lifecycle.id}</code>
            <dl className="inspector-facts">
              <Fact label="Kind">{title(lifecycle.kind)}</Fact>
              <Fact label="Occurred">{clock(lifecycle.occurredAt)}</Fact>
              <Fact label="Turn">{lifecycle.turnAssociation.turnId ?? "Source unavailable"}</Fact>
              <Fact label="Association">{title(lifecycle.turnAssociation.strength)}</Fact>
            </dl>
            <section className="evidence-payload"><h3>Lifecycle details</h3><pre>{json(lifecycle.details)}</pre></section>
          </>
        )}
        {apiRequest && (
          <>
            <p className="eyebrow">Provider transport evidence</p>
            <h2 ref={headingRef} tabIndex={-1}>Provider API attempt {apiRequest.attempt ?? "unavailable"}</h2>
            <code>{apiRequest.id}</code>
            <dl className="inspector-facts">
              <Fact label="Status">{apiRequest.statusCode ?? "Source unavailable"}</Fact>
              <Fact label="Outcome">{apiRequest.success === true ? "Success" : apiRequest.success === false ? "Failure" : "Source unavailable"}</Fact>
              <Fact label="Duration">{apiRequest.durationMs === null ? "Source unavailable" : `${apiRequest.durationMs} ms`}</Fact>
              <Fact label="Turn">{apiRequest.turnAssociation.turnId ?? "Source unavailable"}</Fact>
            </dl>
            <p className="edge-note edge-inferred">Transport caveat · Provider API attempts are not stable logical model requests.</p>
            {apiRequest.error && <p className="coverage-gap">Provider error · {apiRequest.error}</p>}
          </>
        )}
        {token && (
          <>
            <p className="eyebrow">Provider Token usage</p>
            <h2 ref={headingRef} tabIndex={-1}>{token.categories.total?.toLocaleString() ?? "Unavailable"} tokens</h2>
            <code>{token.id}</code>
            <dl className="inspector-facts">
              <Fact label="Model">{token.model ?? "Model not yet observed"}</Fact>
              <Fact label="Source">{token.sourceKind === "provider_completion" ? "Provider completion" : "Turn total"}</Fact>
              <Fact label="Service tier">{token.serviceTier ?? "Source unavailable"}</Fact>
              <Fact label="Turn association">{token.turnAssociation.turnId ?? "Source unavailable"}</Fact>
            </dl>
            <section aria-label="Token categories" className="evidence-payload" role="group">
              <h3>Token categories</h3>
              <dl className="inspector-facts">
                {Object.entries(tokenCategorySummary(token)).map(([category, value]) => (
                  <Fact key={category} label={tokenCategoryLabel(category)}>{value === "unavailable" ? "Source unavailable" : value.toLocaleString()}</Fact>
                ))}
              </dl>
            </section>
            <p className="edge-note edge-inferred">Model caveat · A provider Token sample can name a model, but does not prove one stable logical model request.</p>
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
            {firstFailedTool(detail) ? (
              <button className="failure-jump" onClick={() => onFailure(true)} type="button">
                Jump to first failed Tool <kbd>F</kbd>
              </button>
            ) : (
              <p className="no-failure-note"><span aria-hidden="true">✓</span> No failed Tools in this Session</p>
            )}
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
  const [repositoryFilter, setRepositoryFilter] = useState(parameters.get("repository") ?? "");
  const [memberFilter, setMemberFilter] = useState(parameters.get("memberId") ?? "");
  const [appliedRepository, setAppliedRepository] = useState(parameters.get("repository") ?? "");
  const [appliedMember, setAppliedMember] = useState(parameters.get("memberId") ?? "");
  const [page, setPage] = useState(Number(parameters.get("page") ?? "1") || 1);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparisonClaim, setComparisonClaim] = useState("The selected Sessions show a repeated Tool failure pattern.");
  const [comparisonKind, setComparisonKind] = useState<"pattern" | "outcome" | "causal" | "productivity">("pattern");
  const [comparison, setComparison] = useState<ComparisonResponse>();
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
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
      if (appliedRepository) search.set("repository", appliedRepository);
      if (appliedMember) search.set("memberId", appliedMember);
      search.set("page", String(page));
      search.set("pageSize", "25");
      const next = await fetchJson<OrganizationActivityResponse>(`/api/v1/organization/activity?${search}`);
      setActivity(next);
      const previousSelection = selectedSessionId.current;
      const selectionPreserved = Boolean(previousSelection && next.items.some(({ id }) => id === previousSelection));
      const requested = previousSelection ?? fallbackSessionId;
      const sessionId = requested && next.items.some(({ id }) => id === requested) ? requested : next.items[0]?.id;
      if (sessionId) {
        await openSession(sessionId);
      } else {
        selectedSessionId.current = undefined;
        setDetail(undefined);
        setTarget(undefined);
        setError(undefined);
      }
      if (fallbackSessionId && selectionPreserved) {
        setLiveAnnouncement("Activity updated. The selected Session remains in focus.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organization activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [appliedMember, appliedRepository, includeSeeded, openSession, page, submittedQuery]);

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
    if (turnId && detail.turns.some((turn) => turn.id === turnId)) {
      setTarget({ kind: "turn", id: turnId });
      return;
    }
    const event = activityId
      ? detail.timeline.find((item) => timelineEventId(item) === activityId)
      : undefined;
    const eventId = event ? timelineEventId(event) : null;
    if (eventId) setTarget({ kind: "activity", id: eventId });
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
    <section
      className="investigation-shell"
      aria-label="Session investigation"
      data-visual-system="open-memory-ledger"
    >
      <header className="investigation-masthead">
        <div>
          <span className="section-code">Loupe / evidence ledger</span>
          <strong>{detail ? shortId(detail.session.id) : "Organization evidence"}</strong>
          <span>{detail?.session.ownerProfile.displayName ?? "Select a captured Session"}</span>
        </div>
        <p className={`live-status live-${liveStatus}`} role="status" aria-label="Live updates">
          <i aria-hidden="true" />
          {liveStatus === "connected" ? "Live updates connected" : liveStatus === "interrupted" ? "Live updates interrupted; reconnecting and refreshing through /api/v1" : "Connecting live updates"}
        </p>
      </header>
      <p className="sr-only" aria-live="polite">{liveAnnouncement}</p>

      <form className="command-deck" onSubmit={(event) => {
        event.preventDefault();
        setSubmittedQuery(query);
        setAppliedRepository(repositoryFilter);
        setAppliedMember(memberFilter);
        setPage(1);
      }}>
        <label className="search-field">
          <span>Find Session evidence</span>
          <div><input aria-label="Find Session evidence" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="error, tool, branch, member…" ref={searchRef} value={query} /><kbd>/</kbd></div>
        </label>
        <label className="seeded-toggle">
          <input checked={includeSeeded} onChange={(event) => setIncludeSeeded(event.currentTarget.checked)} type="checkbox" />
          Include clearly labelled Seeded examples
        </label>
        <label className="activity-filter">
          <span>Repository</span>
          <select aria-label="Filter by repository" onChange={(event) => setRepositoryFilter(event.currentTarget.value)} value={repositoryFilter}>
            <option value="">All repositories</option>
            {activity?.repositories?.map((repository) => <option key={repository.identity} value={repository.identity}>{repository.identity} · {repository.sessionCount}</option>)}
          </select>
        </label>
        <label className="activity-filter">
          <span>Member</span>
          <select aria-label="Filter by member" onChange={(event) => setMemberFilter(event.currentTarget.value)} value={memberFilter}>
            <option value="">All members</option>
            {activity?.members?.map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.isExample ? " · Example" : ""} · {member.sessionCount}</option>)}
          </select>
        </label>
        <button aria-label="Apply activity filters" type="submit">Search activity</button>
      </form>

      {error && <div className="error-banner" role="alert"><strong>Request error · evidence request failed</strong><span>{error}</span><button onClick={() => void refresh()} type="button">Try again</button></div>}
      {mutationError && <div className="error-banner" role="alert"><strong>Evidence update failed</strong><span>{mutationError.message}</span><button onClick={() => void mutationError.retry()} type="button">{mutationError.retryLabel}</button></div>}
      {loading && <p className="loading-state" role="status">Reading captured Organization evidence…</p>}

      <div className="investigation-grid">
        <OrganizationRail
          activity={activity}
          onOpen={(id) => void openSession(id)}
          onToggleComparison={(id) => setComparisonIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])}
          selectedForComparison={comparisonIds}
          selectedId={detail?.session.id}
          onPageChange={(nextPage) => setPage(nextPage)}
        />

        <section className="map-stage" aria-labelledby="session-ledger-title">
          {detail && <SessionSummary detail={detail} />}
          <header className="map-heading">
            <div><span className="section-code">Captured Session</span><h2 id="session-ledger-title">Session ledger</h2><p>Follow each claim back to the Turn and source evidence.</p></div>
            <div className="map-summary"><span><b>{detail?.agentRuns.length ?? 0}</b> agent runs</span><span><b>{detail?.evidence.tools.length ?? 0}</b> tools</span><span><b>{totalTokens?.toLocaleString() ?? "Unavailable"}</b> tokens</span></div>
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
          <div className="legend" aria-label="Session evidence legend">
            <span><i className="legend-shape shape-tool" />Tool</span>
            <span><i className="legend-shape shape-activity" />Activity</span>
            <span><i className="legend-shape shape-token" />Token sample</span>
            <EvidenceMark evidence={{ stability: ["observed"], derivation: "exact", sourceEventIds: [] }} />
            <EvidenceMark evidence={{ stability: ["inferred"], derivation: "inferred", sourceEventIds: [] }} />
            <EvidenceMark evidence={{ stability: ["unavailable"], derivation: "unavailable", sourceEventIds: [] }} />
          </div>
          {detail && activeTarget ? (
            <div className="session-route-ledger">
              <LinearTimeline detail={detail} onTarget={setTarget} target={activeTarget} />
            </div>
          ) : (
            <div className="map-empty"><span className="empty-state-mark" aria-hidden="true">↳</span><strong>No Session evidence selected.</strong><span>Choose a Session from Organization activity, or broaden the search to include Seeded examples.</span></div>
          )}
          <p className="keyboard-route"><span>Keyboard route</span><kbd>J/K</kbd> Session <i /> <kbd>F</kbd> failed Tool <i /> <kbd>/</kbd> search</p>
        </section>

        {detail && activeTarget ? <EvidenceInspector detail={detail} headingRef={inspectorHeadingRef} onFailure={followFailure} target={activeTarget} /> : <aside className="evidence-inspector inspector-empty"><span className="section-code">Turn evidence</span><strong>Evidence appears here.</strong><p>Select a Session, then choose a Turn, Tool, or Agent run to inspect its exact provenance.</p></aside>}
      </div>

      {detail && activeTarget && (
        <div className="linear-fallback hierarchy-only">
          <AgentTree detail={detail} onTarget={setTarget} target={activeTarget} />
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
