# Loupe — Lock the first-day slice and hackathon delivery scope

Type: grilling
Status: resolved

Resolved 2026-07-17.

## Question

Which real capabilities are mandatory for the first-day working vertical slice, which deepen during the remaining hackathon window, and which vision items must remain explicitly deferred so the core path stays credible?

## Answer

### Governing rule

The first day is a sequencing checkpoint inside one continuous product build, not a disposable MVP or a separate architecture. For every major capability, planning must state the intended product, the hackathon delivery, and any temporary shortcut plus its evolution path. Reversible hacks and unfinished depth are acceptable; fake core data, fabricated fidelity, and demo-only substitutes are not.

### First-day checkpoint

The checkpoint passes when one Mac completes this real, interruptible path:

1. Explicit Codex setup with installation disclosure and a configurable server URL that defaults to localhost.
2. A restartable per-user `launchd` relay with a SQLite delivery queue.
3. Actual Codex telemetry and hook events captured at validated fidelity.
4. Delivery to the server with retry, idempotent acknowledgement, and recovery after a relay or server interruption.
5. PostgreSQL source-event persistence and basic canonical Session, Turn, and Agent run projection.
6. A minimal live browser view and CLI inspection of the captured session.

The checkpoint may be narrow and visually crude. Subagent parentage is shown only where the validated capture contract supports it; unsupported relationships are never invented. Search, comparison, deep context analysis, multi-user UX, rich UI, and Candidate skill delivery deepen after this checkpoint without replacing its core contracts.

### Hackathon delivery

#### Capture and delivery

- Codex on macOS is the only live adapter/platform pair.
- Setup captures all subsequent Codex sessions by default and clearly states that captured content is organization-visible.
- Capture includes repository, remote, branch, worktree, and commit context when available.
- Exact, inferred, reconciled, and unsupported observations remain distinguishable.
- High-confidence local secret redaction is available and enabled by default, but can be explicitly disabled per Enrolled device. It redacts only matched substrings before local or central persistence and stores type, keyed fingerprint, rule, and source location rather than the secret value. A separate disabled-by-default Demo redaction canary recognizes only one exact harmless synthetic prefix when explicitly enabled in Settings.
- Disconnect and uninstall are real. Repository/folder allowlists and broader privacy controls come later.

#### Identity and deployment

- One self-hosted deployment represents one Organization and supports multiple stable Organization members.
- The first bootstrap creates an Administrator; simple invite codes enroll ordinary members.
- Authentication is minimal but real: browser session, scoped CLI credential, and separate revocable Enrolled device credential. Fake username/password screens are forbidden. Google/OIDC-style authentication follows later.
- The server URL is always configurable; localhost is only the default.
- Docker-free development with local PostgreSQL and Docker Compose self-hosting use the same application, schema, migrations, and configuration behavior. Changes must keep both flows aligned.

#### Server, API, and UI

- Append-only source events, canonical projections, near-real-time updates, search, inspection, and comparison operate on real captured data.
- Multiple UI directions are prototyped before choosing the final interface.
- The delivered web application covers organization activity, users, repositories, sessions, descriptive usage/cost graphs, search/comparison, session timeline and agent graph, Skills/Organization standards, and the approval queue.
- There is no user token/cost/productivity leaderboard in the hackathon scope.

#### Agent-driven analysis

- There is no separate analytical or background pattern-mining engine.
- An Organization-analysis agent uses the Analysis skill and Analysis CLI to search, inspect, watch, compare, cite, and report on organization data.
- UI aggregates may use ordinary deterministic queries and code.
- The CLI may read all permitted organization evidence and submit Candidate skills. It cannot mutate captured evidence, approve a Candidate skill, or deploy an Organization standard.
- Human-readable output, structured output, stable identifiers/deep links, explicit pagination, and stable errors are required design constraints; detailed commands remain a later prototype decision.

#### Candidate skill lifecycle

- Skills are the only implemented Candidate intervention type during the hackathon.
- A submission is a complete, versioned, installable Candidate skill plus reviewer context, evidence citations, and uncertainty—not merely generated prose.
- Every factual claim has supporting evidence. A Repeated pattern needs evidence from at least two distinct Turns; one case is labelled a single-case hypothesis.
- The UI supports draft, reject, edit, and approve. Any file edit creates a new immutable version and resets approval.
- Approval applies to the exact artifact hash. Every new or changed file/version requires fresh Administrator approval.
- Administrator approval publishes a mandatory Organization standard release to every Enrolled device. Each daemon polls for approved manifests, stages and verifies the exact approved artifact hash, waits until no active Session can be affected, atomically switches versions, reports status, and retains the previous version for rollback. It never deletes the working version before the replacement is verified. Administrators can reject, pause, or roll back; members cannot opt out. Device credentials gain only read access to approved manifests/artifacts and their own installation state, not Organization evidence or approval controls. (Amended 2026-07-17 after final user review; supersedes the temporary explicit-install amendment.)
- Agents cannot approve or bypass the human gate, even when their CLI credential belongs to an Administrator.

#### Packaging and documentation

- The hackathon completes the native development flow, Docker Compose self-hosting flow, setup/uninstall path, Analysis CLI/skill usage, and essential architecture, data-model, deployment, and troubleshooting documentation.

### Explicitly deferred

- Agent adapters beyond Codex and relay lifecycle support beyond macOS.
- Full signup, OAuth/OIDC, recovery, role administration, and hosted multi-organization operation.
- Repository/folder-scoped capture policies and full retention, audit, export, deletion, and legal-hold controls.
- Non-skill interventions. Automations are the most promising later discussion; configuration, MCP-specific changes, instructions, and human training are not hackathon deliverables.
- A scheduled analytical engine, automatic pattern mining, alerts, anomaly detection, budgets, and adoption/outcome measurement.
- Historical backfill, cross-observability export, and full repository/CI/issue/PR/deployment connectors.
- Automatic organization-wide publication without explicit Administrator approval.
- Member opt-out from Administrator-approved Organization standards.
- Remote control, active-session steering, and automatic grouping of Turns into inferred work units.
