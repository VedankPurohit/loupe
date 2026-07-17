# Prototype 11B — Narrative evidence notebook

> Throwaway UI prototype. This is design evidence for ticket 11, not production UI.

## Prototype question

Can a case-file / investigation-notebook interface help a developer or Coach move from Organization activity to the exact failed Tool faster than a dashboard or spatial canvas, while preserving chronology, Agent branches, and evidence fidelity?

This app explores one direction only. Other ticket-11 worktrees provide the other directions; the user selection belongs at the ticket level after comparing them.

## Run it

Start the real PostgreSQL-backed server on port `3000`, authenticate through the main browser app, then run:

```bash
pnpm prototype:notebook
```

Open `http://127.0.0.1:5181`. Vite proxies `/api` to the real server, so the existing HttpOnly `browser_session` cookie is sent without putting credentials in prototype code.

Real `/api/v1` evidence is the default. The only deterministic edge-fixture entry point is:

```text
http://127.0.0.1:5181/?fixture=edge
```

Fixture mode stays visibly labelled in a persistent yellow banner and includes a “Return to real /api/v1 evidence” link. It is UI-evaluation data and must not be cited as captured Organization evidence.

## Central keyboard journey

The focused public seam is: Organization activity → selected Session → exact failed Tool.

1. Tab to a case’s “Open notebook” action and press Enter.
2. Tab to “Jump to first failure” and press Enter.
3. Focus moves to the exact failed Tool evidence card, which is announced by its accessible name. Continue tabbing to expand its provenance footnote.

The focused behavior test covers the state transition behind that journey:

```bash
pnpm --filter @workspace/prototype-notebook test
```

Basic package verification:

```bash
pnpm --filter @workspace/prototype-notebook typecheck
pnpm --filter @workspace/prototype-notebook build
```

## Real contracts used

- `GET /api/v1/organization/activity` for case discovery and full-text search
- `GET /api/v1/sessions/:id` for Turns, Agent runs, chronology, Tools, lifecycle, Token usage, Context occupancy, capabilities, cost status, and provenance
- `POST /api/v1/comparisons` for an evidence-classified comparison between the open case and a peer case
- `GET /api/v1/live` to refresh Organization activity after `session.updated`

All requests use authenticated cookies (`credentials: include`). The prototype does not query PostgreSQL, invent a second domain model, infer a productivity score, or turn missing evidence into zero.

## Direction and signature

The page treats Organization activity as a casebook rather than a metric dashboard. A selected Session becomes a sequence of numbered evidence chapters. The signature element is the vertical evidence stitch: it binds Turn chronology while inline branch threads show where root and Subagent runs enter the story. Tool failures, gaps, and comparisons read as evidentiary exhibits; source classifications remain expandable footnotes instead of permanently occupying the reading path.

Visual system:

- Night ink `#0D1F2D`, blueprint paper `#DFEAED`, page white `#F8FBFA`
- Oxidized copper `#BB593D`, failure red `#BE3F36`, instrument teal `#34797A`
- Iowan/Palatino for restrained chapter typography, Avenir/system sans for reading, system mono for evidence labels
- No hero metrics, rankings, warm editorial cream, card-grid dashboard, or decorative charts

## Evaluation notes

| Criterion | Notebook direction |
| --- | --- |
| Investigation speed | Strong for a known failure: a two-action keyboard path lands on the exact Tool. Less efficient for broad metric scanning. |
| Information density | Medium-high. Chronology stays primary; provenance collapses into footnotes; the margin holds fidelity and comparison. |
| Accessibility | Native buttons, form labels, details/summary, status regions, visible focus, reduced-motion handling, and a responsive linear reading order. |
| Responsive behavior | Casebook becomes a top section, chapters remain linear, and the margin follows the evidence on narrow screens. |
| Implementation cost | Moderate. Mostly semantic HTML and CSS; no graph-layout engine or chart library. |
| Demo clarity | Strong narrative: “open a case, follow the chapters, land on the failure, compare the evidence.” |

Early usability finding: the notebook is clearest when the primary action names the evidentiary destination (“Jump to first failure”), not a generic “Inspect” action. Inline Agent branches preserve delegation context without requiring the reader to leave chronology. The comparison belongs after the working diagnosis, not ahead of it.

Accessibility risks to check before production: very dense provenance identifiers can be fatiguing for screen-reader users; sticky case navigation needs testing at high zoom; the CSS-drawn chronology should never be the only encoding of sequence; focus after smooth scrolling should be verified in Safari and VoiceOver.

Rejected tradeoffs:

- A spatial execution canvas makes branch topology primary but weakens the guided failure narrative.
- A dashboard-first overview makes aggregate scanning faster but encourages unsupported metric interpretation and adds an extra step before the exact Tool.
- Always-visible raw telemetry raises density and fidelity anxiety without helping the first diagnosis; expandable evidence classifications and source ids keep provenance available.
- Per-item Context composition is omitted because the current API explicitly reports it as unavailable.

## Prototype disposition

Do not promote this package directly. If this direction wins, ticket 12 should rebuild the validated interaction in `apps/web`, retain the exact `/api/v1` seams and keyboard journey, and decide which notebook language survives alongside the production Organization and Session information architecture.
