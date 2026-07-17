# Session and Turn comparisons

`POST /api/v1/comparisons` is the shared browser/CLI seam for evidence-oriented
comparisons. A request names one or more selected Sessions or Turns, the search
filters that produced the selection, whether Seeded examples may be included
for illustration, and the claim being assessed. Responses echo that population
and report resolved/missing selections, evidence gaps, real and Seeded Turn
counts, subject-level evidence completeness, and the effective synthetic-data
state.

The comparison is descriptive. Duration, Tool count, provider Token use,
estimated cost, model choice, and correlation can be returned as signals, but
none of them establishes developer productivity, Session outcome, or causation.
Human-assigned Session outcomes may support a descriptive outcome comparison;
they still do not prove productivity or causation.

## Evidence classifications and refusals

A `repeated_pattern` requires at least two distinct real captured Turns. Exactly
one real Turn is a `single_case_hypothesis`. Seeded Turns never increase the real
Turn count, even when `includeSeeded` is explicitly enabled; they remain labelled
illustrations. No real Turns produces `INSUFFICIENT_REAL_TURN_EVIDENCE`.

Unsupported claims are returned as a normal comparison response with
`claim.status = "refused"` and one stable reason:

- `INSUFFICIENT_OUTCOME_EVIDENCE` — no selected real Session has a human outcome.
- `INSUFFICIENT_CAUSAL_EVIDENCE` — captured associations do not prove a cause.
- `INSUFFICIENT_PRODUCTIVITY_EVIDENCE` — no validated productivity measure exists.

This refusal is evidence metadata, not an HTTP failure. Authentication,
authorization, contract validation, and unavailable storage continue to use the
ordinary stable API error envelope.

## Citations and navigation

Every factual real-Turn citation has a stable citation id and four links:

- the authorized Session resource at `GET /api/v1/sessions/:id`;
- the exact authorized Turn at `GET /api/v1/sessions/:id/turns/:turnId`;
- the exact captured timeline activity at
  `GET /api/v1/sessions/:id/activity/:sourceEventId`;
- a browser link carrying `session`, `turn`, and `activity` parameters.

All three API targets require an authenticated Organization member and resolve
only within that member's Organization. Device credentials remain forbidden.
Seeded Turns without captured source activity have no fabricated activity
citation; comparison completeness reports that gap.

## Plain CLI

Select a complete Session with its id, or a Turn with `session-id:turn-id`:

```bash
coding-agent-analysis compare session-a:turn-a session-b:turn-b \
  --claim "The selected Turns used the same workflow."

coding-agent-analysis compare session-a session-b \
  --kind causal \
  --signals token_usage,duration,tool_count,model_choice,correlation \
  --claim "The lower-duration workflow caused the outcome." \
  --json
```

Use `--include-seeded` only when an illustrative example is intentional. Human
output names the classification, real/Seeded population, completeness,
refusal, caveats, and browser citations; `--json` preserves the complete stable
response.
