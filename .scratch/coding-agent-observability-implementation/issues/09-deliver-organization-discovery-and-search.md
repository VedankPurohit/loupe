# 09 — Deliver Organization discovery and search

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** Organization members can discover live and historical work through real activity, Member and repository views, structured/full-text search, lightweight Session annotations, and explicitly loaded Seeded examples that never contaminate real evidence by default.

**Blocked by:** 07 — Support real Members, ownership, and Git context; 08 — Explain tools, lifecycle, Token, Context, and cost.

**Status:** complete

**Documentation impact:** Document query filters, pagination, aggregate definitions, Activity-state derivation, annotations, Example-pack import, synthetic defaults, and stable errors/deep links.

**Testing plan:** Use `/api/v1` as the primary seam with real PostgreSQL search behavior and a plain browser/CLI test surface. The first red test finds one real Session by Member and repository while excluding one matching Seeded session from results and aggregates by default.

- [x] Organization activity queries expose live/recent Sessions, owners, repositories, derived states, and descriptive aggregate signals without productivity rankings.
- [x] Structured and full-text search support stable identifiers, explicit pagination, time, Member, repository, annotation, model/tool/capability evidence, and captured errors where available.
- [x] Session owners and Administrators can assign successful/partial/failed/unknown outcome, exemplar/needs-help/ordinary review status, and free-form tags.
- [x] An explicit Administrator CLI command and equivalent UI action load a versioned Example data pack idempotently through a server-controlled path.
- [x] Example members and Seeded sessions are irreversibly designated across storage, API, browser, CLI, citations, comparisons, and aggregates.
- [x] Seeded data is excluded from real aggregates and search defaults unless explicitly included, with inclusion visible in the response.

**Completion note:** Basic verification passed with two discovery/annotation/Example-pack tests on disposable PostgreSQL, ownership and live-execution regressions, a spawned diagnostic-CLI regression, workspace `pnpm typecheck` and `pnpm build`, and `git diff --check`. `starter-v1` import is explicit, Administrator-only, server-controlled, idempotent, and permanently labels Example members and Seeded Sessions. Playwright/full-suite validation is deferred to the next batch pass.
