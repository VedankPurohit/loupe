# Loupe — Coding-Agent Observability

> **Naming note:** Loupe is a temporary working codename and is expected to change. Product architecture and public contracts must not depend on it.

The concrete live demonstration and milestone contract is documented in [`DEMO.md`](./DEMO.md).

## Working vision

Build Loupe, a self-hosted observability and organizational-learning platform for coding agents. It should let an organization understand how agents and subagents work, diagnose failures without taking control of a developer's machine, learn from successful practitioners, and turn repeated evidence into safer team-wide improvements.

Codex is the first Build Week integration, not the permanent boundary. The platform should be able to ingest multiple agents through reliable native telemetry, hooks, plugins, and compatibility adapters while projecting their activity into one consistent model.

For Build Week, Codex is the only live integration. OpenCode, OpenClaw, Hermes, Claude Code, and other agents should be addable later through the same adapter contract without changing the core domain model.

The project needs a credible end-to-end vertical slice for an initial showcase within one day, followed by an approximately five-day hackathon delivery window. Scope decisions must protect the first-day working path while allowing the real product to deepen through the final deadline.

## Product promise

An organization can see what its coding agents did, understand why work succeeded or failed, compare workflows across its members, and improve future performance using evidence from real sessions.

Individual developers benefit from understanding their own sessions. The primary value comes from teams learning together.

## Organizational learning loop

1. **Observe** — Capture a session's root agent run, subagent hierarchy, model activity, tool invocations, skills, MCP interactions, context, tokens, estimated costs, timings, branches, compactions, and outcomes at the fidelity the source supports; mark unavailable or inferred evidence explicitly.
2. **Diagnose** — Let a coach inspect the execution graph and timeline to find where an approach became blocked, wasteful, unreliable, or unsafe.
3. **Compare** — Compare the session with relevant sessions from stronger practitioners or successful workflows.
4. **Discover patterns** — Let people or an organization-analysis agent query session history and identify repeated failures, successful techniques, and missing capabilities.
5. **Propose improvements** — Produce an evidence-backed candidate intervention such as a skill, workflow, prompt template, MCP configuration, repository instruction, automation, or training recommendation.
6. **Approve and standardize** — Require an administrator to review supporting evidence and approve any organization-wide publication in the UI.
7. **Measure** — Observe later sessions to determine whether the intervention improved outcomes and to catch regressions.

## Primary demonstration story

A real developer coding-agent session becomes observable in near real time from captured Codex data. A coach opens it in a browser, follows the parent-child agent hierarchy, and traces a failure through subagent activity, tools, skills, MCP results, and context provenance. The coach can compare it with other real sessions available to the organization, including the same developer's earlier sessions when no other users have contributed data yet.

An organization-analysis agent then queries permitted session history through a real scoped CLI backed by the server API, finds a repeated pattern, and submits a complete Candidate skill with links to the supporting sessions. A companion coding-agent skill teaches the CLI and the evidence standards for analysis. An administrator reviews and approves the exact immutable artifact in the UI. Approval publishes a mandatory Organization standard release; every Enrolled device daemon polls for approved releases, verifies the approved hash, and installs the release atomically when no active Session can be affected. Administrators can reject before approval, pause distribution, or roll the Organization back; members cannot opt out.

## Interface direction

- The initial direction is an organization-level view combining live/recent activity, aggregate signals, search, and session discovery.
- The ordering, density, chart selection, and relationship between overview graphs and the session feed are not yet decided.
- These decisions require an interactive prototype rather than further abstract discussion.
- The session detail must support both a chronological timeline and the parent-child agent execution graph.

## Execution model

