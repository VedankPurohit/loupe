# Live execution projection and inspection contract

Accepted Codex evidence remains immutable in `source_events`. The live-execution
projection is a replayable view of that evidence; deleting and rebuilding the
projection does not rewrite, replace, or normalize the retained source payload.
Projection version `1` runs after an accepted or duplicate delivery batch, so a
lost acknowledgement or replay produces the same public Session detail.
Projection rebuilds are serialized per Organization with a transaction-scoped
advisory lock; the immutable source-event read and replacement projection write
occur under that same lock so concurrent deliveries cannot publish a stale
snapshot.

## Canonical identities

- `Session.id` is the tree-wide Codex hook `session_id`.
- `Turn.id` is the canonical hook `turn_id`; timestamps never replace it.
- Every Session has one platform Root reference, `root:<session_id>`.
- `AgentRun.codexThreadId` carries the per-thread Codex identity when evidence
  provides it. It is deliberately separate from both the Session id and the
  stable platform Agent-run reference.
- Hook `agent_id` identifies supported Subagent runs. Root thread identity can
  be reconciled from a producer-versioned `codex.agent_communication` spawn
  edge when the source proves it.

This separation prevents a tree-wide Session identity from being mistaken for
the identity of the Root or one of its Subagents.

## Parent reconciliation

Every Subagent exposes `parentEdge.status` as `exact`, `inferred`, or
`unresolved`. The edge includes all inputs, the named selection rule, the
selected parent when defensible, and confidence:

- a single defensible hook-only Root candidate is `inferred`;
- a producer-versioned agent-communication spawn edge is exact but retains its
  `unstable` source-stability label;
- exact input takes precedence over inferred input while both remain visible;
- absent or conflicting defensible inputs produce `unresolved` with no selected
  parent rather than a plausible-looking fabricated tree.

Session ownership uses the same representation. The first accepted Device owns
the durable history; later delivering Devices remain reconciliation inputs and
cannot transfer ownership.

The first acceptance uses only the authenticating Device credential and its
server-side Member association. Owner-like source-payload fields are ignored
for assignment. Revocation or a later enrollment cannot rewrite the retained
owner. See [Members, historical ownership, and Git context](members-ownership-and-git-context.md)
for the invitation and cross-device invariants.

When the relay attaches a Git observation, the Session response includes the
latest sample and its `relay_local_git` provenance. This is sample-time local
evidence, not a claim about Git state at an earlier source-event occurrence.

## Sessions, Activity episodes, and Turns

A Session is a durable resumable history. `SessionStart.source = resume` creates
a new Activity episode in the existing Session. Root `Stop` ends the current
episode and derives `idle`; it does not complete the Session. Silence also does
not create a permanent outcome. Public responses make this explicit with:

```json
{
  "completion": {
    "status": "not_assumed",
    "evidence": "unavailable"
  }
}
```

The initial query surface is browser-session authenticated:

- `GET /api/v1/sessions` lists canonical Session summaries.
- `GET /api/v1/sessions/:id` returns the Session, Activity episodes, canonical
  Turns, Agent runs and parent reconciliation, and the chronological hook
  timeline. It also returns rich Tool/lifecycle, Token, Context, capability, and
  cost evidence under `evidence`; the calculation and downgrade contract is in
  [`session-evidence.md`](./session-evidence.md).

Device credentials cannot browse either route. Diagnostic and browser clients
must use these `/api/v1` routes and never PostgreSQL.

Rich evidence is associated only when a server-side adapter accepts the
producer version, a source-defined identity or canonical adapter observation
matches the Session, and delivery provenance matches the owning Device.
Arbitrary nested tool input/output fields are never searched for identities.
Downgraded evidence remains retained and retrievable as a source event without
becoming documented or exact projection data.

## Live updates and recovery

`GET /api/v1/live` is an authenticated Server-Sent Events stream. Each
invalidation is scoped to the authenticated Organization and ordered within
that Organization in the running server process. Neither Session ids nor gaps
in a cross-Organization global sequence are exposed:

```text
id: 7
event: session.updated
data: {"sequence":7,"type":"session.updated","sessionId":"...","occurredAt":"..."}
```

The stream is an invalidation channel, not a second data model or durable event
archive. On initial load, stream open, or reconnect, clients recover by reading
the ordinary Session query. Losing the stream never changes Session activity,
outcome, or completion state.

## Capability limits

Root thread identity and exact recursive parentage depend on the validated
Codex `0.144.5` agent-communication evidence and retain the `unstable` stability
label. Hook-only direct parentage may be inferred where there is one defensible
candidate; ambiguous nested parentage remains unresolved. No logical model
request identity, implicit skill activation, complete passive capability
snapshot, or provider monetary cost is introduced by this projection. Optional
cost remains a versioned local estimate; exact per-item Context contribution
and unsupported composition charts remain unavailable.
