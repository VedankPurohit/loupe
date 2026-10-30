# 10 — Compare Sessions and enforce evidence standards

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** A Coach can compare selected real Sessions or Turns, cite the exact supporting evidence, distinguish a single-case hypothesis from a Repeated pattern, and receive explicit refusal language when the available evidence cannot support productivity or causal claims.

**Blocked by:** 09 — Deliver Organization discovery and search.

**Status:** complete

**Documentation impact:** Document comparison populations, completeness metadata, Evidence-citation links, the two-real-Turn rule, synthetic exclusions, and unsupported-claim language.

**Testing plan:** Exercise comparisons and citations only through `/api/v1`. The first red test compares two real Turns and returns navigable citations, while the same claim backed by one real Turn remains a single-case hypothesis.

- [x] A comparison names its selected Sessions/Turns, filters, population, evidence completeness, and synthetic inclusion state.
- [x] Evidence citations resolve to stable, authorized Session/Turn/activity deep links.
- [x] A Repeated pattern requires at least two distinct real Turns; one real case is labelled a single-case hypothesis.
- [x] Seeded sessions cannot satisfy real-evidence requirements even when explicitly included for illustration.
- [x] Token use, cost, duration, tool count, model choice, and correlation alone never become productivity or causal conclusions.
- [x] The API returns stable refusal reasons when outcome or causal evidence is insufficient.

**Completion note:** Basic verification passed with four comparison/discovery real-PostgreSQL tests, two spawned diagnostic-CLI tests, contracts/server/web/CLI typechecks, a full workspace build, and `git diff --check`. Comparisons carry population/filter/completeness/synthetic metadata and authorized deep citations; Seeded evidence remains illustrative, while one and two distinct real Turns produce hypothesis and Repeated-pattern classifications respectively. Stable refusal codes prevent productivity or causal claims from metric/correlation evidence alone.
