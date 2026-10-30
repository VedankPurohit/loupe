# Loupe: Codex-First Coding-Agent Observability Specification

**Naming status:** Loupe is a temporary working codename and is expected to change. Treat it as presentation metadata, not a durable API, schema, credential, telemetry, storage, or deployment identifier.

**Repository slug:** `loupe`

**Package namespace:** undecided

**Website domain:** undecided

**Status:** ready-for-agent — the implementation tickets define the remaining validation gates and execution blockers

**Scope:** One continuous hackathon build with a credible first-day checkpoint and a fuller approximately five-day target. Resolved repository decisions are normative. Named implementation validations may reduce fidelity or scope; they do not authorize fabricated behavior. The deliberately open content-governance question remains post-hackathon risk, not a blocker to the already resolved minimum.

## Problem Statement

Organizations increasingly rely on coding agents, but the evidence needed to understand how those agents work remains fragmented across local telemetry, lifecycle hooks, unstable transcripts, tool output, and vendor-specific interfaces. A developer can see that a session was expensive, slow, or unsuccessful without being able to explain where the approach failed. A more experienced teammate cannot reliably inspect the root agent, subagents, tools, context, retries, and compactions from another computer. Platform teams cannot compare real workflows, identify repeatable practices, or determine whether a proposed intervention is supported by evidence.

Existing LLM observability products cover generic requests, tokens, latency, and traces, but the differentiated need is coding-agent execution and organizational learning: a durable Session with Turns, a rooted Agent run hierarchy, a wider causal Execution graph, context and capability provenance, real search and comparison, and a safe path from evidence to an Organization standard.

Codex exposes enough documented and observed telemetry to support a meaningful passive integration, but its surfaces are incomplete and have different stability guarantees. OpenTelemetry logs and traces, lifecycle hooks, app-server data, rollout files, and local state must not be merged as though they were equally authoritative. Logical model-request identity, exact serialized context, implicit skill activation, complete passive capability snapshots, provider-reported monetary cost, fork lifecycle, and stable recursive parentage are missing or version-dependent. A credible product must preserve what was actually observed, disclose what was inferred, and show what is unavailable.

The product must also survive the operational realities of a developer laptop and a self-hosted server. Capture must be explicit and reversible, must not require a wrapper command for every Codex Session, must tolerate relay and network interruption, and must keep credentials for people, analysis clients, and delivery devices separate. Core behavior cannot be replaced by demo fixtures: real Codex activity must travel through real capture, delivery, PostgreSQL persistence, query, browser, and Analysis CLI paths.

## Solution

Build Loupe as an open-source, self-hosted observability and organizational-learning platform with Codex as its first Agent adapter. A one-time Codex setup command configures supported user-level OpenTelemetry and lifecycle hooks, enrolls the Mac to an Organization member, installs a per-user `launchd` relay, and verifies delivery. The TypeScript relay preserves source provenance, applies high-confidence secret redaction by default, durably queues unacknowledged events in SQLite, and delivers versioned batches to the central server.

The Node.js/Fastify server exposes one versioned REST/JSON interface under `/api/v1`, described by OpenAPI and validated with shared Zod contracts. It authenticates browser sessions, Analysis credentials, and Device credentials according to their distinct scopes. It stores append-only source events in PostgreSQL, then derives canonical Sessions, Activity episodes, Turns, Agent runs, model activity, Tool invocations, capabilities, context evidence, annotations, and Candidate skill records without discarding source truth. The React/Vite web application and TypeScript Analysis CLI use the same HTTP contract. Server-Sent Events provide near-real-time read-only updates.

Organization members can discover active and historical Sessions, inspect a chronological timeline and navigable Agent run hierarchy, see tool and failure evidence, and analyze provider-reported Token usage separately from inferred Context occupancy and estimated Context contribution. Coaches can compare real Turns or Sessions and cite evidence. An Organization-analysis agent can use a companion Analysis skill and a scoped Analysis credential to search, inspect, compare, watch, cite, and submit a complete Candidate skill. An Administrator reviews the exact immutable artifact in the browser; agents can never approve or publish it. Approval publishes a mandatory Organization standard release that every Enrolled daemon polls, verifies, and installs atomically when no active Session can be affected; Administrators can pause or roll back distribution.

The first-day checkpoint proves the narrow real path from setup through browser and CLI inspection. The remaining hackathon work deepens the same contracts into richer investigation, search, comparison, Candidate skill review, deployment, and documentation. Seeded Sessions may enrich onboarding and screenshots, but are always labelled and excluded from real evidence and aggregates by default.

## User Stories

