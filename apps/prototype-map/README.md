# Execution-map investigation prototype

> Throwaway UI prototype. The question is: **Can a spatial execution map help a developer move from Organization activity to the exact failed Tool faster than a dense inspector?**

This is the execution-map-first direction for ticket 11. It is intentionally one opinionated prototype, not production UI and not a variant switcher. The map treats Agent runs as routes, parentage as track joins, and causal activity as evidence stops. The main route through the prototype is:

1. Search or move through Organization Sessions.
2. Read root/Subagent topology on the map.
3. Press `F` from the selected Session or activity to land on the earliest exact failed Tool target.
4. Read Tool input, result, association strength, coverage gaps, Tokens, and Context from the side inspector—without opening raw telemetry.

## Run it

From the repository root:

```bash
pnpm prototype:map
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). The default mode uses the real, authenticated backend through Vite's proxy and sends browser cookies on every request. Authenticate through the main web application first if the browser does not already have a session cookie.

For deterministic edge cases only, open [http://127.0.0.1:5174/?fixture=edge](http://127.0.0.1:5174/?fixture=edge). The fixture mode is visibly labelled in the masthead and warning banner, and it never activates by default.

## Real contracts used

- `GET /api/v1/organization/activity` for search, Organization mini-map, aggregates, and Session discovery.
- `GET /api/v1/sessions/:id` for timeline, Agent hierarchy, tools, Tokens, Context, lifecycle, and fidelity evidence.
- `GET /api/v1/live` for `session.updated` refreshes.
- `POST /api/v1/comparisons` for the comparison tray.

The UI imports the versioned contract types from `@workspace/contracts`; it does not introduce a parallel Session model.

## Keyboard route

- `/` focuses Organization search.
- `J` / `K` moves between Sessions.
- `F` follows the selected activity to the earliest failed Tool invocation.
- `←` / `→` moves the time scanline.
- Tab and Enter operate every Session, route, stop, scrubber, comparison, and inspector action.

## Visual direction and tradeoffs

The palette is forensic paper, mineral blue, rust failure, observed green, and evidence grey. `Newsreader`, `Public Sans`, and `DM Mono` separate investigation questions, interface text, and evidence metadata. The signature element is the causal transit map with one movable time scanline. Exact evidence is solid, inferred evidence is striped/dashed, and unavailable evidence is hollow.

The direction optimizes topology and causal navigation over maximum row density. It makes delegation and failure location quick to scan, but long Sessions will need clustering/zoom rather than simply adding more stops. The side inspector keeps evidence readable on desktop; on narrow screens it becomes a floating sheet and the canvas remains horizontally navigable. A production implementation would need tested zoom/pan semantics, virtualization for very large graphs, and a deliberate offline-font strategy.

## Focused verification

```bash
pnpm --filter @workspace/prototype-map test
pnpm --filter @workspace/prototype-map typecheck
pnpm --filter @workspace/prototype-map build
```

The behavior test covers the agreed public interaction seam: following a failure from Organization activity selects the exact failed Tool target.
