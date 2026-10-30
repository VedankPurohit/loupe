# 07 — Support real Members, ownership, and Git context

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** Administrators can invite real Members, every new Session receives server-authoritative historical ownership from its Enrolled device, and captured work includes locally observed, sanitized Git context when available.

**Blocked by:** 01 — Establish the runnable product and Organization bootstrap; 05 — Project and inspect live execution.

**Status:** complete

**Documentation impact:** Document Invite-code behavior, Member/Administrator roles, ownership invariants, device reassignment, Git sampling/provenance, remote sanitization, and unavailable states.

**Testing plan:** Exercise invitations and ownership through `/api/v1` and Git enrichment through the relay's public enrichment interface. The first red test proves an invited Member's enrolled device creates an owned Session and that later device reassignment does not change its owner.

- [x] An Administrator can issue a revocable or expiring single-use Invite code that creates an ordinary Member and browser session.
- [x] Client-supplied ownership is ignored; the server assigns ownership from the Device credential on first acceptance.
- [x] Disconnect, rename, revocation, or re-enrollment cannot rewrite historical Session ownership.
- [x] Delivery through a different Device credential retains the original owner and creates reconciliation evidence.
- [x] Git enrichment records repository root, sanitized remote identity, branch or detached state, worktree, commit, sample time, and local-observation provenance when available.
- [x] Non-repositories, inspection failure, and credential-bearing remotes are handled without fabricating Git state or leaking credentials.

**Completion note:** Basic verification passed with workspace `pnpm typecheck` and `pnpm build`, four real-PostgreSQL Member/ownership/projection tests, three relay Git-enrichment/delivery regressions, and `git diff --check`. Invite codes are expiring single-use verifier-only secrets; Git context is a sampled local observation with sanitized remotes and explicit unavailable/failure states. Full Playwright coverage is deferred to the next batch pass.