- Every session has exactly one root agent run.
- Every subagent run has exactly one parent agent run and may create children of its own.
- The agent hierarchy is a rooted tree.
- The projection may leave a parent edge unresolved when the available Codex evidence cannot prove it; it must not fabricate a complete-looking tree.
- Model requests, tools, context items, skills, MCP interactions, and other activity form a wider causal execution graph around that hierarchy.
- The application should offer both a chronological timeline and a navigable graph.
- A session is a durable, resumable history and is not assumed to have a final automatic end.
- A turn is the authoritative atomic work unit for the initial product: one user request and all root-agent, subagent, model, tool, skill, MCP, and context activity it causes before control returns.
- Diagnosis and comparison may operate at either the complete-session level or the individual-turn level.
- The initial product does not infer or automatically group related turns into larger work units.
- A session owner or administrator may assign lightweight session metadata in the interface: a structured outcome, a structured review status, and free-form tags.
- Fine-grained turn labeling is not a focus of the initial product.
- Grouping multiple turns into a larger named objective is a possible later capability.
- Live, idle, and resumed are derived activity states, not final session outcomes.
- Historical analysis can examine any earlier portion of a session without requiring the session to be closed.

## Context intelligence

The platform should record context provenance where the source exposes it and preserve defensible local estimates separately. It must label exact context composition, contribution, or inheritance as unavailable when Codex does not expose enough evidence.

It should surface evidence-backed context risks such as conflicting instructions, stale or oversized MCP results, irrelevant skills, prompt injection, repeated tool output, secret exposure, and compaction followed by rework. It should not call context "bad" based on size or correlation alone.

Token and context analysis must distinguish:

- Cumulative provider-reported token usage and locally estimated monetary cost over a session; Codex does not passively report provider monetary cost.
- Exact or inferred context-window occupancy at each model request, labelled by evidence strength.
- The estimated token contribution of context sources such as instructions, history, skills, MCP tool definitions and results, memory, tool outputs, and compaction summaries.
- Cached input, uncached input, output, and reasoning tokens when the source reports them separately.

The session view should be able to plot token consumption and context occupancy over time, annotate explicit or inferred skill evidence, configured or observed MCP evidence, tool failures, retries, compactions, and subagent creation, and show the first-request context baseline where supported. Exact source-reported counts, unstable observations, local estimates, and unavailable evidence must remain visibly distinct.

## Collection architecture

- Require an explicit, one-time Codex setup command rather than silently scraping local state.
- The setup command previews and applies the required user-level Codex telemetry and hook configuration, installs or starts the local relay, associates it with a user identity, connects it to the self-hosted server, and verifies capture with a test event.
- Normal Codex sessions are captured automatically after setup; users do not run a wrapper command for every session.
- Setup must be reversible through a corresponding uninstall or disconnect command.
- Browser flows handle Bootstrap-code and Invite-code redemption. Codex setup exchanges an authenticated, short-lived enrollment grant for a separate Device credential; fuller CLI login, token refresh, and device management may follow later.
- The first local relay supports macOS and is installed as a per-user `launchd` service with automatic start and restart behavior.
- Service installation remains behind a platform boundary so Linux `systemd` and Windows service support can follow without changing capture, delivery, or server contracts.
- The local relay uses SQLite only as a durable offline delivery queue. It retains unacknowledged events across process and machine restarts and removes them after idempotent server acknowledgement.
- High-confidence local redaction replaces only matched secret substrings before SQLite or PostgreSQL persistence and preserves the rest of the captured content. Ordinary redaction is enabled by default and can be disabled per Enrolled device in Settings.
- A separate disabled-by-default Demo redaction canary recognizes only one exact reserved synthetic prefix when explicitly enabled. It proves the redaction path without using a real credential or broadening ordinary matching rules.
- The relay periodically reads only its own capture policy and the approved Organization-standard manifest. It may download approved artifacts and report installation state, but it cannot browse Organization evidence or approve, publish, pause, or roll back a release.
- Put every agent behind an explicit adapter that declares its source identity and capture capabilities.
- Require adapters to map source observations into the canonical session, agent-run hierarchy, model-request, tool-invocation, capability, context, and outcome concepts they can support.
- Let adapters report unsupported or inferred fields instead of fabricating completeness.
- Prefer native OpenTelemetry when an agent provides reliable events and metrics.
- Use agent-specific hooks or plugins for the lifecycle and subagent events they actually expose. Do not assume that Codex hooks reveal implicit skill activation, complete capability snapshots, or exact serialized context.
- Use a local relay to receive events, preserve provenance, redact or enrich data, buffer offline, and forward it to the self-hosted server.
- Use file watching only as a compatibility fallback.
- Retain source events and derive a canonical agent-neutral projection instead of silently merging conflicting observations.
- Record source, confidence, and reconciliation decisions whenever multiple sources describe the same activity.

