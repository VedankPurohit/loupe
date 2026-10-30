# 04 — Build the Codex adapter and deliver events reliably

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** Implement the production Codex Agent adapter against ticket 03's producer-versioned fixtures and capability contract, then record each captured source observation locally, deliver canonical and raw evidence through authenticated versioned batches, acknowledge it idempotently, and retain immutable PostgreSQL source evidence even when the relay, server, or network is interrupted.

**Blocked by:** 02 — Enroll devices and control capture policy; 03 — Probe the target-version Codex capture contract.

**Status:** complete

**Documentation impact:** Document the Agent-adapter interface, implemented capability matrix and downgrade rules, event envelope, batch acknowledgement, retry classes, queue lifecycle, source-event schema, redaction ordering, reprocessing contract, and delivery troubleshooting.

**Testing plan:** First test the Agent-adapter seam with ticket 03's sanitized producer-versioned fixtures: the first red contract test maps one documented hook Session/Turn identity while preserving the untouched source observation and unknown fields. Then use a real temporary SQLite queue, a controllable `/api/v1` test server, and real PostgreSQL migrations; the first delivery red test enqueues one redacted adapted observation, delivers it twice, and observes exactly one immutable source event through the public API.

- [x] The Codex Agent adapter preserves raw observations and unknown fields while emitting canonical observations with provenance, evidence-strength metadata, producer/parser versions, and explicit downgrade behavior.
- [x] Unsupported producer versions and negative or ambiguous fixture results reduce or reject capabilities instead of producing stable-looking guesses.
- [x] Hook and OTel capture paths record locally before attempting network delivery and return quickly enough not to block Codex work.
- [x] Unacknowledged events survive relay restart and are removed only after the server's idempotent acknowledgement.
- [x] Duplicate, retried, and out-of-order batches cannot duplicate accepted source evidence.
- [x] Partial failure and poison-event behavior is explicit, bounded, observable, and cannot stall unrelated valid evidence indefinitely.
- [x] PostgreSQL retains source, producer/parser version, occurrence/receipt time, payload, identity hints, redaction state, delivering device, and stable deduplication evidence.
- [x] Projection can later be replayed without mutating the retained source observation.

**Completion note:** Basic verification passed with `pnpm test` (23 adapter/server/relay tests), `pnpm typecheck`, `pnpm build`, and `git diff --check`. The implementation proves record-before-network capture, SQLite restart/transient retry, acknowledgement-only deletion, duplicate/lost-ack idempotency, conflict/out-of-order handling, poison isolation, and append-only PostgreSQL source evidence. Capability limits remain explicit: rich OTel projection belongs to later projection work, unsupported rollout parsing is rejected, poisoned-row repair tooling is deferred, and Node SQLite remains experimental.
