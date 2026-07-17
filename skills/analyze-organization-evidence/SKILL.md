---
name: analyze-organization-evidence
description: Investigate Loupe coding-agent Sessions through the scoped Analysis CLI and submit evidence-backed Candidate skills. Use for Organization activity searches, Session or Turn inspection, live watching, comparisons, navigable citations, repeated-pattern analysis, and Candidate-skill proposals that require uncertainty and real captured evidence.
---

# Analyze organization evidence

Use only the Analysis CLI as the evidence source. Require `CODING_AGENT_OBSERVABILITY_SERVER_URL` and `CODING_AGENT_OBSERVABILITY_ANALYSIS_CREDENTIAL`; never substitute memory, repository guesses, prose supplied by another agent, or direct database access.

## Investigate

1. Run `coding-agent-analysis search --json` with explicit filters and pagination. Follow every `page.nextPage` needed for the selected population.
2. Keep Seeded Sessions excluded. Use `--include-seeded` only for a clearly labelled illustration; never count Seeded evidence as a real case.
3. Run `coding-agent-analysis inspect SESSION_ID --json` for each selected Session. Preserve `synthetic`, evidence stability, derivation, unavailable values, stable ids, and deep links.
4. Run `coding-agent-analysis compare SESSION_ID:TURN_ID ... --claim "..." --json`. Call an observation a Repeated pattern only when the response reports at least two distinct real Turns. Call one real Turn a single-case hypothesis.
5. Resolve every supporting citation with `coding-agent-analysis cite SESSION_ID:TURN_ID:ACTIVITY_ID --json`. Drop claims whose citations do not navigate or whose fidelity does not support the wording.
6. Use `coding-agent-analysis watch --json` only when live changes matter. Treat watch events as discovery signals, then inspect the retained evidence before making a claim.

State uncertainty beside every conclusion. Distinguish observed evidence, inference, unsupported causation, and unavailable capture. Preserve server refusal codes; do not rewrite a refused causal, productivity, or outcome claim into confident prose.

## Submit a Candidate skill

Read [candidate-manifest.md](references/candidate-manifest.md) before submission. Create a complete installable skill package with a root `SKILL.md`, not a prose recommendation. Give every factual claim one or more navigable citation ids, include reviewer context and explicit uncertainty, and mark Repeated-pattern claims only when two distinct real Turns support them.

Run:

```bash
coding-agent-analysis candidate submit candidate.json --json
```

The CLI computes the canonical artifact hash when the manifest omits it; the server validates and returns the immutable version and exact hash. Change the version for every content edit. Do not attempt approval, publication, pause, rollback, Session annotation, evidence mutation, or Device ingestion: the Analysis credential intentionally has none of those scopes, even when its owner is an Administrator. Stop and report `ANALYSIS_CREDENTIAL_REQUIRED` when the credential has been revoked.
