# 03 — Probe the target-version Codex capture contract

**Type:** prototype

**Required skills:** `prototype`, `openai-docs`, `tdd`

**What to build:** Run a real target-version Codex probe on macOS and turn the observed OTel, hook, and permitted compatibility evidence into sanitized producer-versioned fixtures, a Capture capability matrix, and contract decisions that declare exactly what is documented, observed, inferred, unstable, or unavailable. This ticket proves the source behavior; production Agent-adapter implementation belongs to ticket 04.

**Blocked by:** None — can start immediately in parallel with ticket 01; no server, authentication, or device enrollment is required for the local probe.

**Status:** complete

**Documentation impact:** Publish the target-version Capture capability matrix, producer versions, probe procedure, observed payload keys, downgrade rules, and known limitations.

**Testing plan:** Treat the target Codex process and its locally captured outputs as the validation seam. Begin with a written failing capability assertion for one documented hook Session/Turn identity, run the smallest real probe that can confirm or downgrade it, then preserve the sanitized payload as a producer-versioned fixture for the Agent-adapter contract tests implemented in ticket 04.

- [x] The real probe covers two Turns, supported tool success and failure, an approval where feasible, MCP use, explicit and implicit skill scenarios, compaction, resume, fork, a child, and a grandchild where supported.
- [x] OTel logs, OTel traces, and lifecycle hooks are captured without copying live sensitive content into fixtures.
- [x] Session identity, Agent-run identity, Turn identity, tool identifiers, trace association, and direct/nested parentage findings are versioned and reproducible.
- [x] Sanitized fixtures preserve payload structure, identity relationships, and unknown fields without copying live sensitive content.
- [x] The resulting contract defines the canonical observations, raw-preservation obligations, provenance, evidence-strength metadata, and downgrade behavior that ticket 04 must implement.
- [x] Negative or ambiguous probe results reduce the declared capability instead of introducing timestamp guesses or fabricated relationships.
- [x] Rollout, transcript, app-server, or local-state evidence remains explicitly version-gated and cannot masquerade as the stable passive baseline.

**Completion note:** Verified against isolated `codex-cli 0.144.5` with `python3 -m unittest -v tests/probe/test_codex_0144_5_contract.py` (10 assertions), JSON/syntax/help checks, manifest integrity, leak scans, and raw-capture cleanup. Sanitized evidence covers hooks, OTel logs/traces, response-to-nearest-Turn ancestry, MCP, compaction, approval, user fork lineage, and root-to-grandchild activity. Documented downgrades remain for implicit skill activation, logical model-request identity, complete passive capability snapshots, provider cost, uniform tool-failure interpretation, and stable parentage/fork surfaces.