1. As a developer, I want to run one explicit Codex setup command, so that subsequent Codex Sessions are captured without changing how I launch Codex.
2. As a developer, I want setup to preview the configuration and files it will change, so that I can give informed consent before capture begins.
3. As a developer, I want setup to disclose that captured content is visible to Organization members, so that I understand the visibility boundary.
4. As a developer, I want setup to accept a configurable server URL with localhost as the default, so that I can use either a local or remote self-hosted server.
5. As a developer, I want setup to enroll my Mac to my stable Organization-member identity, so that my Sessions receive the correct historical owner.
6. As a developer, I want setup to verify capture with a test event, so that I know the relay, credential, network, and server are working.
7. As a developer, I want to disconnect or uninstall capture reversibly, so that I can revoke delivery and remove local integration safely.
8. As a developer, I want the relay to start automatically after login and restart after failure, so that capture does not depend on remembering another command.
9. As a developer, I want captured events to survive relay, server, network, and machine interruptions, so that temporary failure does not create silent gaps.
10. As a developer, I want acknowledged events removed from the local Delivery queue, so that the relay does not grow without bound after successful delivery.
11. As a developer, I want default high-confidence secret redaction before delivery, so that common credentials are not stored as ordinary Session content.
12. As a developer, I want redaction evidence to retain the secret type, fingerprint, rule, and source location without the secret value, so that investigators can understand what was removed.
13. As a developer, I want to disable default redaction only through an explicit choice, so that lower-safety capture cannot happen accidentally.
14. As a developer, I want every supported Codex Session after setup to be captured automatically, so that the observable history is not limited to specially wrapped demos.
15. As a developer, I want the platform to retain Codex producer version and capture source, so that fidelity can be interpreted against the actual emitting version.
16. As a developer, I want resumed work to remain part of the same durable Session, so that history is not fragmented by idle time or process restarts.
17. As a developer, I want live, idle, and resumed to be derived Activity states rather than permanent outcomes, so that inactivity is not mistaken for completion.
18. As a developer, I want every user request and its resulting activity represented as one Turn, so that I have a reliable atomic unit for diagnosis and comparison.
19. As a developer, I want each Session to have exactly one Root agent run and every observed Subagent run to retain its known parent, so that delegated work is understandable.
20. As a developer, I want unknown or weakly inferred Agent-run parentage shown honestly, so that a plausible-looking tree does not fabricate causality.
21. As a developer, I want a chronological Session timeline, so that I can see what happened and when.
22. As a developer, I want a navigable Agent-run hierarchy, so that I can follow delegation from the Root agent run through nested Subagent runs.
23. As a developer, I want Tool invocation inputs, results, duration, success, failure, and source coverage shown when captured, so that I can diagnose operational failures.
24. As a developer, I want missing hook coverage distinguished from an absence of tool use, so that incomplete capture is not presented as negative evidence.
25. As a developer, I want compaction timing and trigger annotated in the timeline, so that I can investigate rework after context changes.
26. As a developer, I want resumes, retries, approvals, tool failures, and Subagent creation annotated, so that changes in behavior have nearby evidence.
27. As a developer, I want explicit skill mentions distinguished from inferred skill-file access and unavailable implicit activation, so that skill-use claims match capture fidelity.
28. As a developer, I want configured MCP server names and observed MCP use shown without claiming a complete passive tool inventory, so that capability analysis remains honest.
29. As a developer, I want repository, remote, branch, worktree, and commit context shown when available, so that Session evidence can be related to its working environment.
30. As a developer, I want the original source event available for troubleshooting, so that projection bugs can be distinguished from producer behavior.
31. As a developer, I want conflicting source observations retained and reconciled explicitly, so that one source does not silently overwrite another.
32. As a developer, I want each important field labelled as documented, observed, inferred, unstable, or unavailable as applicable, so that I can judge the strength of a claim.
33. As a developer, I want provider-reported input, cached-input, output, reasoning, and total Token usage preserved separately when available, so that distinct usage categories are not collapsed.
34. As a developer, I want Token usage progression across a Session, so that I can identify expensive Turns, retries, and long-running activity.
35. As a developer, I want Context-window limits shown separately from usage, so that token consumption is not mislabelled as Context occupancy.
36. As a developer, I want inferred Context occupancy visibly labelled as derived, so that an estimate is not mistaken for a provider measurement.
37. As a developer, I want the first-request Context baseline shown when defensible, so that I can see how much capacity was occupied before later history accumulated.
38. As a developer, I want estimated Context contribution separated from exact or provider-reported values, so that hidden or transformed provider context is not presented as known.
39. As a developer, I want cost shown only as a labelled estimate with price-table version, effective date, and billing caveat, so that API-equivalent estimates are not confused with subscription charges.
40. As a developer, I want errors and unsupported evidence visible instead of replaced by an opaque quality score, so that I can form my own evidence-backed diagnosis.
41. As a Session owner, I want to assign a structured Session outcome, so that successful, partial, failed, and unknown work can be found without pretending the system inferred productivity.
42. As a Session owner, I want to assign a review status and free-form tags, so that I can mark exemplars, Sessions needing help, and meaningful categories.
43. As an Organization member, I want to see live and recent activity across the Organization, so that I can discover work that needs attention.
44. As an Organization member, I want to filter and search real captured Sessions, so that I can find relevant evidence without reading raw telemetry.
45. As an Organization member, I want seeded examples excluded from real-data aggregates by default, so that demonstrations do not distort Organization evidence.
46. As an Organization member, I want every Example member and Seeded session visibly labelled in UI, API, CLI, comparison, and citations, so that synthetic content cannot be mistaken for a real colleague or Session.
47. As a Coach, I want to inspect another member's Organization-visible Session from my browser, so that I can help without controlling their computer or active agent.
48. As a Coach, I want to analyze an earlier portion of a live or resumable Session, so that I do not need a permanent completion signal before helping.
49. As a Coach, I want to traverse from a Turn to its Agent runs, model activity, tools, capabilities, and context evidence, so that claims remain connected to causal structure.
50. As a Coach, I want stable deep links to Sessions, Turns, and evidence, so that I can share an investigation precisely.
51. As a Coach, I want to compare selected real Sessions or Turns, so that I can explain how a stronger workflow differed from a struggling one.
52. As a Coach, I want correlation presented without causal language, so that the product does not overclaim why an outcome occurred.
53. As a Coach, I want a Repeated pattern to require evidence from at least two distinct real Turns, so that one anecdote cannot silently become an Organization-wide claim.
54. As a Coach, I want a one-case observation labelled as a single-case hypothesis, so that it can be investigated without being overstated.
55. As an Organization-analysis agent, I want a companion Analysis skill that teaches the CLI and evidence rules, so that I can investigate consistently.
56. As an Organization-analysis agent, I want to authenticate with a scoped Analysis credential, so that I can read permitted Organization evidence without receiving browser or Device authority.
57. As an Organization-analysis agent, I want human-readable and structured CLI output, so that the same commands work for interactive use and reliable automation.
58. As an Organization-analysis agent, I want explicit pagination, stable identifiers, deep links, and stable error forms, so that large investigations remain deterministic.
59. As an Organization-analysis agent, I want to search, inspect, watch, and compare through the same server API as the UI, so that CLI results cannot drift into a second data model.
60. As an Organization-analysis agent, I want to cite the exact Sessions and Turns supporting every factual claim, so that a human can verify my analysis.
61. As an Organization-analysis agent, I want to submit a complete installable Candidate skill with reviewer context, citations, and uncertainty, so that review concerns an artifact rather than a prose suggestion.
62. As an Organization-analysis agent, I want my credential to be unable to mutate captured evidence, so that analysis cannot rewrite its supporting record.
63. As an Organization-analysis agent, I want my credential to be unable to approve or publish even when it belongs to an Administrator, so that automation cannot bypass the human gate.
64. As an Administrator, I want to create single-use Invite codes for ordinary Members, so that the self-hosted Organization can add real people without full account management.
65. As an Administrator, I want to review Candidate skill evidence and uncertainty in the browser, so that approval is an informed human decision.
66. As an Administrator, I want to reject, edit, or approve a Candidate skill, so that unsafe or incomplete artifacts do not become Organization standards.
67. As an Administrator, I want every file edit to create a new immutable Candidate skill version and reset approval, so that approval cannot silently carry across changed content.
68. As an Administrator, I want approval bound to the exact artifact hash, so that the released Organization standard is exactly what I reviewed.
69. As an Administrator, I want approval to make an Organization standard release mandatory on every Enrolled device, so that the approved standard becomes Organization-wide without member-by-member installation.
70. As an Administrator, I want Organization standard updates to be atomic, observable, pausable, rollbackable, and deferred while a Session is active, so that mandatory rollout does not destabilize ongoing work.
71. As an operator, I want the first startup to issue a single-use Bootstrap code, so that the first Administrator is established without a default password.
72. As an operator, I want bootstrap and invite secrets stored only as verifiers and to support expiry or revocation, so that disclosure of server storage does not reveal usable codes.
73. As an operator, I want browser sessions, Analysis credentials, and Device credentials independently revocable, so that each actor can be disabled without rotating unrelated credentials.
74. As an operator, I want Device credentials limited to capture delivery, their own configuration and health, and read-only access to approved Organization standard artifacts, so that a compromised relay cannot browse Organization evidence or exercise Administrator authority.
75. As an operator, I want the server to assign Session ownership from the authenticating Device credential, so that a client cannot impersonate another Session owner.
76. As an operator, I want ownership retained when a device is later disconnected or re-enrolled, so that historical attribution does not change retroactively.
77. As an operator, I want delivery through a different Device credential retained as reconciliation evidence rather than silently transferring ownership, so that anomalies remain auditable.
78. As an operator, I want one Docker Compose command to start the application and PostgreSQL with persistent storage, so that self-hosting is approachable.
79. As a contributor, I want a Docker-free native development command using my locally installed PostgreSQL, so that iteration does not require containers.
80. As a contributor, I want native and Compose modes to use the same application, schema, migrations, and configuration behavior, so that one deployment path cannot drift from the other.
81. As a contributor, I want repository-native setup, architecture, data-model, deployment, CLI, and troubleshooting documentation, so that I do not need the planning conversation to operate the system.
82. As an Agent-adapter author, I want an explicit adapter interface and Capture capability declaration, so that another provider can be added without changing the canonical domain model.
83. As an Agent-adapter author, I want unknown source fields preserved, so that additive producer changes do not destroy evidence before the adapter is updated.
84. As an Agent-adapter author, I want version-gated compatibility fallbacks isolated from the stable capture contract, so that unstable rollout parsing cannot masquerade as documented telemetry.
85. As an implementation agent, I want each ticket to name its confirmed testing seam and first failing behavior test, so that work proceeds in verifiable vertical TDD slices.
86. As an implementation agent, I want open capture and product questions represented as gates with downgrade behavior, so that I do not invent unsupported fields to satisfy a screenshot.
87. As an Administrator, I want to load a versioned example-data pack only through an explicit CLI command or UI action, so that Seeded sessions never appear automatically in a real installation.
88. As an Administrator, I want example-data loading to be idempotent, so that repeating the demo setup does not duplicate Example members or Seeded sessions.
89. As a developer, I want redaction to replace only high-confidence secret substrings rather than an entire prompt, so that useful captured context is preserved.
90. As a developer, I want ordinary high-confidence redaction and the Demo redaction canary to have separate Settings toggles, so that I can prove the pipeline without making ordinary prompt text match a demo rule.
91. As a developer, I want the Demo redaction canary disabled by default and restricted to one exact synthetic test prefix, so that it cannot misfire on normal captured content.
92. As an Administrator, I want every Enrolled device to poll for newly approved Organization standard releases, so that approval results in mandatory Organization-wide installation.
93. As an Administrator, I want to pause a release or roll the Organization back centrally, so that a faulty mandatory standard can be stopped without visiting every device.
94. As a developer, I want the daemon to download and verify a new release before atomically switching versions, so that an interrupted update never deletes the last working skill first.

