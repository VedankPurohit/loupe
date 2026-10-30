# 05 — Project and inspect live execution

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** A real accepted Codex Session becomes a canonical, resumable history with Activity episodes, Turns, Root and Subagent runs, evidence-strength labels, live updates, a diagnostic CLI view, and a deliberately plain but testable browser inspector.

**Blocked by:** 04 — Build the Codex adapter and deliver events reliably.

**Status:** complete

**Documentation impact:** Document the canonical identities, entity relationships, projection/replay rules, reconciliation rules, Activity states, SSE contract, and unresolved-parent representation.

**Testing plan:** Ingest versioned adapter fixtures through `/api/v1` and assert only through query endpoints, SSE, the spawned diagnostic CLI, and the browser. The first red test turns one real source batch into a queryable Session and Turn with a single Root agent run.

- [x] Each Session has one Root agent run, canonical hook Turn identities, and supported Subagent runs without collapsing tree-wide and per-thread identifiers.
- [x] Unsupported parentage remains unresolved and visually/API-distinct from exact or inferred edges.
- [x] Resume creates a new Activity episode within the same durable Session; silence and root Stop never imply permanent completion.
- [x] Conflicting observations retain reconciliation inputs, rule, selected value where defensible, and confidence instead of silent precedence.
- [x] Authenticated SSE updates a plain browser inspector without refresh and recovers through an ordinary query after disconnect.
- [x] A diagnostic CLI can inspect the same real Session through `/api/v1`; neither UI nor CLI reads PostgreSQL directly.

**Completion note:** The lightweight tickets-02/04/05 integration pass succeeded with `pnpm test` (adapter, 21 server, and relay tests), seven-workspace `pnpm typecheck` and `pnpm build`, `pnpm test:e2e` (2 journeys), the diagnostic CLI test/help command, and real-socket authenticated SSE recovery. Real `0.144.5` fixtures travel through delivery and PostgreSQL projection to authenticated `/api/v1` queries. Exact recursive parentage remains explicitly observed/unstable for the target producer; ambiguous hook-only edges stay unresolved.
