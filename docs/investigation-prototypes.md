# Investigation interface prototypes

Ticket 11 asks one question: which interaction model best helps a developer or Coach move from Organization activity to the exact failed Tool invocation in a real Session, without reading raw telemetry or weakening evidence fidelity?

Three throwaway React/Vite applications answer that question differently. They are comparison material for the user-selection gate before ticket 12; this document intentionally does not select a winner.

## Run the prototypes

All three apps are pnpm workspace packages. Start the PostgreSQL-backed server on `http://127.0.0.1:3000`, sign in through the production web app on `http://127.0.0.1:5173` so the browser has its HttpOnly `browser_session` cookie, then start one or more prototypes from the repository root:

```bash
pnpm prototype:map       # http://127.0.0.1:5174
pnpm prototype:notebook  # http://127.0.0.1:5181
pnpm prototype:console   # http://127.0.0.1:5183
```

The ports do not conflict with the production web app or one another. Each prototype defaults to authenticated, real `/api/v1` evidence through Vite's same-origin proxy. Deterministic edge fixtures are explicit opt-ins and remain visibly labelled:

- Execution map: `http://127.0.0.1:5174/?fixture=edge` displays `EDGE FIXTURE MODE` and labels the included Example Session as `Seeded`.
- Evidence notebook: `http://127.0.0.1:5181/?fixture=edge` displays a persistent `Deterministic edge fixture mode` banner and a link back to real evidence.
- Evidence workbench: `http://127.0.0.1:5183/?mode=edge` displays `DETERMINISTIC EDGE FIXTURE · NOT LIVE DATA` plus a fixture ribbon and a Real API switch.

Fixture results are UI evaluation material, not captured Organization evidence. The normal URLs above never activate fixture data.

## Direction comparison

| Criterion | Evidence workbench | Execution map | Evidence notebook |
| --- | --- | --- | --- |
| Investigation speed | Fastest direct triage path: ledger → Session → `Reveal exact failed Tool`, with synchronized trace and drawer. | Fast for branch-heavy runs: Session rail → route topology → `F` to the earliest failed Tool. Spatial scanning may slow very long runs without clustering. | Fast for a known failure: open case → `Jump to first failure`. Broad scanning takes longer than the workbench. |
| Information density | Highest. Organization, chronology, Agent hierarchy, evidence, errors, Token/Context, and comparison can coexist in one desktop viewport. | Medium-high. Topology is primary and detail stays in the inspector; the map spends space on causality rather than rows. | Medium-high. Chronology remains readable while provenance collapses into footnotes and comparison moves to the margin. |
| Accessibility | Native controls, visible focus, text evidence labels, `/` and Escape shortcuts, reduced-motion handling. Risk: small utility type and dense tables need high-zoom and screen-reader testing. | Keyboard route covers search, Session movement, failure jump, scanline, and controls. Exact/inferred/unavailable also have text labels. Risk: production zoom/pan and large-graph semantics need dedicated testing. | Strong semantic baseline: buttons, labels, `details` footnotes, status regions, linear reading order, visible focus. Risk: identifier-heavy footnotes, sticky navigation, and focus after smooth scrolling need Safari/VoiceOver testing. |
| Responsive behavior | Three panes collapse progressively; evidence moves under the trace and regions stack on mobile. Desktop remains the intended high-density surface. | Inspector becomes a sheet and the map remains horizontally navigable. Narrow screens preserve the concept but are less efficient for topology work. | Casebook moves above the notebook, chapters remain linear, and margin notes follow the evidence. Most naturally responsive of the three. |
| Implementation cost | Medium-high: synchronized selection, dense formatting, table behavior, and pane state. | Highest: graph layout, clustering, zoom/pan accessibility, virtualization, and scanline behavior for large Sessions. | Moderate: mostly semantic HTML/CSS and conventional state; no graph engine or complex pane synchronization. |
| Demo clarity | Strong forensic story: isolate the failed row and expose exact evidence immediately. Visually dense on first viewing. | Strongest visual signature: delegation and failure location appear as a causal transit map. Requires a brief legend explanation. | Strong guided story: open a case, read chapters, land on the failed Tool, then compare evidence. Less visually spectacular but easy to narrate. |
| API fidelity | Real `/api/v1` is the default and requests include cookies. It calls activity, Session detail, and comparison endpoints. Risk: the prototype currently carries local TypeScript response shapes, so ticket 12 should use `@workspace/contracts` directly. | Imports `OrganizationActivityResponse`, `ExecutionSessionDetail`, comparison request/response types from `@workspace/contracts`; also listens to `/api/v1/live`. Fixture mode is isolated and labelled. | Imports the same shared contract types, uses real activity/detail/comparison endpoints, and listens to `/api/v1/live`. Fixture mode is isolated and labelled. |