## Implementation Decisions

### Product boundary and delivery sequence

- The product is an Organization observability and learning system, not a remote-control product. It observes, explains, compares, recommends, and standardizes through human approval; it never steers another person's active agent or computer.
- The first-day checkpoint and remaining hackathon target are two milestones of one architecture. Temporary shortcuts must be reversible and must name their evolution path. Fake core data, fabricated capture fidelity, and demo-only ingestion paths are forbidden.
- The first-day checkpoint passes only when one Mac completes this real, interruptible path: one-time setup; restartable `launchd` relay; real Codex telemetry and hook capture; SQLite queuing; authenticated retry and idempotent acknowledgement; PostgreSQL source-event persistence; basic Session, Turn, and Agent run projection; and browser plus CLI inspection of the captured Session.
- The remaining hackathon target deepens that path with token, context, capability, explicitly estimated cost, and failure analysis; navigable timeline and Agent-run hierarchy; Organization activity and search; evidence-backed comparison; Analysis CLI and skill; Candidate skill review and human approval; Organization standard delivery; Compose packaging; Docker-free development; and repository-native documentation.
- Codex on macOS is the only live Agent-adapter/platform pair for the hackathon. The platform boundaries must allow later Agent adapters and operating-system service managers without implementing them now.

### Technology and module boundaries

- Use a TypeScript monorepo managed by pnpm. Do not introduce Rust.
- Build the central server on Node.js with Fastify. Build the browser application with React and Vite. The Fastify process may serve the production web assets.
- Use Drizzle for PostgreSQL schema access and migrations. PostgreSQL is the only Central store in both native and Compose server modes.
- Use SQLite only in the macOS relay as the durable Delivery queue. It is not a second analytical store and is never the server database.
- Build Codex setup, relay lifecycle, relay delivery, the Analysis CLI, and shared CLI foundations in TypeScript.
- Use Server-Sent Events for near-real-time server-to-browser updates. The initial live channel is read-only and does not require WebSockets.
- Use Vitest for interface and module behavior and Playwright for critical browser journeys.
- Organize the code around deep modules with explicit public contracts: shared API contracts; central server; Central-store schema and projection; web application; relay and setup; Codex Agent adapter; Analysis CLI; Analysis skill; example-data import; and Organization-standard packaging and mandatory device synchronization.

### Highest external interface

- The highest shared seam is a versioned REST/JSON interface under `/api/v1`. Relay delivery, the web application, Analysis CLI, automated tests, future Agent adapters, and a later MCP adapter must use this interface rather than private database access.
- Describe the interface with OpenAPI and define runtime request and response validation through shared Zod schemas. The OpenAPI document and runtime behavior must derive from the same contract source or be verified against it to prevent drift.
- The interface must cover at least: bootstrap and member browser authentication; Invite-code redemption; device-enrollment grants; Device credential delivery, own-device capture-policy reads, approved-standard manifest/artifact reads, installation status, and health; batched source-event ingestion and acknowledgement; Organization activity; Sessions, Turns, Agent runs, timelines, source evidence, annotations, search, comparison, live SSE updates; Analysis-credential management; explicit Administrator example-data import; Candidate skill submission; browser-only Candidate skill review and approval; and Organization standard release, pause, and rollback state.
- Exact route names, batch shape, acknowledgement watermark, pagination encoding, retry error classes, SSE event vocabulary, and reprocessing controls remain gated by the delivery/query contract ticket. Implementers must settle those contracts at the `/api/v1` seam before building consumers and must not let relay, UI, or CLI invent independent shapes.
- Use stable identifiers, explicit pagination, machine-readable stable error codes, and navigable deep links. Additive response fields must be tolerated. Breaking changes require a new interface version.
- The server should project source events transactionally during ingestion for the hackathon unless a measured need justifies asynchronous infrastructure. No Kafka, general job queue, or separate analytics service is required.

