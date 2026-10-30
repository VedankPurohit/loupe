# 13 — Deliver agent-driven analysis and Candidate submission

**Type:** implementation

**Required skills:** `implement`, `tdd`, `skill-creator`

**What to build:** A person or Organization-analysis agent can use a revocable Analysis credential and companion Analysis skill to search, inspect, watch, compare, cite, and submit a complete versioned Candidate skill without gaining evidence-mutation or approval authority.

**Blocked by:** 09 — Deliver Organization discovery and search; 10 — Compare Sessions and enforce evidence standards.

**Status:** complete

**Documentation impact:** Document Analysis-credential creation/revocation, CLI commands, structured schemas, pagination, errors, evidence rules, Candidate package requirements, and companion-skill usage.

**Testing plan:** Spawn the real CLI against a real test server and validate the Analysis skill with scripted evidence scenarios. The first red test searches real Sessions in structured output, follows one citation, and proves the credential cannot change annotations or approve a Candidate.

- [x] CLI output supports human and stable structured modes, explicit pagination, stable identifiers/errors, deep links, and synthetic/fidelity metadata.
- [x] The Analysis credential can read permitted Organization evidence and submit Candidate skills but cannot mutate captured evidence, approve, publish, pause, roll back, or use Device ingestion.
- [x] The Analysis skill requires CLI-backed evidence, navigable citations, uncertainty, synthetic exclusions, and the two-real-Turn rule for Repeated patterns.
- [x] Candidate submission contains a complete installable skill package, immutable version, reviewer context, uncertainty, Evidence citations for every factual claim, and artifact hash.
- [x] Invalid, uncited, incomplete, or prose-only Candidates are rejected through stable contract errors.
- [x] Revoked credentials fail predictably without affecting already retained evidence or Candidate history.

**Completion note:** Basic verification passed with seven real-PostgreSQL/spawned-CLI server tests, three diagnostic-CLI/Analysis-skill scenario tests, workspace `pnpm typecheck` and `pnpm build`, companion-skill `quick_validate.py`, and `git diff --check`. Analysis credentials retain read/submit-only authority; Candidate skill versions are complete, immutable, hash-bound, cited, and preserve history after credential revocation. Dedicated spawned coverage for `watch` and credential-management CLI commands remains a later regression-hardening opportunity.
