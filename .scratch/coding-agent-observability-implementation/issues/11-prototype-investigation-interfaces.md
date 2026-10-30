# 11 — Prototype multiple investigation interfaces

**Type:** prototype

**Required skills:** `prototype`, `design-an-interface`, `frontend-design`

**What to build:** Create multiple substantially different, working interface prototypes against the real backend, evaluate how each helps a developer or Coach understand Organization activity and one complex Session, and record one selected direction before production UI implementation begins.

**Blocked by:** 08 — Explain tools, lifecycle, Token, Context, and cost; 09 — Deliver Organization discovery and search; 10 — Compare Sessions and enforce evidence standards.

**Status:** complete

**Documentation impact:** Record the prototype question, at least three visual/interaction directions, evaluation criteria, usability findings, accessibility risks, rejected tradeoffs, and selected direction.

**Testing plan:** Use real `/api/v1` data plus clearly labelled deterministic edge fixtures. Each prototype must be keyboard-operable enough to exercise its central interaction. The first failing scenario asks a user to move from Organization activity to the exact failed Tool invocation in a real Session without reading raw telemetry.

- [x] The `prototype` skill is used explicitly before production UI code is committed.
- [x] At least three genuinely different working directions are produced; palette-only variations or static wireframes do not count.
- [x] Every direction covers Organization activity, Session discovery, timeline, Agent hierarchy, provenance/fidelity, Token/Context evidence, errors, search, and comparison.
- [x] The prototypes use the versioned backend rather than a parallel UI-only domain model; synthetic edge cases are visibly labelled.
- [x] Each direction is evaluated for investigation speed, information density, accessibility, responsive behavior, implementation cost, and demo clarity.
- [x] One direction is selected with a concise rationale and enough interaction detail for an implementation agent to build without reopening the entire design question.

**Completion note:** Three working real-API-default directions—Evidence workbench, Execution map, and Evidence notebook—each pass a focused behavior test, typecheck, and production build. Fixture modes are explicit and visibly labelled. The selected production direction is the Execution map, carrying forward the workbench's compact evidence triage and the notebook's semantic responsive fallback.