### Identity, authentication, and credential separation

- One self-hosted deployment contains exactly one Organization. Organization identifiers remain on Organization-owned records as a future migration seam, but there is no Organization creation, switching, or cross-Organization behavior.
- An Organization member is a stable human identity with one of two roles: Member or Administrator. Both see Organization-visible content. Administrators additionally approve and publish Organization standards.
- First startup issues a single-use Bootstrap code. Redeeming it creates the first Administrator and a browser session. An Administrator may issue single-use Invite codes that create ordinary Members and browser sessions.
- Browser sessions authenticate people and carry their role. Analysis credentials belong to a member but can only read Organization evidence and submit Candidate skills. Device credentials belong to one Enrolled device and can deliver capture, inspect that device's acknowledgement/configuration/health, and read only approved Organization-standard manifests and artifacts needed for mandatory synchronization.
- The three credential types are separate, scoped, and independently revocable. An Analysis credential never inherits approval authority from an Administrator. A Device credential never gains general Organization-evidence access, Candidate submission, approval, publication, pause, or rollback authority.
- Bootstrap and invite secrets are stored only in verifier form and may expire or be revoked. Device enrollment exchanges a short-lived, single-use grant for a long-lived, separately revocable Device credential.
- Each Enrolled device belongs to exactly one member at a time. One member may have multiple devices. Reassignment requires explicit disconnect and re-enrollment.
- The server assigns a new Session's owner from the authenticating Device credential. Client-provided ownership is non-authoritative. Later device changes never rewrite historical ownership.

### Codex setup and relay operation

- Provide an explicit, reversible one-time Codex setup flow. It previews and safely applies required user-level Codex OpenTelemetry and hook configuration, configures the server URL, obtains a device-enrollment grant through an authenticated human flow, installs the per-user `launchd` service, starts it, and verifies a test event.
- Normal Codex use requires no per-Session wrapper. Setup captures subsequent supported Codex Sessions by default.
- Setup must coexist with existing Codex configuration and hooks. The macOS capture prototype must determine safe merge, backup, conflict, upgrade, disconnect, and uninstall behavior before those mechanics are treated as settled.
- The macOS capture prototype must also determine how repository, remote, branch, worktree, and commit context is obtained and correlated. Relay-side git inspection must retain its sampling time and provenance and must not be presented as source-reported or as proof of git state at an earlier event.
- The relay must accept supported Codex OTel logs and traces and lifecycle-hook payloads quickly without blocking Codex on network access. It records first, then delivers asynchronously.
- The relay assigns durable local delivery identity and stores unacknowledged events in SQLite. It batches delivery, retries transient failure with bounded backoff, survives process and machine restart, and deletes only server-acknowledged queue entries.
- The server must make retries idempotent. Exact sequence, batch, partial-failure, poison-event, and acknowledgement semantics are a validation gate under the delivery contract ticket.
- When ordinary redaction is enabled, the relay applies only high-confidence rules to matching secret substrings before any SQLite or PostgreSQL persistence. It preserves the rest of the prompt or tool payload and records redaction type, a non-reversible keyed fingerprint, rule, and source location without retaining the secret value.
- Ordinary high-confidence redaction is enabled by default and can be explicitly disabled per Enrolled device in Settings. The relay periodically reads only its own capture policy so browser changes take effect without granting it broader Organization access.
- A separate Demo redaction canary setting is disabled by default. When enabled, it recognizes one exact documented synthetic prefix reserved for the demonstration. It must not share a broad pattern with real prompt text, must never use a real credential, and proves only the end-to-end redaction path rather than comprehensive secret detection.
- Disconnect revokes the Device credential and stops future authorized delivery without deleting accepted history. Uninstall additionally removes relay lifecycle and capture configuration while preserving server history.

### Codex Agent adapter and capture contract

- Put Codex behind an explicit Agent-adapter interface. The adapter consumes producer-versioned source observations and produces canonical observations plus a Capture capability declaration. Additional providers implement the same boundary without changing the central domain vocabulary.
- The supported passive baseline is user-level Codex OpenTelemetry logs, OpenTelemetry traces, and lifecycle hooks. Retain each raw signal with source name, producer version, event name/type, occurrence and receipt time, payload, payload hash or source identifier, capture path, parser version where relevant, and redaction state.
- Treat rollout JSONL and local Codex SQLite as version-gated compatibility fallbacks, never stable primary interfaces. App-server data is richer but applies only to Sessions it hosts; it is not a passive tap for ordinary Codex clients.
- Every projected field must retain provenance and distinguish these evidence states: `documented` for a public supported Codex surface; `observed` for current first-party source or artifacts; `inferred` for correlation or calculation; `unstable` for explicitly experimental, internal, transcript, rollout, or version-gated behavior; and `unavailable` when the required fact is not provided. A field may need both an evidence-stability marker and a derivation/confidence marker rather than forcing these concepts into one misleading score.
- Preserve unknown source events and fields. Adapter upgrades may reprocess append-only source events into improved projections without changing the original evidence.
- Canonical Session identity comes from the tree-wide Codex `session_id` when available. Agent-run identity uses the individual Codex thread identity, such as OTel `conversation.id`, child hook `agent_id`, or versioned fallback thread id. These identities must not be collapsed.
- Canonical Turn identity uses hook `turn_id`. Do not synthesize a competing Turn id from timestamps when the supported identifier exists.
- A Session has exactly one Root agent run. The actual Subagent hierarchy is a rooted tree, but the projection may contain an explicitly unresolved parent when capture cannot prove the edge. Prefer verified current-version agent-communication edges and reconcile them with version-gated local parent identifiers; otherwise label Turn-ownership correlation as inferred.
- The nested-Subagent demonstration is conditional on the target-version macOS probe. If root-to-child-to-grandchild parentage cannot be reconstructed without fabrication, the product demonstrates one supported level and displays the limitation.
- Preserve hook `tool_use_id` and OTel `call_id` independently until a target-version probe proves a reconciliation rule. Hook tool payloads are canonical when emitted, but missing hooks are not evidence that no tool ran.
- Store Codex API request records as transport attempts with attempt, status, duration, and error evidence. Do not claim a stable logical model-request or response identity because the passive contract does not provide one. A projected Model request must carry inferred identity and confidence where required.
- Capture exact compaction trigger and timing from hooks. Compaction summaries or window chains are unstable fallback data. Capture `SessionStart.source = resume` as a new Activity episode in the same Session. Do not infer a fork from ordinary startup without lineage evidence.
- Explicit skill mentions may be captured exactly in host-bound interfaces or inferred from captured prompts. Reads of `SKILL.md` are evidence of access, not proof of workflow compliance. Implicit skill activation and exact passive load timing are unavailable and must be shown that way.
- Passive capture may show configured MCP server names and MCP tools actually used. It must not claim a complete callable-tool schema or capability inventory for ordinary Sessions.

