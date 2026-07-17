# Evidence Workbench — ticket 11 prototype direction

> Throwaway UI prototype. This is one investigation direction to evaluate, not production UI.

## Prototype question

Can a high-density operations console move a Coach from Organization activity to the exact failed Tool invocation in one real Session quickly, while keeping evidence strength, unavailable facts, Agent parentage, Token/Context evidence, and comparisons visible?

This ticket slice intentionally implements one commissioned direction: a Session ledger beside a synchronized chronological trace and hierarchical Agent tree, with an exact-evidence drawer and a cross-Session comparison bench.

## Run

Start the real backend at `http://127.0.0.1:3000` and establish the normal `browser_session` cookie. Then:

From the repository root:

```bash
pnpm prototype:console
```

Open `http://127.0.0.1:5183`. The default mode uses the real versioned backend through Vite's same-origin `/api` proxy and sends authenticated cookies. To use another backend, set `VITE_API_BASE_URL` before starting Vite or enter the base URL in the connection control.

```bash
VITE_API_BASE_URL=http://127.0.0.1:3000 pnpm prototype:console
```

The deterministic edge fixture is opt-in at `http://127.0.0.1:5183/?mode=edge` or through the visibly labelled **Edge fixture** control. It includes one exact failed Tool, inferred and unresolved Agent parentage, unavailable evidence, Context estimates, and a descriptive comparison. It never presents itself as captured data.

## Central journey

1. Search or facet the Organization Session ledger.
2. Activate a Session id (native buttons make the table keyboard-operable).
3. Choose **Reveal exact failed Tool**, or traverse the synchronized Activity trace and Agent hierarchy.
4. Inspect the separate hook Tool-use id, OTel call id, input, result, Turn association, evidence classification, and coverage gaps.
5. Move between Tool, Token, Context, and error panels, or select two ledger rows for the comparison bench.

Keyboard support: `/` focuses search, `Tab` traverses controls and evidence events, `Enter` activates them, and `Escape` clears Agent/Tool focus. Visible focus is preserved, reduced-motion preferences are respected, and the layout stacks below tablet width.

## Real API contract used

- `GET /api/v1/organization/activity` for full-text and structured discovery.
- `GET /api/v1/sessions/:id` for timeline, Agent hierarchy, Tools, lifecycle, Token, Context, cost, and capability evidence.
- `POST /api/v1/comparisons` for descriptive evidence comparisons and stable refusals.

All requests use `credentials: "include"`. The prototype does not invent productivity scores, infer permanent Session completion, turn unavailable evidence into zero, or fabricate parent edges.

## Focused verification

```bash
pnpm --filter @workspace/prototype-console test
pnpm --filter @workspace/prototype-console typecheck
pnpm --filter @workspace/prototype-console build
```

The behavior test exercises the public UI seam: Organization activity → Session → exact failed Tool evidence.

## Evaluation and tradeoffs

| Criterion | Read | Tradeoff |
| --- | --- | --- |
| Investigation speed | Strong | A dedicated failure jump and synchronized selection shorten the critical journey. |
| Information density | Strong | The console keeps the evidence chain in one viewport, but first-time users must learn the visual grammar. |
| Accessibility | Viable prototype | Native controls, visible focus, text labels, and reduced motion work; dense tables and the narrow utility type need broader usability testing. |
| Responsive behavior | Deliberate | Evidence moves below the trace on medium screens and all regions stack on mobile; the desktop workbench remains the primary experience. |
| Implementation cost | Medium-high | Timeline/tree synchronization and compact evidence formatting require more product code than a conventional detail page. |
| Demo clarity | Strong | The coral failure trace and exact evidence drawer make the evidence chain legible without exposing raw telemetry. |

Deliberate constraints: no inferred composition chart, no productivity ranking, no real mutation, and no live SSE subscription in this slice. Real mode refreshes when the query runs. The textual tree is less spectacular than a free-form graph, but it preserves unresolved and inferred parentage without implying certainty.
