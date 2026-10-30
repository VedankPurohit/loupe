# 08 — Explain tools, lifecycle, Token, Context, and cost

**Type:** implementation with validation gates

**Required skills:** `implement`, `tdd`, `openai-docs`

**What to build:** A Session investigator can follow supported tool and lifecycle evidence and understand Token progression, Context limits and inferred occupancy, first-request baseline, and versioned estimated cost without mistaking missing or inferred data for exact observations.

**Blocked by:** 03 — Probe the target-version Codex capture contract; 05 — Project and inspect live execution.

**Status:** complete

**Documentation impact:** Update the Capture capability matrix and document tool coverage, lifecycle semantics, Token categories, Context calculations, cost price-table versioning, skill/MCP limitations, and refusal language.

**Testing plan:** Use `/api/v1` plus the Agent-adapter seam with independent worked examples for Token/Context/cost expectations. The first red test ingests one provider completion and returns its separate Token categories without calling cumulative usage Context occupancy.

- [x] Supported tools show input/result evidence, duration, success/failure, approval, retries, identifiers, and coverage gaps without treating a missing hook as no activity.
- [x] Compaction trigger/timing, resume, fork evidence, explicit/inferred skill evidence, configured/used MCP evidence, and unavailable capabilities are distinguishable.
- [x] Provider-reported input, cached input, output, reasoning, and total Token categories remain separate with defensible Turn association.
- [x] Context limits, inferred occupancy, first-request baseline, and estimated contribution name their method, inputs, missing assumptions, and evidence strength.
- [x] Cost is always an estimate with currency, effective date, price-table version, model mapping, inputs, and billing caveat.
- [x] Unsupported composition or cost claims are omitted or shown unavailable rather than populated with guesses.

**Completion note:** Basic verification passed with three adapter evidence tests, four focused real-PostgreSQL `/api/v1` projection tests, workspace `pnpm typecheck` and `pnpm build`, and `git diff --check`. Provider Token categories, association strength, inferred Context occupancy/baseline, evidence-labelled tools/lifecycle/Skill/MCP data, and versioned cost estimates are exposed without unsupported charts. Cost for `gpt-5.6-sol` remains unavailable until an explicit price-table mapping is supplied; exact Context composition/contribution, implicit Skill activation, complete passive capability inventory, and stable log-only Turn association remain unavailable.