### Central store and canonical projection

- Store accepted source events append-only in PostgreSQL before or atomically with projection. Source events are immutable evidence; corrections create new projection or reconciliation records rather than rewriting payloads.
- The canonical model includes Organization, Organization member, Enrolled device, credentials and grants, source events, adapter capabilities, Sessions, Activity episodes, Turns, Agent runs, parent edges, transport/model activity, Tool invocations, Capability snapshots where supported, Context items and links where defensible, compactions, delivery provenance, annotations, evidence citations, Candidate skills and versions, approvals, and Organization standard releases.
- A Session is a durable resumable history and has no inferred permanent end. An Activity episode is a contiguous observed period. A Turn is the authoritative atomic unit for the initial product. The product does not automatically group Turns into larger inferred work units.
- Activity state is derived from recent evidence and connectivity as live, idle, or resumed. Session outcome is a human annotation: successful, partial, failed, or unknown. Review status is exemplar, needs help, or ordinary. Session tags are free-form. These concepts must not share one overloaded status field.
- Projection is idempotent and replayable. Reprocessing must be able to rebuild canonical records from retained source events under a named projection version while preserving historical reconciliation evidence.
- Multiple observations describing the same activity are reconciled without silent precedence. The model records source, rule, confidence, disagreement, and selected canonical value where selection is defensible.
- Store Organization, owner, and delivering-device provenance. Delivery through a different credential cannot transfer Session ownership; it becomes reconciliation evidence.

### Token, context, capability, and cost analysis

- Preserve provider-reported Token usage categories separately: input, cached input, output, reasoning output, total, and any producer-version additions. Record model, service tier when available, producer event, time, and whether Turn association is documented, observed/unstable via trace hierarchy, or inferred.
- Session cumulative Token usage is consumption over time and is not Context occupancy. Visualizations and API fields must use different names, units, and explanations.
- Record exact model Context-window and auto-compaction limits when emitted. Context occupancy may be estimated from available input usage and model limit, but must be labelled inferred and must name its calculation and missing assumptions.
- The Context baseline is the first defensible model-request occupancy/composition observation. It is not an empty-context claim.
- Exact serialized request context and per-item contribution are unavailable on the stable passive contract. Locally tokenized captured content may be offered only as an estimate with method/version and must not be combined with provider counts as if exact.
- Evidence-backed context risks may include conflicting instructions, stale or oversized MCP results, irrelevant skill content, repeated tool output, prompt injection, secret exposure, and compaction followed by rework. The product presents the supporting events and avoids declaring context bad because it is large or correlated with failure.
- Provider-reported monetary cost is unavailable. Optional cost is an estimate derived from Token usage and a versioned external price table. Store currency, effective date, calculation inputs, model mapping, authentication/billing caveat, and price-table version. Never present ChatGPT subscription or credit accounting as API billing.
- The token/context/cost validation ticket must settle which graphs remain defensible for the target Codex version. Unsupported composition charts must be removed or clearly marked unavailable rather than populated from guesses.

### Web investigation experience

- The Organization experience must cover live/recent activity, members, repositories, Sessions, descriptive usage and cost signals, search/comparison, Skills/Organization standards, and the approval queue. The exact information architecture, density, ordering, and chart selection remain an interactive prototype gate.
- The Session experience must combine a chronological timeline with a navigable Agent-run hierarchy. Selecting an entity in either view should reveal its related Turn, parent/child and causal evidence, tools, model activity, token/context evidence, errors, source provenance, and citations where available.
- The UI must show capture gaps and evidence states as first-class content. It must not fill unavailable data with zeros, flatten unstable data into exact values, or hide inferred edges behind normal tree styling.
- Near-real-time updates arrive over authenticated SSE. Losing the live connection does not alter stored Session outcome and can recover through ordinary query plus stream resumption semantics defined by the API contract gate.
- Members and Administrators can view all Organization Session content by default. Both may assign the lightweight Session outcome, review status, and tags. Administrators have no hidden extra evidence tier; their additional authority concerns Organization standards.
- Seeded Sessions and Example members are clearly designated everywhere and excluded from real aggregates, Repeated patterns, and real-evidence claims unless explicitly included for onboarding or comparison.
- Do not create user productivity, Token, or cost leaderboards. Descriptive per-member filtering and comparison must remain evidence-oriented rather than rank people.

### Search, comparison, and evidence claims

- Search and inspection operate on real persisted capture through `/api/v1`. Minimum discovery includes stable identifiers and structured/full-text filters needed to find Sessions by time, member, repository context, activity, annotation, model/tool/capability evidence, and errors where captured.
- The exact ranking, relevant-session retrieval, comparison dimensions, and pattern-analysis command/query shapes remain gated by the search/comparison ticket. Semantic retrieval is not required for the hackathon.
- Comparisons may operate on a complete Session or individual Turns. They must name the compared population, filters, data completeness, and synthetic-data inclusion.
- A factual analytical claim links to one or more Evidence citations. A Repeated pattern requires at least two distinct real Turns. Seeded Sessions cannot satisfy that requirement. One real case is a single-case hypothesis.
- Correlation is not causation. The product must not infer productivity or success from Token use, duration, number of tools, model choice, or cost alone.
- The initial outcome evidence is the human-assigned Session outcome, review status, tags, and captured operational facts. Repository/test/CI/issue/PR/review/revert/deployment outcome connectors are deferred. The outcome-evidence ticket must define refusal language for unsupported claims before any richer success analysis is implemented.
- No separate background analytics or automatic pattern-mining engine is built during the hackathon. Organization-analysis agents perform analysis on demand through the Analysis CLI; deterministic UI aggregates remain ordinary server queries.

### Analysis CLI and Analysis skill

- Build a TypeScript Analysis CLI over `/api/v1`, authenticated by a revocable Analysis credential. It reads all Organization evidence permitted to the member and can submit Candidate skills, but cannot mutate captured evidence, approve, publish, or deploy.
- Provide both human-readable output and stable structured output. Commands use explicit pagination, stable identifiers, stable error codes, evidence-state fields, and browser deep links. Exact command names and output schemas remain a prototype gate, but the underlying API is shared and versioned.
- The companion Analysis skill teaches an agent to search, inspect, watch, compare, cite, state uncertainty, exclude Seeded sessions from real claims by default, distinguish hypotheses from Repeated patterns, and choose an appropriate intervention rather than assuming every problem is a skill.
- MCP is a later adapter over the same read API, not a parallel hackathon implementation.

### Candidate skill and human approval lifecycle

