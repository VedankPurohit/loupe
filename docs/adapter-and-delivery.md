# Codex adapter and source-event delivery

Ticket 04 establishes the production boundary from redacted Codex observations
to immutable central source evidence. Capture remains local-first: hook and OTel
handlers adapt and synchronously record an event in SQLite, return without
waiting for the network, and let the relay call delivery separately.

## Agent-adapter interface

`@workspace/agent-adapter` exposes two public operations:

- `adaptCodexObservation(observation)` preserves the supplied raw object and
  returns canonical observations, a capability declaration, parser metadata,
  and an `adapted`, `preserved`, `downgraded`, or `rejected` disposition.
- `createCodexSourceEvent(...)` wraps that result in the version-1 immutable
  delivery envelope after local redaction. Its payload hash and stable
  deduplication key cover the retained source payload and provenance inputs.

The supported producer is `codex-cli 0.144.5`. Hooks provide exact Session and
Turn identity when `session_id` and `turn_id` are emitted. The target-version
capability matrix remains the one in
[`capture/codex-0.144.5.md`](./capture/codex-0.144.5.md): tool coverage is
partial, parentage is conditional and version-gated, and logical model-request
identity, implicit skill activation, complete passive capability snapshots,
and provider monetary cost are unavailable. Unknown events and additive fields
are retained without being promoted to canonical facts.

Unsupported producer versions on primary hook/OTel sources are retained with
empty canonical output and downgraded capabilities. Unsupported rollout input
is rejected from version-gated parsing. Neither path invents stable-looking
identity. A rejected observation may still be retained as raw delivery evidence
with its adapter disposition; it is not projected as a supported fact.

## Version-1 source-event envelope

Each event contains a UUID delivery identity, stable deduplication key, source
payload hash, source/capture path, producer name/version/event, parser
name/version, occurrence and local capture times, untouched redacted raw
payload, canonical observations, adapter disposition/capabilities, and the
effective redaction policy/evidence. The relay must receive content only after
ordinary and optional Demo-canary redaction. Device credentials never broaden
that boundary or grant Organization evidence access.

The server adds receipt time and the authenticated delivering Device and batch
identities. PostgreSQL retains source events append-only; a database trigger
rejects update and delete. The authenticated browser query
`GET /api/v1/source-events/:id` returns retained evidence. Device credentials
cannot call that query.

## Batch acknowledgement and retries

The relay posts at most 100 events to
`POST /api/v1/device/source-event-batches`. A response is bound to its
`batchId` and contains one result per event:

- `accepted`: newly stored; remove it from SQLite.
- `duplicate`: the same event id, deduplication key, and payload hash already
  exist; remove it from SQLite. This makes lost acknowledgements safe to retry.
- `rejected` with `retryable: true`: retain and retry.
- `rejected` with `retryable: false`: retain locally as `poisoned` and exclude
  it from later ordinary batches so unrelated evidence continues.

Malformed acknowledgements, missing event results, network failure, and HTTP
failure retain unacknowledged events. Retry delay grows exponentially from one
second and is capped at 60 seconds. There is no timestamp watermark: duplicate,
retried, and older/out-of-order observations are resolved by event identity and
deduplication evidence. Reusing an identity or deduplication key for different
payload evidence is a permanent conflict, never a duplicate acknowledgement.

SQLite contains only the delivery queue. Pending and poisoned rows survive
relay or machine restart. Acknowledged rows are deleted; poisoned rows require
operator investigation and an explicit future repair/requeue operation rather
than automatic infinite blocking retries.

## Replay and redaction ordering

Redaction precedes `createCodexSourceEvent` and SQLite persistence. The central
store verifies the payload hash before insertion. Reprocessing passes the
retained `rawPayload` through a named newer adapter/projection version and
writes new projection/reconciliation records; it must never update the source
event. The current projection tables preserve the adapter and projection
versions needed for deterministic replay. A general operator-triggered
reprocessing command is not yet delivered; a future command must keep this
append-only boundary.

## Troubleshooting

- Pending with `DELIVERY_NETWORK_ERROR`, `NETWORK_REFUSED`, or
  `DELIVERY_HTTP_<status>`: confirm the server URL, network, credential, and
  `/api/v1/health`; the event remains durable and retries with bounded backoff.
- `ACKNOWLEDGEMENT_INVALID`: confirm relay/server API versions and that no proxy
  altered the JSON response or batch identity.
- `SOURCE_EVENT_UNSUPPORTED_SCHEMA_VERSION`: upgrade the server or adapter;
  the local row is poisoned and does not stall valid evidence.
- `SOURCE_EVENT_PAYLOAD_HASH_MISMATCH`: do not retry unchanged; inspect local
  serialization/integrity handling.
- `SOURCE_EVENT_DEDUPLICATION_CONFLICT`: preserve both local facts for operator
  diagnosis; never overwrite the accepted central event.

Node 22's built-in SQLite API remains experimental. PostgreSQL is the only
central store, and no delivery behavior depends on SQLite as an analytical
database.
