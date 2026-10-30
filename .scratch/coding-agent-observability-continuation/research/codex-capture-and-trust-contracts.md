# Codex capture and trust contracts

**Research date:** 2026-07-18 (Asia/Kolkata)

**Target producer:** `codex-cli 0.144.5`

**Question:** Which current official Codex surfaces and trust requirements govern hooks, OpenTelemetry, lifecycle and Turn identity, model and Token evidence, tools, skills, MCP, context, compaction, resume, and repository metadata? Which claims cannot be promoted beyond observed, unstable, inferred, or unavailable for `0.144.5`?

## Executive answer

For ordinary local Codex work, Loupe's defensible passive baseline is **trusted user-level lifecycle hooks plus both OpenTelemetry log and trace export**, with every observation tagged by producer version and retained before projection. Hooks provide the documented lifecycle and Turn identifiers. OTel provides documented run, transport, prompt, approval, tool, and completion-Token event families. In `0.144.5`, undocumented trace structure supplies exact completion-to-Turn ancestry, but that ancestry is a version-gated observation, not a public schema contract.

Three boundaries are non-negotiable:

1. **Installed is not trusted.** Codex skips a non-managed command hook until the user trusts the exact normalized hook definition; changed definitions become `modified` and are skipped again. Setup cannot claim capture coverage until `hooks/list` reports every expected hook `enabled` and `trusted` or `managed` ([current Hooks docs](https://developers.openai.com/codex/hooks#review-and-trust-hooks); [`0.144.5` hook discovery](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/engine/discovery.rs#L500-L545); [`hooks/list` metadata](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/plugin.rs#L501-L526)).
2. **Current documentation is not a retroactive `0.144.5` schema.** The official app-server docs explicitly say generated schemas are specific to the Codex version that generated them. Current pages may describe behavior added after the pinned release, so exact fields must come from the `0.144.5` source or sanitized probe, not from `main` or a later alpha ([App Server message schema](https://developers.openai.com/codex/app-server#message-schema); [`0.144.5` source tree](https://github.com/openai/codex/tree/87db9bc18ba5bc82c1cb4e4381b44f693ee35623)).
3. **No supported surface exposes a complete evidence graph.** There is no documented passive skill-activation event, complete callable-tool snapshot, exact model-request identity, exact request-context composition, per-context-item Token attribution, provider-billed monetary cost, or passive fork event. Those claims must remain unavailable or explicitly inferred.

`codex app-server` is a useful exact stream for conversations it hosts, including Thread/Turn/item lifecycle and Token notifications, but the CLI command is currently labeled experimental and it does not passively observe unrelated CLI, IDE, desktop, or cloud sessions ([current CLI reference](https://developers.openai.com/codex/cli/reference#cli-codex-app-server); [App Server lifecycle](https://developers.openai.com/codex/app-server#lifecycle-overview)). Local rollout JSONL and SQLite state can fill version-specific gaps, but the Hooks docs explicitly say transcript format is not stable; those stores must remain fallback evidence, never the supported baseline ([Hooks common input fields](https://developers.openai.com/codex/hooks#common-input-fields)).

## Evidence labels

- **D — documented:** stated in current official Codex docs. This is stronger than inference, but not a promise that an unversioned page or schema never changes.
- **O — observed:** present in official `0.144.5` source or the repository's sanitized `0.144.5` probe.
- **U — unstable:** explicitly experimental/unstable or taken from an internal/source-only/local-state shape that must be version-gated.
- **I — inferred:** derived by ordering, ancestry, sampling, or calculation rather than carried as a source fact.
- **N — unavailable:** no current supported field or event establishes the claim.

## Surface and trust boundary

| Surface | What it can establish | Trust and stability boundary | Decision |
|---|---|---|---|
| Lifecycle hooks | **D/O** Session, Turn, prompt, local tool, approval, compaction, subagent, and turn-stop events | Exact-definition trust is required. Project hooks also require project trust. Hosted and specialized tool paths can bypass local tool hooks, so hooks are not a complete enforcement boundary ([Hooks trust](https://developers.openai.com/codex/hooks#review-and-trust-hooks); [tool coverage](https://developers.openai.com/codex/hooks#tool-coverage)). | Canonical lifecycle source when the expected hook set is verified trusted at setup and health-check time. |
| OTel logs | **D/O** Conversation start, API attempts, SSE/WebSocket families, prompt metadata, tool decisions/results, model slug, completion Token counts | Opt-in and disabled by default. `otel` is ignored in project config, so route it only from user/system/managed config. Exact fields are source-defined. Log payloads can contain prompts, tool arguments, outputs, account metadata, and errors ([Advanced Config](https://developers.openai.com/codex/config-advanced#observability-and-telemetry); [project-config restrictions](https://developers.openai.com/codex/config-advanced#project-config-files)). | Supported event-family feed; preserve raw event name/version and redact structurally. |
| OTel traces | **O/U** `0.144.5` Turn spans, response ancestry, MCP spans, Turn Token deltas | Trace export is configurable, but the public docs do not publish the exact span schema. | Use exact ancestry only behind a `0.144.5` capability gate. |
| App-server v2 | **D/O/U** Hosted Thread/Turn/item lifecycle, resume/fork, Token usage, MCP inventory, explicit skill input, optional Git metadata | Version-specific protocol; some methods/fields require `experimentalApi`. WebSocket transport is experimental/unsupported and must not be exposed without the documented local/TLS/auth controls ([App Server protocol](https://developers.openai.com/codex/app-server#protocol); [experimental opt-in](https://developers.openai.com/codex/app-server#experimental-api-opt-in)). | Optional integration for sessions Loupe deliberately hosts; not a passive global collector. Generate schemas with the installed binary. |
| Rollout JSONL / transcript / SQLite | **O/U** Thread tree, fork lineage, compaction windows, context records, optional Git metadata | Local persistence shape is not a supported hook interface and contains sensitive conversation state. | Version-gated fallback only; never silently override hook/OTel facts. |
| Relay-side Git snapshot | **I** Repository, branch, HEAD, dirty/worktree facts at sample time | External observation, not Codex evidence; repository state can change between samples. | Store as separately sourced, timestamped repository context. |

The current docs say CLI and IDE share configuration layers, while local desktop/CLI/IDE share MCP configuration on the same Codex host. ChatGPT web does not read local Codex configuration. The docs do not promise identical hook and OTel materialization across every local and hosted surface, so the repository's CLI/exec probe does not prove IDE, desktop, cloud, or ChatGPT-web coverage ([Config basics](https://developers.openai.com/codex/config-basic#codex-configuration-file); [MCP connection scope](https://developers.openai.com/codex/mcp#connect-codex-to-an-mcp-server); [MCP in ChatGPT web](https://developers.openai.com/codex/mcp#use-mcp-backed-tools-in-chatgpt-web)).

## Hooks: current contract and `0.144.5` boundary

Current Codex documents ten lifecycle events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, and `Stop`. `SessionStart` and `SubagentStart` are thread/start scoped; the others are Turn scoped. Command hooks receive one JSON object on stdin. Common fields include `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `model`; Turn events add the Codex `turn_id` extension ([Hooks runtime behavior](https://developers.openai.com/codex/hooks); [Hooks common fields](https://developers.openai.com/codex/hooks#common-input-fields)). The `0.144.5` generated structs confirm these exact identifiers and tool/compaction fields ([tool and compaction inputs](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/schema.rs#L270-L377); [session, prompt, and stop inputs](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/schema.rs#L482-L595)).

The trustworthy identity interpretation for `0.144.5` is:

- hook `session_id` is the identity shared by the root Thread and descendants;
- hook `turn_id` is an exact Turn identity when the event is emitted;
- subagent `agent_id` is the concrete child Thread identity;
- OTel `conversation.id` is the concrete Thread identity, not the tree-wide Session identity.

The release source explicitly distinguishes concrete `thread_id()` from tree-wide `session_id()` and constructs `SessionTelemetry` with the concrete Thread id ([Session identity](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/session/session.rs#L462-L471); [telemetry construction](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/session/session.rs#L800-L837)). The sanitized probe asserts two-Turn Session/Turn stability and nested descendants without copying transcript content ([probe assertions](../../../tests/probe/test_codex_0144_5_contract.py); [sanitized manifest](../../../packages/agent-adapter/test/fixtures/codex/0.144.5/probe-manifest.json)).

Lifecycle limits:

- `SessionStart.source` can identify `startup`, `resume`, `clear`, or `compact`. **D/O** This is an activity-episode boundary, not a permanent Session-ended event.
- root `Stop` is Turn scoped. **D** It must not be projected as permanent Session completion.
- `SubagentStart`/`SubagentStop` carry the child id and triggering Turn, but not an explicit immediate-parent Thread id. Exact recursive parentage from hooks alone is therefore **I**.
- no fork-specific hook exists. A user fork is **N** on passive hook/OTel surfaces; exact fork lineage from app-server or rollout is **O/U**.
- missing hooks mean coverage was absent or bypassed, not that the activity did not occur.

Hook trust itself is part of the evidence contract. In `0.144.5`, only `managed` or hash-matching `trusted` hook definitions enter the executable handler set unless the explicit bypass flag is used; `untrusted` and `modified` entries remain discoverable but do not run ([release trust selection](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/engine/discovery.rs#L500-L545)). A setup bypass may be appropriate for a deliberately isolated one-off probe, but it is not a production trust state.

## OTel logs, traces, model, and Token evidence

The public telemetry contract is event-family level. It documents `codex.conversation_starts`, `codex.api_request`, `codex.sse_event`, `codex.websocket_request`, `codex.websocket_event`, `codex.user_prompt`, `codex.tool_decision`, and `codex.tool_result`, including Token counts on `response.completed` ([current emitted-event list](https://developers.openai.com/codex/config-advanced#what-gets-emitted)). The exact `0.144.5` log fields are source observations:

- common log metadata includes `conversation.id`, `app.version`, auth/originator/account/terminal metadata, `model`, and `slug`; trace-safe events omit account id and email ([release common fields](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/shared.rs#L4-L38));
- conversation start includes provider, reasoning, context window, auto-compaction threshold, approval/sandbox policy, and configured MCP server names/count ([release conversation start](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L460-L489));
- `codex.api_request` records a transport attempt, status/duration/error and optional auth request metadata, but not a documented logical model-request id ([release API request](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L526-L590));
- `response.completed` records input, output, cached, reasoning, and a field named `tool_token_count`; in this release the caller passes `usage.total_tokens` into that field, so it must be normalized as total usage rather than interpreted as tool-only Tokens ([release completion event](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L906-L932); [release caller](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/client.rs#L1999-L2013)).

The sanitized target probe observed `codex.websocket_request` but no `codex.websocket_event`. The latter is therefore **D/N for the tested `0.144.5` path**, not a capability Loupe may advertise merely because the current unversioned page lists it ([probe manifest](../../../packages/agent-adapter/test/fixtures/codex/0.144.5/probe-manifest.json)).

OTel logs do not carry `turn_id`. Assigning a completion to a Turn from log ordering alone is **I**. With `trace_exporter` enabled, `0.144.5` emits a Turn span containing `thread.id`, `turn.id`, model, reasoning effort, and Turn Token deltas, and response spans descend from that Turn span. That makes completion-to-Turn ancestry exact for the observed release, but the span names and attributes are **O/U** because the public telemetry page does not specify them ([release Turn span](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/tasks/mod.rs#L384-L400); [Turn Token population](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/tasks/mod.rs#L661-L703)).

App-server-hosted sessions have a separately useful `thread/tokenUsage/updated` notification with exact `threadId`, `turnId`, total and last Token breakdowns, and optional model context window in `0.144.5` ([release Token notification](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1369-L1424)). It remains a host-bound, versioned source.

The following must not be promoted:

- model slug and provider-reported Token categories are **D/O exact when emitted**;
- a stable logical model request/response identity is **N** on passive hook/OTel surfaces, even though internal code receives response ids;
- exact request-context items and per-item Token contribution are **N**;
- context occupancy calculated from the latest input count and context window is **I**, not an exact context snapshot;
- provider-billed currency, unit price, charge, or ChatGPT-credit consumption is **N**. Any cost is an estimate with a versioned external price table and billing-mode caveat;
- fields seen only on `main` or `0.145.0-alpha`, such as later cache-write accounting, are outside the `0.144.5` contract.

## Tools, skills, and MCP

### Tools

`PreToolUse` and `PostToolUse` cover shell/unified exec, `apply_patch`, MCP tools, and most other local function tools. Hosted tools such as Web Search do not use this hook path, and specialized paths may opt out. The official docs therefore call hooks a useful guardrail rather than a complete enforcement boundary ([tool coverage](https://developers.openai.com/codex/hooks#tool-coverage)).

For supported paths, hook `tool_name`, `tool_input`, `tool_use_id`, `tool_response`, and `PermissionRequest` are **D/O exact when emitted**. OTel supplies `tool_name`, `call_id`, decision, success, duration, arguments/output, and MCP origin. In the release log path, tool arguments and output are exported verbatim, while the trace-safe event retains lengths/counts instead ([release tool telemetry](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L977-L991); [release result payload](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L1087-L1133)). Setting `log_user_prompt = false` does not redact tool arguments, tool output, hook prompts, or hook results. Loupe must apply its own structural redaction and authorization.

The probe found equality between all 10 observed hook `tool_use_id` values and OTel `call_id` values. That is **O/U**, not a documented cross-surface invariant ([probe manifest](../../../packages/agent-adapter/test/fixtures/codex/0.144.5/probe-manifest.json)). A complete snapshot of every callable tool is **N** for ordinary passive capture.

### Skills

Current Codex documents progressive disclosure: the initial context contains skill name, description, and path metadata; full `SKILL.md` is loaded only after selection. Selection can be explicit or implicit. The initial skill list is budgeted to at most 2% of the model context, or 8,000 characters when the context size is unknown ([Build Skills](https://developers.openai.com/codex/skills#how-codex-uses-skills); [progressive-disclosure budget](https://developers.openai.com/codex/skills)).

Neither Hooks nor the documented OTel event list defines `SkillStart`, `SkillLoaded`, or `SkillStop`. Therefore:

- exact implicit skill activation and timing are **N**;
- an explicit `$skill` mention can be retained as prompt evidence, but “mentioned” is not “loaded” or “completed”;
- app-server `UserInput::Skill { name, path }` makes an explicit typed input **O/U** for app-server-hosted Turns, not a passive activation event ([release typed input](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L285-L316));
- the current docs do not specify a hook-like per-skill hash-trust event. Skill-provided scripts still execute through ordinary tool, sandbox, and approval controls; Loupe must not invent a “trusted skill” fact.

### MCP

Official MCP configuration supports local stdio and remote Streamable HTTP servers, server instructions, tool allow/deny lists, per-server/per-tool approval policy, OAuth/bearer authentication, and trusted-project project configuration. CLI, IDE, and desktop local hosts can share that configuration ([MCP supported features](https://developers.openai.com/codex/mcp#supported-mcp-features); [configuration options](https://developers.openai.com/codex/mcp#other-configuration-options)).

Passive evidence can establish configured server names at conversation start and exact MCP tool use when a hook/OTel event is emitted. `0.144.5` MCP spans additionally carry server, origin/transport, connector, tool/call, Thread, and Turn fields, but those attributes are **O/U** ([release MCP span](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/mcp_tool_call.rs#L471-L494)). App-server's `mcpServerStatus/list` can return a host-bound inventory of servers, tools, resources, templates, and auth status ([release MCP inventory](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs#L32-L78)). A complete passive capability snapshot for arbitrary sessions remains **N**.

## Context, compaction, resume, and local persistence

Codex exposes exact configuration or start metadata for model context window, auto-compaction threshold, tool-output limit, AGENTS instruction byte limit, and the progressive-disclosure skill budget ([Config Reference](https://developers.openai.com/codex/config-reference); [AGENTS discovery](https://developers.openai.com/codex/guides/agents-md#how-codex-discovers-guidance)). These values bound context; they do not enumerate the exact request context.

The exact contents and Token contribution of system instructions, layered `AGENTS.md`, selected skill instructions, MCP server instructions, tool definitions/results, prior messages, memory, and compaction summaries are **N** on supported passive surfaces. Reading rollout/transcript content could reconstruct some of it, but the format is unstable and the content is sensitive. This research intentionally inspected only official schemas/source and the repository's sanitized/key-only fixtures.

Compaction and resume can be represented honestly:

- `PreCompact` and `PostCompact` with `trigger = manual | auto` are **D/O exact lifecycle facts**; they do not expose the replacement summary ([release hook inputs](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/schema.rs#L339-L377));
- rollout `compacted`, window ids, replacement history, and `turn_context` are **O/U** internal persistence fields, not a stable integration contract ([release rollout variants](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3130-L3145));
- `SessionStart.source = resume` is a **D/O exact resume event**. The `0.144.5` probe observed identity continuity, so resume should create a new activity episode under the same canonical Session/Thread rather than fabricate a new Session ([sanitized manifest](../../../packages/agent-adapter/test/fixtures/codex/0.144.5/probe-manifest.json));
- app-server `thread/resume` and `thread/fork` are exact only for the app-server-hosted protocol and installed schema ([App Server lifecycle](https://developers.openai.com/codex/app-server#lifecycle-overview)).

## Repository metadata

Current Codex uses a project root, typically the Git root, to discover layered `AGENTS.md` guidance, and only loads project `.codex/` configuration/hooks/rules after project trust ([AGENTS discovery](https://developers.openai.com/codex/guides/agents-md#how-codex-discovers-guidance); [configuration precedence and trust](https://developers.openai.com/codex/config-basic#configuration-precedence)). This behavior establishes instruction scope; it does not make Git metadata part of the documented hook or OTel contract.

The stable passive facts are limited to `cwd` in hook input and `conversation.id`/producer metadata in OTel. Neither documented surface promises repository URL, branch, commit, worktree, dirty state, or file ownership.

`0.144.5` source does contain optional Git metadata in two versioned surfaces:

- app-server `Thread.gitInfo` with `sha`, `branch`, and `originUrl` ([release Thread schema](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L161-L218));
- rollout `SessionMetaLine.git` with commit hash, branch, and repository URL ([release rollout metadata](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3008-L3145); [release `GitInfo`](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3333-L3343)).

Those fields are **O/U**, optional, and do not include dirty state or historical ownership. Loupe should collect repository context independently at capture time, retain the sample timestamp and failure reason, and label it as relay-derived. It must not treat `originator` or `source` as independent proof of the client surface: the sanitized probe observed `codex exec` while inheriting a desktop originator environment ([probe report](../../../docs/capture/codex-0.144.5.md)).

## Claims that must remain downgraded for `0.144.5`

| Claim | Required label | Why |
|---|---|---|
| Hook Session/Turn/tool/compaction/resume facts | **D/O exact when emitted** | Documented schema and sanitized probe, but only after trust and only on covered paths. |
| Exact completion-to-Turn association through trace ancestry | **O/U** | Exact in release source/probe; trace span schema is undocumented. |
| Hook `tool_use_id` equals OTel `call_id` | **O/U** | Observed 10/10, not documented as a cross-surface invariant. |
| Recursive subagent parentage from `codex.agent_communication`, rollout, or app-server | **O/U** | Source-only/internal or host-bound; hook payload lacks explicit parent Thread id. |
| Parentage from hooks alone | **I** | Requires Turn ownership and event correlation. |
| User fork lineage | **O/U** from app-server/rollout; **N** from passive hooks/OTel | No fork hook/OTel event. |
| Explicit skill activation | **O/U** for typed app-server input; otherwise prompt evidence only | Explicit input is not proof of load/completion. |
| Implicit skill activation/timing | **N** | No lifecycle event. |
| Complete tool/MCP/skill capability snapshot | **N** passively | App-server inventory is optional and host-bound. |
| Exact logical model request/response id | **N** passively | OTel exposes attempts and optional auth metadata, not a supported durable request identity. |
| Provider Token usage | **D/O exact when emitted** | Preserve original categories and producer event; normalize the misnamed `tool_token_count` only under the release gate. |
| `codex.websocket_event` on the tested producer path | **D/N** | Named by current docs but not emitted in the sanitized `0.144.5` probe. |
| Exact context occupancy/composition/item attribution | **I/N** | Limits and aggregate usage exist; exact item set and attribution do not. |
| Provider-reported monetary cost | **N** | No billed amount/currency/unit price. |
| Session permanent end | **I** | `Stop` is Turn scoped; silence is not an end event. |
| Transcript/rollout/SQLite schema | **O/U** | Local state is sensitive and not a stable hook interface. |
| Repository URL/branch/HEAD from Codex | **O/U** when optional app-server/rollout fields exist | Not in stable hook/OTel contract and may be absent. |
| IDE, desktop, cloud, or ChatGPT-web parity with the CLI probe | **N until separately verified** | The existing real probe covers the `0.144.5` CLI/exec path. |

## Capture contract to carry into implementation

1. Install capture hooks in user/system/managed configuration, not only project configuration. After writing them, query `hooks/list` and fail closed unless every expected definition is enabled and `trusted` or `managed`.
2. Configure both OTel `exporter` and `trace_exporter` at user/system/managed scope. Keep `log_user_prompt = false` by default, but still redact hook payloads, tool arguments/results, errors, MCP data, paths, account metadata, and unknown strings.
3. Retain append-only raw observations before projection with source, producer version, event/type, occurrence and receipt times, capture path, parser version, redaction state, and payload hash/source id.
4. Project tree-wide Session from hook/rollout `session_id`, concrete Agent Thread from OTel `conversation.id` or hook `agent_id`, and Turn from hook/app-server `turn_id`. Never collapse Session and Thread identity.
5. Preserve hook `tool_use_id` and OTel `call_id` separately. Reconcile them only under an explicit versioned rule with retained evidence.
6. Treat trace ancestry, agent-communication edges, app-server schemas, rollout parsing, fork lineage, compaction windows, and optional Git fields as producer-versioned capabilities. Unsupported versions must downgrade rather than emit stable-looking facts.
7. Represent absence honestly: `unavailable` or `coverage_unknown`, never false/zero. Keep observed facts, inferences, estimates, and unavailable claims visibly distinct in APIs and UI.
8. Capture Git context independently and timestamp it. Do not attribute relay-derived branch/HEAD/dirty/ownership facts to Codex.
9. Re-run a sanitized compatibility probe for every newly supported Codex version. Do not inspect or commit raw session content.

## Primary sources and local verification

1. OpenAI, [current Codex manual](https://developers.openai.com/codex/codex-manual.md), fetched with the official manual helper on 2026-07-18; targeted current pages are linked inline.
2. OpenAI, [`openai/codex` release source `0.144.5` at `87db9bc…`](https://github.com/openai/codex/tree/87db9bc18ba5bc82c1cb4e4381b44f693ee35623), published 2026-07-16. All release source links above are commit-pinned.
3. Repository sanitized compatibility evidence: [probe README](../../../probes/codex-0.144.5/README.md), [capture report](../../../docs/capture/codex-0.144.5.md), [sanitized manifest](../../../packages/agent-adapter/test/fixtures/codex/0.144.5/probe-manifest.json), and [executable assertions](../../../tests/probe/test_codex_0144_5_contract.py). These assets exclude raw transcript/session content.
