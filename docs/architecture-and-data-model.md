# Architecture and data model

Loupe is a self-hosted, single-Organization system with two durability domains:
PostgreSQL is the central source of truth; SQLite on each enrolled Mac is only
the durable queue for capture awaiting acknowledgement. The browser, relay, and
Analysis CLI all use the versioned `/api/v1` contract. None reads PostgreSQL
directly.

## Runtime architecture

The capture path is deliberately one-way until evidence reaches the server:

```text
Codex hooks + OTLP/HTTP JSON
        │
        ▼
producer-versioned Codex adapter
        │
        ▼
ordinary / optional Demo redaction
        │  (before either persistence layer)
        ▼
SQLite delivery queue ── batches + Device credential ──► /api/v1
                                                        │
                                                        ▼
                                              append-only source_events
                                                        │
                                                        ▼
                                             replayable canonical projection
                                                        │
                    ┌───────────────────────────────────┼──────────────────┐
                    ▼                                   ▼                  ▼
             React browser                       Analysis CLI        SSE invalidations
```

Hooks record synchronously into the local queue and do not wait for the
network. The relay retries unacknowledged evidence with bounded backoff. Server
acknowledgements are idempotent by source-event and deduplication evidence.
Projection can be rebuilt from immutable source events; the SSE stream is only
an invalidation channel and is not a second event store.

The standards path returns an approved artifact through a narrower Device API:

```text
Analysis credential submits Candidate
        │
        ▼
human Administrator reviews exact immutable hash
        │
        ▼
approved Organization release + Device manifest
        │
        ▼
relay stages ─► verifies hash ─► atomically switches Organization namespace
```

The relay cannot approve, publish, pause, or roll back. The browser cannot
deliver captured evidence. This separation is enforced by distinct credential
types rather than by client convention.

Repository modules are:

| Module | Boundary |
| --- | --- |
| `packages/contracts` | Zod runtime contracts, TypeScript types, and OpenAPI schemas for `/api/v1`. |
| `packages/agent-adapter` | Codex `0.144.5` source preservation, producer-versioned interpretation, and capability declarations. |
| `packages/relay` | macOS setup/`launchd`, pre-persistence redaction, Git sampling, SQLite queue, delivery, and standard synchronization. |
| `packages/database` | Drizzle PostgreSQL schema and committed migrations. |
| `apps/server` | Fastify authentication, ingestion, projection, evidence query, Candidate review, and standard distribution. |
| `apps/web` | Authenticated React investigation and administration surface using only `/api/v1`. |
| `apps/diagnostic-cli` | Human/JSON evidence queries, citations, Analysis credentials, Example import, and Candidate submission. |
| `skills/analyze-organization-evidence` | Coding-agent workflow for evidence-backed analysis and Candidate manifests. |

## PostgreSQL data model

Tables are grouped by responsibility; operators should use `/api/v1` and
migrations rather than treating these tables as a public interface.

| Area | Durable records | Invariant |
| --- | --- | --- |
| Organization identity | `organizations`, `organization_members` | Exactly one Organization exists in a deployment. Example members remain designated. |
| Human and short-lived access | `bootstrap_credentials`, `invite_credentials`, `browser_sessions`, `analysis_credentials` | Bootstrap and Invite codes use salted scrypt verifiers; browser and Analysis tokens are stored only as digests. |
| Device identity | `device_enrollment_grants`, `enrolled_devices`, `device_credentials` | Each Device belongs to one Member; revocation does not rewrite accepted history. |
| Original capture | `captured_records`, `source_events` | Redacted payload and provenance are retained. `source_events` reject update/delete and are idempotent within the Organization. |
| Canonical execution | `execution_sessions`, `activity_episodes`, `execution_turns`, `execution_agent_runs`, `execution_timeline_events` | A replayable projection preserves canonical ids, reconciliation, and evidence fidelity without changing original events. |
| Human and Example context | `session_annotations`, `example_pack_imports` | Human outcomes/review/tags survive projection rebuild. Example-pack import is explicit, versioned, and idempotent. |
| Candidate governance | `candidate_skills`, `candidate_skill_versions`, `candidate_version_reviews` | Package versions and review decisions are immutable; approval binds to the exact artifact hash. |
| Distribution | `organization_standards`, `organization_standard_releases`, `device_standard_installations` | Releases retain approved bytes; pause/rollback changes the manifest target, while Device reports remain historical observations. |

Session ownership is assigned from the Device credential that first delivers a
new canonical Session. A payload field cannot claim a different owner. Later
cross-device evidence becomes a reconciliation input, not a transfer.

The canonical hierarchy distinguishes Session id, platform Agent-run id, Codex
thread id, and hook `agent_id`. Parent edges can be exact, inferred, or
unresolved. Sessions are durable resumable histories; live, idle, and resumed
are Activity states, not permanent completion or human outcome.

## Evidence states

Loupe keeps source stability separate from derivation:

| Dimension | Values | Meaning |
| --- | --- | --- |
| Stability | `documented`, `observed`, `inferred`, `unstable`, `unavailable` | Strength and durability of the source contract. |
| Derivation | `exact`, `inferred`, `unavailable` | How Loupe obtained the displayed fact from retained evidence. |
| Adapter disposition | `adapted`, `preserved`, `downgraded`, `rejected` | Whether a source observation could safely become canonical output. |
| Parent edge | `exact`, `inferred`, `unresolved` | Whether a defensible selected parent exists. |
| Synthetic identity | real or `seeded` with Example-pack version | Whether a record came through real Device capture or explicit Example import. |