- Skills are the only implemented Candidate intervention type during the hackathon. Workflows, automations, configurations, MCP changes, instructions, and human training may be described as future opportunities but are not implemented Candidate types.
- Candidate submission contains a complete, versioned, installable skill package, reviewer context, Evidence citations for every factual claim, uncertainty, and artifact hash. Prose alone is not a Candidate skill.
- The browser supports draft review, reject, edit, and approve. An edit creates a new immutable version and resets approval. Approval is bound to the exact artifact hash and requires an authenticated Administrator browser action.
- Analysis credentials, Device credentials, and agents cannot approve or bypass the human gate, even when associated with an Administrator.
- Approval creates and publishes an immutable Organization standard release that is mandatory on every Enrolled device. Member opt-out is not supported. Rejection prevents publication; an Administrator may pause distribution or roll the Organization back to an earlier approved release.
- Each daemon polls a small approved-standard manifest at a bounded interval using its narrowly scoped Device credential. When a newer mandatory release is available, it downloads to staging, verifies the Administrator-approved artifact hash, waits until installation cannot affect an active Session, atomically switches the installed version, reports status, and retains the previous working version for rollback before later garbage collection.
- The daemon must never delete the current version before the new artifact is completely downloaded and verified. Failed download, verification, staging, or switch leaves the current version active and produces an observable failure.
- Exact polling interval, activity/idle rule, distribution directories, collision policy with personal skills, retained rollback versions, rollback protocol, and installation-status vocabulary must be settled in the Candidate-skill delivery ticketing plan. Mandatory Organization standards must not silently overwrite unrelated personal skill content.

### Real-versus-seeded boundary

- Real capture, Delivery queue behavior, ingestion, source-event persistence, projection, search, inspection, comparison, SSE, Analysis CLI queries, and the primary demonstration use actual Codex activity.
- Synthetic fixtures are allowed for unit/contract tests, deterministic failure cases, onboarding, screenshots, UI prototyping, and additional Example members.
- Every Example member and Seeded session carries a durable designation preserved by storage, API, UI, CLI, citations, exports, comparisons, and aggregates.
- Seeded Sessions are excluded from real-data aggregates and evidence claims by default. Explicit inclusion is a query choice and remains visible in results.
- The delivery/query contract must define a separate server-controlled path for creating Example members and Seeded sessions. It must never use or impersonate a Device credential, must not enter the real-capture source-event path, and must preserve the synthetic designation through storage, API, UI, CLI, citations, comparisons, and aggregates.
- A versioned example-data pack enters that path only after an explicit Administrator CLI command or UI action. The operation is idempotent, never runs automatically at startup, and can create only irrevocably designated Example members and Seeded sessions.
- The primary demonstration must include at least one real multi-Turn Codex Session with tools, model and Token evidence, and at least one Subagent. A nested Subagent is included only if the target-version probe proves honest parentage.

### Deployment and repository-native operation

- The supported packaged path is one Docker Compose command that starts the Fastify application and PostgreSQL with persistent volumes, health checks, migrations, and configurable network address.
- The supported native development path is Docker-free, connects to locally installed PostgreSQL through `DATABASE_URL`, and starts through one ordinary project command. The project does not install system PostgreSQL automatically.
- Both modes use identical application code, PostgreSQL schema, migrations, configuration keys, bootstrap behavior, and API contracts. Docker is not required for tests, migrations, or ordinary native startup.
- Repository-native documentation must explain prerequisites, native development, Compose deployment, configuration, migrations and upgrades, bootstrap, Codex setup/disconnect/uninstall, Analysis CLI and skill use, architecture, domain model, evidence states, credential scopes, delivery troubleshooting, redaction behavior, backup/persistence, and known capture limitations.

### Explicit validation gates

- Implementation ticket 03 must probe target-version source coverage and direct/nested parentage independently of server bootstrap or enrollment. Negative findings reduce the Codex adapter's Capture capability declaration before ticket 04 implements the adapter.
- Implementation tickets 04 and 05 must settle and verify envelope identity, entity relationships, provenance, confidence, reconciliation, replay, batch acknowledgement, idempotency, retry, partial failure, reprocessing, errors, SSE recovery, and canonical query behavior before consumers fan out.
- Implementation ticket 06 must prove reversible setup, `launchd` restart recovery, and real delivery after interruption through the complete first-day chain.
- Implementation ticket 08 must determine which Token, Context, capability, skill, MCP, lifecycle, tool, and cost evidence is defensible for the probed target version.
- Implementation tickets 09 and 10 must validate explicit Example-data loading, search, comparison, pagination, stable citations, and refusal of unsupported productivity or causal claims.
- Implementation ticket 11 must produce at least three genuinely different working Organization/Session interface prototypes and obtain a direction decision before ticket 12 applies production polish.
- Implementation ticket 13 must prove Analysis CLI and skill ergonomics, structured output, citations, scoped authentication, and complete Candidate submission.
- Implementation ticket 15 must prove Compose and Docker-free native parity and the repository-native operating/troubleshooting handoff.
- The deliberately open content-governance question remains a post-hackathon risk. Hackathon implementation is limited to the resolved lightweight human annotations, Organization-visible default, setup disclosure, default high-confidence secret redaction, credential separation, and explicit deferrals.

## Testing Decisions

### Testing philosophy and TDD workflow

- Tests verify externally visible behavior through the three confirmed testing boundaries: the `/api/v1` interface, the Agent-adapter contract, and a thin full-system macOS acceptance proof. Tests do not exercise private methods, internal collaborator calls, or database rows as substitutes for public behavior.
- Every implementation ticket must include a short testing plan naming the confirmed seam, the user-visible behavior, the first failing test, required fixtures or real evidence, and the success command. The agent then works one vertical tracer bullet at a time: one failing test, the minimum implementation that makes it pass, then the next behavior. Refactoring is handled during review after the red-to-green cycles rather than bundled into speculative implementation.
- Prefer the highest seam that gives deterministic feedback. Add a lower module test only when a behavior cannot be expressed economically at a confirmed seam, such as deterministic redaction rules or SQLite crash recovery. Lower tests must still use that module's public interface.
- Expected values come from independent specification examples, captured first-party fixtures, fixed cryptographic/hash vectors, or explicit protocol contracts. Tests must not recompute expectations with the production algorithm or approve large snapshots that can drift unnoticed.
- Tests must remain insensitive to implementation refactors. Avoid mocking internal projection services, repositories, or React component structure. Replace only true external boundaries such as time, Codex, the operating system service manager, the network, and price-table input.

### Primary seam: `/api/v1`