## Visibility and governance

- The organization is the authenticated visibility boundary.
- Captured session content is visible to organization members by default.
- Secret detection and redaction remain necessary even when organizational visibility is intentional.
- Example members and Seeded sessions are created only by an explicit Administrator CLI command or UI action using an idempotent versioned Example data pack; they never appear automatically or enter through a Device credential.
- An analysis agent may receive scoped read-and-submit access through an Analysis CLI backed by the same server API as the UI. It may read organization evidence and submit Candidate skills, but it cannot mutate captured evidence, approve, publish, or deploy.
- A companion coding-agent skill documents how to search, inspect, compare, and cite sessions with that CLI.
- An MCP server may be added later over the same query API.
- During the hackathon it may submit complete Candidate skills only; other Candidate intervention types remain future opportunities.
- An administrator reviews and approves the exact immutable Candidate-skill artifact in the UI.
- Administrator approval publishes a mandatory Organization standard release to every Enrolled device. Daemons poll, stage, verify, and atomically switch releases while retaining the previous version for rollback; they never delete the active version before the replacement is verified.
- Administrators can reject a Candidate skill, pause release distribution, or roll the Organization back. Members cannot opt out. Automatic approval without an Administrator remains outside the product because it is too risky.

## Deployment boundary

- The initial self-hosted deployment represents exactly one organization.
- It supports multiple stable user identities and attributes every captured session to a session owner.
- The first installation may contain only one actual user, but the architecture must not assume that every session belongs to one hard-coded user.
- Each installed listener must be enrollable to a user identity rather than relying only on the machine name.
- The application must be deployable at a configurable network address and must not assume it only runs on the developer's computer.
- The hackathon identity flow includes a single-use Bootstrap code for the initial Administrator and administrator-issued single-use Invite codes for ordinary Members.
- Public signup, email delivery, passwords, invitation-management depth, account recovery, and role administration are deferred.
- Multi-organization isolation, organization creation, cross-organization invitations, hosted signup, and billing are future hosted-product capabilities.
- The data model may retain an organization identifier to ease future migration, but the prototype must not implement multi-organization behavior.
- PostgreSQL is the central server storage engine.
- The supported packaged self-hosted path is a single Docker Compose command that starts the application and PostgreSQL with persistent volumes.
- The native development path uses no Docker services, connects to locally installed PostgreSQL through `DATABASE_URL`, and starts through one normal project command.
- Native and containerized modes use the same application code, PostgreSQL schema, and migrations.
- Docker must not be required for development, testing, migrations, or normal local application startup.

## Implementation direction

- Use a TypeScript monorepo managed with pnpm for the hackathon implementation; do not introduce Rust.
- Build the central HTTP module with Fastify on Node.js and expose a versioned REST/JSON interface under `/api/v1`.
- Describe the HTTP interface with OpenAPI and validate shared contracts with Zod.
- Use Drizzle for PostgreSQL schema access and migrations.
- Use Server-Sent Events for near-real-time read-only browser updates.
- Build the web application with React and Vite; the Fastify process may serve its production assets.
- Build the first macOS relay, setup commands, and Analysis CLI in TypeScript. The relay retains its SQLite delivery queue and communicates with the server only through the versioned `/api/v1` interface for ingestion, its own capture policy and health, approved-standard manifest/artifact reads, and installation-status reporting.
- Use scoped browser-session, CLI bearer, and enrolled-device credentials as defined by the identity decision.
- Keep the central interface usable by the web application, relay, Analysis CLI, tests, future agent adapters, and a later MCP adapter; do not make tRPC or GraphQL the external contract.
- Use Vitest for module and interface behavior and Playwright for critical browser flows.