## Strengths and risks

### Evidence workbench

Strengths: quickest dense triage; failure, Tool identifiers, Agent parentage, evidence classification, Token/Context, search, and comparison stay close together. The interaction resembles an observability console and supports expert repeated use.

Risks: the density may overwhelm first-time users; the desktop layout and narrow typography require accessibility testing; synchronized panes increase production implementation and state-management cost. Its local response types are a prototype shortcut rather than the preferred shared-contract boundary.

### Execution map

Strengths: makes delegation, chronology, inferred parentage, and failure location visually memorable. Keyboard shortcuts make the central journey unusually fast, and the evidence inspector prevents the graph from becoming a raw-telemetry view.

Risks: large Sessions will require clustering, virtualization, zoom/pan behavior, and an accessible non-spatial representation. Topology can consume space that a Coach may prefer for detailed evidence. The scanline and map legend add concepts the demo must explain.

### Evidence notebook

Strengths: most guided reading experience; semantic structure, evidence footnotes, inline Agent branches, and the explicit failure jump keep provenance available without dominating the diagnosis. It has the lowest likely production complexity and the clearest mobile reading order.

Risks: slower for broad Organization scanning and high-volume triage; topology is secondary; long Sessions could become lengthy documents. Dense provenance text and programmatic focus after scrolling need assistive-technology testing.

## Screenshot checklist

Capture both the real default and the clearly labelled fixture boundary. Do not use fixture screenshots as proof of captured evidence.

- [ ] Real Organization activity is visible after authenticating through the production web app.
- [ ] The same real failed Session is opened in all three directions when available.
- [ ] The exact failed Tool is selected, including input/result, outcome, Turn association, and provenance/fidelity label.
- [ ] Agent hierarchy or branches show exact, inferred, and unresolved parentage honestly where the API supplies it.
- [ ] Token usage and Context occupancy are visible; unavailable Context contribution or cost remains labelled unavailable, never zero.
- [ ] Search and comparison are visible, including any stable refusal/caveat text.
- [ ] One desktop screenshot per direction captures its signature interaction.
- [ ] One narrow viewport screenshot per direction captures responsive behavior.
- [ ] One keyboard-focus screenshot per direction shows a visible focus indicator on the central journey.
- [ ] One fixture screenshot per direction includes the complete fixture banner; the map screenshot also shows its `Seeded` Example label.

## User-selection framing

Choose based on the investigation behavior to optimize:

- Evidence workbench if expert triage speed and maximum simultaneous evidence density matter most.
- Execution map if Agent topology and a memorable causal demonstration matter most.
- Evidence notebook if guided comprehension, accessibility foundations, responsive reading, and lower implementation cost matter most.

Hybrid details can be carried into ticket 12 after the primary interaction model is chosen, but selecting a primary direction first avoids rebuilding three competing information architectures in production.

## Selected direction

**Execution map** is the production direction for ticket 12. It best expresses the product's distinctive promise—understanding Root and Subagent topology, causal activity, and the exact location of a failure—and gives the Build Week demonstration a memorable visual signature.

Ticket 12 should retain two proven supporting patterns without changing the map-first interaction model:

- the Evidence workbench's compact evidence drawer and fast exact-Tool triage;
- the Evidence notebook's semantic provenance footnotes, linear responsive fallback, and guided failure jump.

Production implementation must use `@workspace/contracts`, provide an accessible non-spatial representation alongside the map, and defer large-graph clustering/virtualization until measured need appears.
