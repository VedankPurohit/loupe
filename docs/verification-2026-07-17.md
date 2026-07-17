# Independent verification pass — 2026-07-17 evening

Scope: full review, test execution, live end-to-end run, and targeted fixes of the
implemented system, performed independently of the implementation agents.
Baseline commit: `0f8c536`; fixes land as the four commits that follow it.

## What was verified working

- **Static and unit health.** Workspace typecheck clean across all nine packages.
  Agent-adapter, server (19 files), and relay (8 files) Vitest suites pass; the
  3-test Playwright suite passes.
- **Live native flow.** Fresh PostgreSQL database → migrations → Fastify server →
  single-use Bootstrap redemption (reuse correctly rejected with
  `BOOTSTRAP_CODE_ALREADY_REDEEMED`) → authenticated browser session.
- **Device enrollment.** Grant creation → single-use grant redemption → revocable
  Device credential with correct policy payload.
- **Real capture chain.** Seven lifecycle hook events (SessionStart, prompt,
  tool pre/post, subagent start/stop, Stop) recorded through the relay `hook`
  entry point into SQLite, delivered by the relay loop, persisted append-only in
  PostgreSQL, and projected into a Session with one Turn, a Root agent run, and a
  Subagent run whose parent edge is labelled `inferred` with reconciliation
  evidence — no fabricated exactness.
- **Credential separation.** A Device credential querying `/api/v1/sessions`
  is rejected with `DEVICE_CREDENTIAL_SCOPE_FORBIDDEN`.
- **Diagnostic CLI.** Renders the projected session with honest evidence-strength
  labels (`unavailable` fields stay `unavailable`; completion `not_assumed`).

## Defects found and fixed (each with a test, each committed separately)

1. **Redaction coverage was two rules deep.** Default "high-confidence secret
   redaction" matched only OpenAI `sk-` keys and GitHub tokens. A live e2e probe
   proved a canonical AWS access key ID persisted in plaintext into
   `source_events.raw_payload`. Added high-confidence rules for AWS access key
   IDs, Slack tokens, Google API keys, Stripe secret keys, GitLab PATs, npm
   tokens, and PEM private-key blocks, plus near-miss negative tests. Re-ran the
   live chain: secrets now stored as placeholders with keyed fingerprints.
2. **Standard-sync treated a per-turn `Stop` hook as session completion**
   (deleting the session from `local_active_sessions`), so a mandatory
   Organization-standard install could fire between turns of a live resumable
   session — explicitly forbidden by the spec. Liveness now expires only through
   the bounded idle window (or an explicit `SessionEnd`); setup verification
   closes its own synthetic session explicitly. Deferral test extended to cover
   the between-turns window.
3. **Raw fetch errors leaked into user-facing copy** ("… failed. Failed to fetch
   Check the connection …") in `App.tsx` and `SessionInspector.tsx`; an e2e test
   had been adjusted to assert the garbled string. Network failures are now
   normalized to "The server could not be reached." with proper punctuation; the
   e2e assertion restored to the human-readable message. Also extended the UI's
   known redaction-placeholder list to the new rules.
4. **Contract/schema gaps.** `projectionVersion` was pinned to `z.literal("1")`
   in the response contract while the database and spec anticipate named
   reprojection versions — unpinned to a bounded string. Added missing hot-path
   indexes: sessions by (org, owner member, last observed) and annotations by
   (org, outcome) and (org, review status) — migration `0013`.

## Known issues left open (deliberate)

- **E2E coverage is thin**: three Playwright tests; ticket 12's journey list
  (search, comparison, annotations, hierarchy navigation, invite redemption) has
  unit coverage but no browser-level tests.
- **Annotation permission ambiguity**: the server restricts outcome/review/tag
  annotation to the owner or an Administrator; one spec passage says any member
  may annotate. Needs a product decision, not a code fix.
- **Migration 0000 emits a PostgreSQL identifier-truncation notice** (>63-char
  name); harmless today, worth renaming in a future migration.
- **No real-Codex probe was run in this pass** (capture was exercised through
  the relay's own hook entry point with realistic payloads). The target-version
  probe fixtures from ticket 03 remain the evidence for real-Codex behavior.
- A concurrent implementation agent was mid-edit in `execution-store.ts`,
  `CandidateStandards.tsx`, and related tests during this pass; those changes
  are theirs and remain uncommitted by this verification.