## Explicitly out of scope

- Remote control of another person's computer, coding agent, or session.
- Remote intervention that changes or steers another person's active agent work.
- Treating inactivity as proof that a resumable session is permanently finished.

## Future opportunity space

These are directions to preserve, not commitments for the first build:

- Agent adapters for Claude Code, OpenClaw, OpenCode, Hermes, and future coding agents.
- Linux and Windows relay lifecycle support.
- Import and backfill of historical sessions captured before listener installation.
- Git, test, CI, issue, commit, pull-request, review, revert, and deployment evidence that connects agent activity to engineering outcomes.
- Similar-session retrieval using structured, full-text, and semantic evidence.
- Alerts for stuck agents, repeated tool failures, runaway cost, context exhaustion, unusual MCP behavior, or organization-wide regressions.
- Model, tool, skill, MCP, and workflow evaluations by task type and outcome.
- Before-and-after measurement when an organization introduces a skill, workflow, model, MCP server, or configuration change.
- A versioned library of candidate interventions and organization standards with approval, rollout, rollback, ownership, and adoption tracking.
- Human collaboration around sessions: comments, bookmarks, annotations, coaching requests, exemplars, and shared investigation links.
- Configurable retention, legal hold, export, deletion, redaction, audit, and data-residency policies.
- Cost budgets, forecasts, anomaly detection, and chargeback by user, team, repository, model, or task type.
- Open data export and interoperability with standard observability backends.
- Hosted multi-organization operation with tenant isolation, signup, invitations, billing, and plan management.
- A plugin or extension surface for custom collectors, projections, analyses, charts, and organization policies.
- Evaluation or replay environments that test proposed standards against representative historical work without changing active sessions.

## Product principles

- Prefer evidence over opaque scores.
- Preserve causal and source provenance.
- Distinguish observation, inference, recommendation, and human decision.
- Treat successful sessions as reusable organizational knowledge.
- Recommend the right intervention rather than assuming every repeated pattern should become a skill.
- Core capabilities must operate on real captured and persisted data. Synthetic fixtures may support tests, examples, or onboarding but must not substitute for ingestion, search, inspection, comparison, or agent queries.
- Repository-native documentation must let a new human or coding agent deploy with Docker Compose, run the native PostgreSQL development flow without Docker, install and remove Codex capture, operate the analysis CLI, understand the architecture and data model, and troubleshoot delivery.
- Remain self-hostable and open source.
- Keep the first-day vertical slice small enough to demonstrate credibly while preserving the five-day delivery path.

## Remaining validation gates

- Target-version proof that the documented Codex capture baseline works on macOS with reversible setup, restart recovery, interruption recovery, and honest direct or nested parentage.
- The outcome signals used to distinguish productive and wasteful sessions.
- The exact target-version signals and defensible estimates for context composition, skill evidence, MCP capability overhead, and cost; unavailable fields remain explicitly unavailable.
- The comparison method for finding relevant expert sessions.
- The initial charts and views for developers, coaches, and administrators.
- The organization-home information architecture, to be resolved through prototyping.
- The privacy, redaction, retention, and audit controls beyond the default organization-visible posture.
- The exact Analysis CLI commands, structured outputs, citations, and Candidate-skill submission experience.
- The exact Organization-standard polling interval, active-Session deferral rule, personal-skill collision policy, retained rollback versions, and installation-status vocabulary.
- The explicit Administrator CLI/UI operation and versioned pack used to create idempotent Example members and Seeded sessions without entering the Device ingestion path.
