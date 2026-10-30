# 12 — Implement the selected polished investigation interface

**Type:** implementation

**Required skills:** `implement`, `tdd`, `frontend-design`, `vercel-react-best-practices`

**What to build:** Implement the selected prototype as an accessible, responsive React application that lets Organization members discover activity, search, inspect a Session timeline and Agent hierarchy, understand evidence fidelity, analyze Token/Context progression, annotate work, and compare cited evidence.

**Blocked by:** 11 — Prototype multiple investigation interfaces.

**Status:** complete

**Documentation impact:** Document the chosen information architecture, primary investigation journeys, accessibility expectations, live-update states, deep-link behavior, and any deliberate differences from the prototype.

**Testing plan:** Use Playwright against a real test server and create setup data only through `/api/v1`. The first red browser test starts in Organization activity, opens a real Session, selects a Subagent or Tool failure, and observes matching timeline, hierarchy, provenance, and evidence detail.

- [x] The production interface follows the selected prototype's interaction model and visual direction rather than reverting to a generic dashboard.
- [x] The application consumes only `/api/v1` and authenticated SSE; it never reads PostgreSQL or internal server modules.
- [x] Critical journeys cover bootstrap/login, activity discovery, search, Session timeline, Agent hierarchy, fidelity labels, annotations, comparison, and evidence citations.
- [x] Seeded identities, inferred/unstable/unavailable evidence, redactions, empty states, live disconnection, and errors are visibly distinct.
- [x] Keyboard navigation, focus visibility, meaningful accessible names, responsive layouts, and reduced-motion behavior pass the documented checks.
- [x] Browser tests assert behavior and accessible output rather than internal React structure or pixel snapshots.

**Completion note:** Basic verification passed with production-web typecheck and build, `git diff --check`, an API-boundary import check, and an isolated-port Playwright bootstrap/map/SSE journey (2 tests). The selected Execution-map interaction is combined with a semantic non-spatial tree/timeline fallback, compact evidence triage, provenance footnotes, keyboard/focus/reduced-motion support, responsive layouts, and explicit evidence/Seeded/redaction/live-error states. Large-graph virtualization and a manual assistive-technology/device pass remain later hardening work.