- Use Vitest to exercise Fastify through its HTTP boundary against a disposable real PostgreSQL database and real migrations. Fastify request injection is acceptable for ordinary REST behavior because it preserves routing, authentication, serialization, and validation; use a real socket where streaming or connection behavior matters.
- Contract tests cover OpenAPI generation, Zod validation, additive-field tolerance, stable identifiers, pagination, machine-readable errors, authentication scopes, and denial behavior for browser, Analysis, and Device credentials.
- Ingestion tests submit representative documented, observed, unstable, inferred, redacted, duplicate, retried, out-of-order, and unknown-field events. Assertions read through query endpoints rather than directly inspecting projection tables.
- Reliability tests prove that replaying an acknowledged batch is idempotent, accepted source evidence remains queryable, projection reprocessing does not mutate raw evidence, conflicting observations retain reconciliation, and a different delivering device cannot transfer Session ownership.
- Query tests prove Session/Turn/Agent hierarchy, timeline ordering, Activity states, annotations, search filters, evidence-state labels, Seeded-session defaults, Evidence citations, and stable deep links through public responses.
- SSE tests use a real HTTP connection to prove authenticated subscription, ordered near-real-time updates, disconnect/reconnect behavior selected by the delivery-contract gate, and recovery through an ordinary query without converting disconnection into a Session outcome.
- Candidate-skill tests prove submission scope, complete-artifact requirements, citation requirements, immutable versions, hash-bound approval, approval reset on edit, role enforcement, mandatory publication on approval, pause/rollback, and the inability of an Analysis or Device credential to approve.
- Credential tests prove bootstrap single use, invite single use, verifier-only persistence behavior through observable redemption, short-lived enrollment grants, independent revocation, and Device/Analysis/browser scope isolation.
- Example-data tests prove explicit Administrator authorization, CLI and UI parity over the same API, pack-version idempotency, irreversible synthetic designation, absence of Device impersonation, and exclusion from real aggregates by default.

### Secondary seam: Agent-adapter contract

- Use producer-versioned, key-preserving Codex OTel log, trace, lifecycle-hook, agent-communication, app-server, rollout, and local-state fixtures derived from the validated capture research and target-version probe. Sensitive content is replaced while structure and identity relationships remain realistic.
- Contract tests feed source observations into the Codex Agent adapter and assert canonical observations, raw preservation, Capture capability declarations, producer/parser versions, unknown-field preservation, evidence states, derivation/confidence, and downgrade behavior.
- Identity tests cover tree-wide Session id versus per-thread Agent-run id, hook Turn ids, direct and nested parent edges, unresolved parentage, fork lineage versus parentage, resume as a new Activity episode, and lack of permanent completion.
- Model/tool tests cover transport attempts versus inferred logical Model requests, retry correlation, incomplete hook coverage, independent `tool_use_id` and `call_id`, MCP evidence, permission events, and tool failure.
- Token/context tests cover provider categories, trace-based exact-but-unstable association, log-only inference, Context-window limits, occupancy calculation labelling, unavailable per-item contribution, and estimated cost metadata.
- Skill/capability tests cover explicit mention, inferred prompt or file evidence, unavailable implicit activation, configured MCP server names, observed MCP use, and unavailable complete passive snapshots.
- Compatibility tests prove that unsupported producer versions downgrade or reject version-gated parsing explicitly rather than silently producing stable-looking data.

### Relay, setup, and operating-system behavior

- Exercise the relay's public capture and delivery interfaces with a real temporary SQLite database and a controllable `/api/v1` test server. Inject network refusal, timeout, server restart, relay restart, duplicate acknowledgements, and machine-clock differences; assert only through queue/delivery status and server queries.
- Prove record-before-network behavior so a slow or unavailable server cannot block lifecycle hooks or lose accepted local input.
- Prove that unacknowledged events survive process restart and acknowledged events are eventually removed. Exact partial-batch and poison-event tests follow the resolved delivery contract.
- Test setup and uninstall against an isolated temporary Codex home and service-manager boundary. Assert preview, consent, configuration merge, backup/restore, idempotent rerun, server URL, enrollment, visibility disclosure, ordinary-redaction default, independent Demo-canary default, Settings updates, verification event, disconnect, and uninstall behavior.
- Run a real macOS acceptance probe with `launchd`, not only a mocked service manager. Reboot-level behavior may be demonstrated through unload/load and process-kill recovery during automated development, with an explicit manual machine-restart checklist before the showcase.

### Web and CLI behavior

- Use Playwright for critical browser journeys: Bootstrap-code redemption; Invite-code member creation; live real Session appearance; Session timeline and Agent hierarchy navigation; evidence-state and Seeded-session labels; annotation; search/compare; Candidate skill review; edit invalidating approval; and Administrator approval.
- Playwright setup may create deterministic records through `/api/v1`, but at least one showcase acceptance journey begins with real Codex capture and ends in the browser. UI tests must not insert directly into PostgreSQL.
- Test accessible names, keyboard navigation for critical investigation paths, error and empty states, live-update status, and responsive layouts needed for the target demo. Avoid pixel-perfect snapshots as the main assertion.
- Test the Analysis CLI as a spawned process against a real test server. Cover human output, structured output, pagination, stable errors, deep links, Seeded defaults, evidence-state preservation, citations, Candidate skill submission, revoked credentials, and forbidden approval.
- Validate the companion Analysis skill with scenario tests or scripted agent evaluations that check required CLI use, citations, uncertainty, two-Turn Repeated-pattern rule, and refusal to treat Seeded sessions as real evidence. Evaluation outputs support review; they do not replace deterministic CLI contract tests.

### Projection, redaction, and standard delivery

- Projection behavior is primarily tested through ingestion and query endpoints. Focused public-module tests may cover deterministic reconciliation, replay, activity-state derivation, and cost calculation when interface tests would obscure edge cases.
- Redaction tests use fixed secret examples and near misses to prove high-confidence substring-only detection, preservation of surrounding prompt text, keyed fingerprint stability, source-location evidence, no plaintext persistence in SQLite or PostgreSQL, default enablement, and explicit disablement. Separate tests prove that the disabled-by-default Demo canary matches only its exact reserved synthetic prefix and cannot match ordinary prompt text. They must also cover tool inputs/outputs because disabling prompt logging does not protect those fields.
- Organization-standard synchronization tests use an isolated skill-install destination and a controllable manifest server. Prove bounded polling, mandatory installation on every Enrolled device, exact-hash verification, download-before-delete, atomic switch, retention of the previous version, pause, central rollback, restart recovery, observable status/failure, no unapproved version, no member opt-out, and no changes while a Session is active.

### Deployment and documentation verification

- Run schema migrations and the API suite in native PostgreSQL mode. Run a Compose smoke test that starts the application and PostgreSQL from empty volumes, completes bootstrap, ingests/query a test event, serves the web application, restarts with persistent data, and reports health.
- Verify that native and Compose modes expose the same OpenAPI contract and migration version. Configuration conformance tests prevent mode-specific defaults from changing authentication, storage, or capture behavior.
- Treat documentation commands as executable acceptance checks where practical. A new contributor should be able to follow native development, Compose deployment, Codex setup/uninstall, Analysis CLI, and troubleshooting instructions without conversation-only knowledge.

### Full-system acceptance proof

