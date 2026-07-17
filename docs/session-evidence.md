# Rich Session evidence

`GET /api/v1/sessions/:id` is the public contract for Tool, lifecycle, API
transport-attempt, Token, Context, capability, and cost evidence. The browser reads this response; it does
not calculate private replacements or query PostgreSQL.

## Tools and lifecycle

Tool records reconcile a supported hook `tool_use_id` with an OTel `call_id`
only under the validated Codex `0.144.5` producer rule. Both identifiers remain
named separately. Input, result, duration, outcome, approval, retry count, Turn
association, source ids, and coverage gaps are independent fields. In
particular:

- a missing hook is a coverage gap, not evidence that no Tool ran;
- the captured failed-command fixture has an ambiguous passive outcome, so its
  stable outcome remains `unknown`;
- an absent approval or retry signal is `unavailable`, not `denied` or zero;
- differing hook and OTel Tool names remain visible as a cross-source gap.

`PreCompact` and `PostCompact` expose exact hook timing and `manual` or `auto`
trigger when emitted. Their replacement summary and Context contents are not
promoted from unstable rollout data. `SessionStart.source = resume` remains a
new Activity episode in the same durable Session. A user fork is emitted only
when the `0.144.5` rollout fallback proves user lineage with `forked_from_id`
and no Agent parent; ordinary `startup` is never treated as fork evidence.

Skill evidence has three distinct outcomes: source-defined explicit
mention/injection evidence; inferred `SKILL.md` access, which proves access but
not workflow compliance; and unavailable implicit activation/load timing. MCP
evidence likewise separates configured server names, Tools actually used, and
the unavailable complete passive capability snapshot.

## Token and Turn association

Each `codex.api_request` record is exposed as a transport attempt with its
nullable attempt number, HTTP status, duration, success/error, evidence, and
Turn association. These observations retain their `unstable` source label; a
log-time Turn join remains `inferred`. They are not promoted to stable logical
Model-request identities.

Each provider completion preserves these nullable categories separately:

- input Tokens;
- cached-input Tokens;
- output Tokens;
- reasoning-output Tokens;
- total Tokens.

The `0.144.5` completion log uses the source field named `tool_token_count` for
total usage; Loupe maps that field to `total`, never to Tool-only usage.
Source-defined trace parentage can associate a completion or Turn total with a
Turn exactly for this producer version, but the association strength is
`exact_unstable`. A log-only association is `inferred` only when the completion
time falls within one unique canonical Turn. Otherwise the Turn association is
`unavailable`. Session-cumulative Token consumption is never called Context
occupancy.

## Context methods

Reported Context-window and auto-compaction limits stay exact source facts.
For a completion with input usage, inferred occupancy uses:

```text
occupancy Tokens = provider-reported input Tokens
occupancy percent = input Tokens / reported Context window × 100
```

The API returns the method, both inputs, source ids, and missing assumptions.
The first chronologically defensible provider request/completion occupancy
sample is the Context baseline; a Turn-total aggregate is never eligible. It
is not an empty-Context claim. Provider input usage may differ from the
exact serialized request, so the estimate remains `inferred` even when both
numeric inputs were reported.

Codex `0.144.5` does not expose exact serialized Context or stable per-item
contribution. Loupe therefore returns contribution as `unavailable` with
method `no_stable_passive_per_item_context_contract` and does not populate a
composition chart. A later local-tokenization estimate must name its tokenizer
and version and remain separate from provider counts.

## Versioned estimated cost

Codex emits Token counts, not money. Cost is derived only when the server is
given an explicit external price table containing:

- version, currency, and effective date;
- an observed-model to priced-model mapping;
- per-million rates for uncached input, cached input, output, and reasoning
  output;
- a billing caveat.

Every estimate returns those fields plus its exact Token inputs. If the table,
model mapping, rate, or required Token category is absent, the estimate is
`unavailable` and names the reason. Loupe does not guess a mapping for the
observed `gpt-5.6-sol` probe model. Even a complete estimate is an
API-equivalent estimate, not a provider bill, ChatGPT subscription charge, or
plan-credit balance.

## Refusal language

User-facing consumers should say “unavailable from captured evidence” or name
the specific inference method. They must not replace unavailable values with
zero, `false`, “not used,” or a plausible estimate. The browser deliberately
uses evidence tables and cards for this initial contract; unsupported charts
are omitted rather than backfilled from fixture or Seeded data.