An unavailable field remains unavailable; clients do not render it as zero,
`false`, or “not used.” Provider Token categories remain distinct from inferred
Context occupancy. Cost exists only as a versioned estimate with an explicit
price table and model mapping. Redaction evidence records rule, type, offsets,
and a keyed fingerprint but never the matched plaintext.

See [Rich Session evidence](session-evidence.md),
[Session and Turn comparisons](session-comparisons.md), and
[Codex adapter and source-event delivery](adapter-and-delivery.md) for the
producer-specific contract and stable refusal language.

## Credential scopes

| Capability | Member browser Session | Administrator browser Session | Analysis credential | Device credential |
| --- | --- | --- | --- | --- |
| Read Organization Sessions/evidence | Yes | Yes | Yes | No |
| Annotate a Session | Owner only | Yes | No | No |
| Create own Device enrollment | Yes | Yes | No | No |
| Configure/revoke own Device | Yes | Yes | No | No |
| Deliver capture and read own capture policy/health | No | No | No | Yes |
| Read approved manifest/artifact and report own install state | No | No | No | Yes |
| Create/revoke own Analysis credential | Yes | Yes | No | No |
| Submit a Candidate skill | No | No | Yes | No |
| Issue Invite codes / import Example pack | No | Yes | No | No |
| Edit, reject, or approve Candidate | No | Yes, human action | No | No |
| Pause, resume, or roll back standards | No | Yes, human action | No | No |

An Administrator-owned Analysis credential receives no Administrator authority.
A Device token is not a member token and cannot browse captured content. Human
approval is bound to an authenticated Administrator browser Session; it cannot
be delegated to the Analysis agent that proposed the package.

Bootstrap codes, Invite codes, and Device-enrollment grants are one-time or
short-lived exchange credentials, not durable API credentials. The plaintext
Device and Analysis tokens are returned only at creation/enrollment. Rotate a
credential by revoking it and deliberately creating or enrolling a replacement.

## Security and persistence boundaries

- Ordinary high-confidence secret redaction is enabled for new Devices. The
  exact-prefix Demo canary is independent and disabled by default. Redaction
  occurs before SQLite and PostgreSQL persistence.
- A private per-Device fingerprint key produces non-reversible HMAC evidence;
  it is not written into the queue. The central server validates evidence shape
  but cannot recreate the local fingerprint.
- Browser, Device, and Analysis bearer values are stored as SHA-256 digests.
  Bootstrap, Invite, and enrollment values use verifier material rather than
  redeemable plaintext.
- PostgreSQL is the only central store and backup boundary. SQLite contains
  pending/poisoned delivery plus relay lifecycle state, not an analytical copy
  of the Organization.
- Original source events are append-only. Reprojection writes derived records;
  it does not normalize or overwrite the retained redacted source payload.
- Seeded evidence never enters through a Device credential. It is excluded from
  discovery and analysis by default and cannot satisfy real-Turn thresholds.
- Organization standards install below a reserved managed namespace. Staging
  and exact-hash verification precede the atomic pointer switch; the last
  working version remains available for rollback.
- Captured prompts and Tool content are Organization-visible. Put network
  deployment behind HTTPS and protect database backups, relay state, startup
  logs, browser cookies, and one-time plaintext credentials accordingly.

## Known limitations

- The validated primary adapter targets Codex CLI `0.144.5` on macOS. Linux and
  Windows service lifecycle support and other coding-agent adapters are not
  implemented.
- Root identity and recursive parentage rely on producer-versioned unstable
  agent-communication evidence. Hook-only parentage can be inferred; ambiguous
  nested parentage remains unresolved.
- Codex does not expose stable logical model-request identity, exact serialized
  Context, stable per-item Context contribution, implicit skill activation, a
  complete passive capability snapshot, or provider monetary cost. Loupe does
  not fabricate those values.
- Tool and approval coverage varies by capture surface. Missing evidence is a
  coverage gap, not proof that an action did not happen.
- Session silence and root Stop do not establish permanent completion. Outcomes
  and review status are lightweight human annotations.
- Ordinary secret matching is deliberately conservative, not comprehensive.
  Disabling it can persist secrets. A modified relay can bypass local redaction;
  central validation is defense in depth, not a second plaintext scanner.
- Node 22's built-in SQLite API is experimental. This is a packaging risk for
  the relay, not permission to replace PostgreSQL or discard the durable queue.
- The initial deployment is exactly one Organization. Public signup, passwords,
  email delivery, account recovery, general role management, retention controls,
  multi-Organization isolation, billing, and hosted operation are out of scope.
- The current standard daemon retains release versions and has no garbage
  collection policy. Active Sessions defer installation and an unclosed local
  activity record expires after 30 minutes.
- Large execution-graph clustering and virtualization are deferred. The web
  interface keeps a semantic tree and linear timeline as equivalent fallbacks.
- Analysis can submit complete Candidate skills only. Other intervention types,
  autonomous approval, and member opt-out from Organization standards are not
  supported.