- Before the first-day checkpoint, capture a real target-version Codex Session containing at least two Turns, a successful and failed supported tool call, an approval if feasible, a Subagent, provider Token usage, and a relay/server interruption. Verify recovery and inspect the same Session through `/api/v1`, the browser, and the Analysis CLI.
- Before the fuller hackathon demonstration, add an MCP call, explicit and implicit skill scenarios, compaction, resume, retry, a harmless synthetic credential that proves real pre-delivery redaction, and a grandchild only where feasible and supported. Record which fields are documented, observed, inferred, unstable, or unavailable, and verify that the synthetic credential value was never persisted.
- The demonstration must make limitations visible. A failed target-version probe changes the advertised Capture capability and demo story; it is not fixed by timestamp guessing or seeded replacement.

### Prior art

- The repository currently contains planning artifacts but no implementation or existing test suite. There is therefore no local test style to preserve.
- Use established Fastify request-injection patterns for REST contracts, real PostgreSQL migrations for persistence behavior, Vitest for TypeScript interfaces, Playwright for browser journeys, and producer-versioned contract fixtures for the Agent adapter. These conventions become repository prior art once the first vertical slice lands.

## Out of Scope

- Remote control, remote desktop behavior, or steering another person's active coding agent, Session, or computer.
- Treating inactivity, disconnect, a root `Stop` hook, or idle state as proof that a resumable Session is permanently finished.
- Live Agent adapters for Claude Code, OpenClaw, OpenCode, Hermes, or any provider other than Codex during the hackathon.
- Linux `systemd` and Windows service lifecycle implementations.
- Historical backfill of Sessions created before capture installation.
- Making transcript/rollout parsing the stable primary capture contract.
- Fabricating logical Model-request ids, complete Context composition, implicit skill activation, complete passive capability snapshots, stable fork events, provider monetary cost, or unsupported parent edges.
- Multi-Organization behavior, Organization creation/switching, tenant isolation, hosted signup, billing, and cross-Organization invitations.
- Password authentication, email delivery/verification, account recovery, OAuth/OIDC, full member administration, custom roles, or an owner/superuser role.
- Private Sessions, per-user access lists, repository/folder capture allowlists, or repository/folder visibility policies.
- Full retention configuration, deletion, export, legal hold, data residency, comprehensive audit controls, and arbitrary content-classification policy beyond the resolved visibility disclosure and high-confidence secret-redaction baseline.
- User productivity scores or leaderboards based on Tokens, cost, tool count, duration, or model choice.
- Automatic grouping of related Turns into inferred work units.
- A scheduled analytics service, automatic pattern miner, alerting, anomaly detection, budgets, forecasts, or chargeback.
- Full repository, test, CI, issue, commit, pull-request, review, revert, and deployment outcome connectors.
- Semantic similar-Session retrieval or a vector database as a hackathon requirement.
- Automatic causal claims from correlation.
- Candidate intervention types other than skills during the hackathon, including workflows, automations, configuration, MCP changes, repository instructions, and human training.
- Automatic approval or publication of Candidate skills, including by an Organization-analysis agent using an Administrator's Analysis credential.
- Member opt-out from an Administrator-approved Organization standard release.
- Changing or reinstalling an approved Organization standard inside an active Session.
- A hackathon MCP server; it is a later adapter over the same `/api/v1` query contract.
- Kafka, a general background job queue, a separate analytics database, Kubernetes, or other unproven distributed infrastructure.
- Docker as a requirement for native development, testing, migrations, or ordinary local application startup.
- Polished final information architecture before the required UI prototype chooses an approach.
- Implementing the product or generating implementation tickets as part of this specification task.

## Further Notes

### Evidence-strength rules

- `documented` means the current public Codex documentation names the surface or field family.
- `observed` means current first-party source or local first-party artifacts contain it, but public compatibility is not promised.
- `inferred` means the platform correlated or calculated the value and retains the inputs, method, and confidence.
- `unstable` means the source is experimental, internal, transcript/rollout based, version-gated, or otherwise explicitly not a stable contract.
- `unavailable` means the platform has no supported fact for the requested value. Unavailable is not zero, false, or absent activity.
- These labels describe different dimensions and may coexist. For example, a parent edge may be exact data on an unstable source, while a Context occupancy value may be inferred from documented Token and window fields.

### Target-version Codex validation probe

Before schemas or demo claims are locked, run one real macOS Session with OTel logs, OTel traces, and all lifecycle hooks enabled. Include two Turns; supported tool success and failure; an approval; one MCP call; explicit and implicit skill use; manual and automatic compaction if feasible; resume; fork; a child; and a grandchild after raising the Codex nesting limit. Capture raw OTel and hook payloads plus key-only fallback metadata.

The probe must determine whether hook and OTel tool ids reconcile, whether completion-to-Turn trace association survives retries/tools/parallel Subagents/compaction, whether nested hooks identify the immediate parent without rollout parsing, how fork appears, which Codex clients materialize fallback artifacts in time, and which exact event fields exist in the installed version. Negative or ambiguous results reduce capability declarations.

### Demonstration contract

The final demonstration follows one continuous evidence chain:

1. Start the native or Compose self-hosted server.
2. Run one-time Codex setup and verify delivery.
3. Explicitly enable the Demo redaction canary in Settings, then run a real multi-Turn Codex Session with its harmless synthetic test value, supported tools, and Subagent activity.
4. Watch the real Session appear and update in the Organization view.
5. Inspect its Turn timeline, Agent-run hierarchy, model/tool/context evidence, and capture gaps.
6. Diagnose a concrete problem using linked evidence rather than a score.
7. Search and compare relevant real historical Sessions; include Seeded sessions only as visibly labelled examples.
8. Give an Organization-analysis agent the Analysis skill and let it use the real CLI.
9. Submit a complete evidence-backed Candidate skill.
10. Have an Administrator review and approve the exact artifact in the browser, then observe every Enrolled daemon discover, verify, and atomically install the mandatory Organization standard; demonstrate Administrator pause or rollback if time permits.

### Guidance for implementation

- The 16-ticket implementation tracker uses tracer-bullet vertical slices that each deliver demonstrable behavior through capture, server, and a user-facing consumer where applicable. Wide mechanical changes are the exception.
- Each ticket should declare genuine blockers, acceptance criteria, its confirmed testing seam, a TDD plan, real-versus-fixture requirements, and the exact capability downgrade when validation fails.
- The first implementation frontier should protect the real first-day chain. Rich graphs, comparison, and Candidate-skill polish must not precede proof of setup, restartable capture, durable delivery, persistence, and basic browser/CLI inspection.
- Implementation validation tickets are the active gates and risk register. If a ticket finds weaker Codex support than hoped, update the adapter capability and scope rather than changing the meaning of `documented`, `observed`, `inferred`, `unstable`, or `unavailable`.
- The superseded Wayfinder tickets remain historical decision context and must not be treated as a second execution queue. The broader content-governance ticket is the sole deliberate exception and remains open for post-hackathon work.
