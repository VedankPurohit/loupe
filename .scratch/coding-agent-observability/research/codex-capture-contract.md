# Loupe — Codex capture contract: validated surfaces and gaps

**Research date:** 2026-07-16 (Asia/Kolkata)

**Question:** Which current Codex surfaces can reliably capture sessions, turns, model requests, tokens, costs, tools, skills, MCP capabilities, compactions, resumes, forks, and nested subagents?

**Primary-source baseline:** the current Codex manual fetched on 2026-07-16; npm current release `0.144.5` at [`87db9bc18ba5bc82c1cb4e4381b44f693ee35623`](https://github.com/openai/codex/commit/87db9bc18ba5bc82c1cb4e4381b44f693ee35623) (2026-07-16); comparison with main/`0.145.0-alpha` at [`0f44bca9154e056a32fde7a89026b4620599e6f2`](https://github.com/openai/codex/commit/0f44bca9154e056a32fde7a89026b4620599e6f2); and key-only inspection of local Codex rollouts produced by versions `0.139.0` and `0.144.5`. No transcript content was copied into this report. Main-only fields are explicitly marked unstable and are not treated as current-release fields.

## Executive answer

The viable passive capture contract for normal local Codex sessions is **OpenTelemetry logs + traces + user-level lifecycle hooks**, with raw signals retained separately. Logs supply documented event families; release traces add exact-but-source-defined turn and MCP correlation; hooks supply the documented turn/lifecycle payloads for prompts, tools, compaction, resume, and subagents.

That combination is still incomplete:

- It does **not** expose a stable model-request id, response id, exact request context, per-context-item token contribution, provider-reported money cost, skill activation event, complete callable-tool snapshot, explicit fork event, or an explicit `parent_thread_id` in hook/OTel payloads.
- OTel **log events alone** have `conversation.id` but no `turn_id`, so their temporal join is inferential. With the separately configured trace exporter, release `0.144.5` nests response handling/events under a source-defined turn span carrying `thread.id` and `turn.id`; that trace hierarchy associates completions to turns exactly in this version, but the span schema is undocumented and version-gated.
- Hooks can identify a spawned child with `agent_id`, but their payload does not include an explicit immediate-parent thread id. Current release source also emits undocumented `codex.agent_communication` logs with sender/receiver thread ids, and exact recursive parentage exists in rollout `session_meta.parent_thread_id`, SQLite `thread_spawn_edges`, and app-server `Thread.parentThreadId`. The OTel event and local-state formats are unstable; app-server only describes sessions hosted through that process.
- Skills use progressive disclosure, but Codex exposes no documented passive “skill loaded” lifecycle event. Explicit skill mentions have a typed app-server input form; implicit selection/loading is otherwise only inferable from prompt/transcript/tool activity.
- Codex emits token counts, not currency. Cost must be labelled as an estimate based on a versioned external price table and authentication/billing mode, and may not represent ChatGPT plan credits.

For the Build Week demonstration, the honest contract is therefore: **exact sessions/tree id, turns, tools, compactions, resumes, model slug, and provider token usage; exact-but-version-gated completion-to-turn trace association; no stable logical model-request id; inferred context occupancy; estimated cost; unavailable exact skill-load timing, context composition, and passive capability snapshots; rollout parsing as a version-gated fallback only.**

## Evidence labels

Every field or conclusion below carries one of these labels:

- **D — documented:** named in the current public Codex manual/docs. This is the best supported product contract, not a promise that schemas never evolve.
- **O — observed:** present in current official source or a first-party local artifact, but not fully promised by the user docs. Pin the producer version and accept additive changes.
- **I — inferred:** derived by correlation or calculation; retain the evidence and confidence.
- **U — unstable:** explicitly experimental/unstable, or part of a surface the docs say may change.
- **N — unavailable:** no current supported field/surface found after checking the manual, schemas, and current source.

Grouped labels apply to every field in the same comma-separated code span unless another label interrupts them.

## Concise capture matrix

| Needed concept | Best current surface | Exact data available | Classification | Contract decision |
|---|---|---|---|---|
| Durable session/tree | Hooks + OTel | **D** hook `session_id`; **D** OTel `conversation.id`; **O** rollout/app-server `session_id` shared by the root and descendants | Exact ids, but they mean different levels | Canonical session/tree id = hook `session_id`; agent-run/thread id = OTel `conversation.id` or child hook `agent_id` |
| Activity episode/start | `SessionStart` + timestamps | **D** `source = startup \| resume \| clear \| compact`, `cwd`, `model`, `permission_mode`; OTel event timestamps | Exact event; idle/end remains derived | Never mark a session permanently complete from silence |
| Turn boundary | Hooks | **D** `UserPromptSubmit.turn_id`, turn-scoped hook `turn_id`, root `Stop.turn_id`; **O** local `task_started`/`task_complete` | Exact hook turn id | Start on `UserPromptSubmit`/first turn event; end on root `Stop`; interrupted/idle are separate activity states |
| Model/API request | OTel | **D** `codex.api_request` attempt/status/duration/error and `codex.sse_event`/websocket event; **N** stable request/response id and request body | Request attempt exists; request identity is missing | Store transport attempts; project a model request only with an inferred correlation key and confidence |
| Token usage | OTel logs + traces | **D/O** release completion fields: input, cached input, output, reasoning output, total; **O/U** trace hierarchy assigns completions and turn totals to `turn.id`; **U** cache-write is main/0.145-alpha only | Logs alone infer the join; release traces make it exact but unstable | Preserve raw logs/traces and source-defined turn totals; do not call cumulative usage “context size” |
| Money cost | None | **N** provider-reported cost/currency/billing unit | Unavailable | Optional estimate only, with price-table version and billing caveat |
| Context window/occupancy | OTel + calculation | **D/O** `context_window`, `auto_compact_token_limit`; **I** last completion input tokens ÷ window | Limit exact, occupancy inferred | Show exact limit and token usage; label occupancy as derived and do not claim item-level composition |
| Tool invocation/result | Hooks + OTel | **D** `tool_name`, `tool_input`, `tool_use_id`, `tool_response`; OTel `call_id`, duration, success, output; MCP server/origin in current source | High fidelity when emitted; documented hook coverage is incomplete; cross-surface id equality is not documented | Treat hook invocation as canonical for supported paths; preserve OTel `call_id` and reconcile only after validation |
| Skills | App-server typed input / transcript inference | **O** explicit `UserInput::Skill { name, path }`; **D** progressive disclosure behavior; **N** passive load/complete event | Explicit invocation partly visible; implicit load unavailable | Do not promise exact skill timing; report explicit mention separately from inferred file read/use |
| MCP capability snapshot | OTel start + app-server status API | **D** configured server names/count at conversation start; **O** versioned app-server `mcpServerStatus/list` returns server/tool/resource inventory | OTel is server-level only; app-server is host-bound | Passive adapter captures server names and used tools; full snapshot is unavailable for ordinary sessions unless Codex adds a hook/OTel event |
| Compaction | Hooks | **D** `PreCompact`/`PostCompact`, `turn_id`, `trigger = manual \| auto`; **U** rollout summary/window chain | Stable lifecycle, unstable summary body | Exact annotation from hooks; summary/context replacement only through versioned fallback |
| Resume | `SessionStart` | **D** `source = resume`; same session/thread identity | Exact | Open a new activity episode on resume, not a new canonical session |
| Fork | App-server/local metadata | **O** versioned app-server `forkedFromId`; **U** rollout `forked_from_id`; **N** fork-specific hook/OTel event | Exact in app-server-hosted sessions; no passive stable event | Do not infer fork from `startup`; use versioned rollout fallback or mark unknown |
| Subagent + nested parentage | Hooks + OTel enrichment + local fallback | **D** hook child id/type/turn; **O/U** source-only agent-communication edge; **U** rollout/SQLite edges; **O** versioned app-server `parentThreadId` | Exact parent edge is source-only, internal, or host-bound | Prefer hooks plus verified agent-communication; reconcile with versioned local fallback |

## 1. OpenTelemetry contract

### Configuration and common metadata

OTel export is opt-in. Public config distinguishes log `exporter`, `trace_exporter`, and `metrics_exporter`; logs/traces default to `none`, while release metrics default to `statsig`. It also exposes `environment`, `span_attributes`, `tracestate`, and `log_user_prompt` (default false) ([manual](https://developers.openai.com/codex/codex-manual.md); [release config lines 539–587](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/config/src/types.rs#L539-L587)). **D/O** Configuring only the log exporter does not export trace spans.

Every current OTel log event produced through `SessionTelemetry` includes **O** `event.timestamp`, `conversation.id`, `app.version`, `auth_mode`, `originator`, `user.account_id`, `user.email`, `terminal.type`, `model`, and `slug`. Trace-safe events omit account id/email. These exact common field names come from current source rather than the public event table ([`shared.rs` lines 4–38](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/shared.rs#L4-L38)).

Important identity distinction: current source constructs telemetry with the **individual thread id** as `conversation.id` ([`session.rs` lines 822–833](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/session/session.rs#L822-L833)), while Codex’s internal `session_id` is shared by the root and all descendants ([`session.rs` lines 458–467](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/session/session.rs#L458-L467)). **O** The adapter must not collapse these into one identifier.

### Documented event names and payloads

The public docs describe these representative structured log events: **D** `codex.conversation_starts`, `codex.api_request`, `codex.sse_event`, `codex.websocket_request`, `codex.websocket_event`, `codex.user_prompt`, `codex.tool_decision`, and `codex.tool_result` ([manual event list](https://developers.openai.com/codex/codex-manual.md)). Exact field sets are not a published versioned schema, so source-derived fields below are **O/U**. Preserve unknown events/fields and producer version.

Exact currently emitted fields are:

- `codex.conversation_starts`: **O** `provider_name`, auth-environment-presence booleans/names, `reasoning_effort`, `reasoning_summary`, `context_window`, `auto_compact_token_limit`, `approval_policy`, `sandbox_policy`, plus log-only `mcp_servers` (comma-separated configured names) or trace-only `mcp_server_count` ([`session_telemetry.rs` lines 473–509](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L473-L509)).
- `codex.api_request`: **D** attempt, HTTP status/success, duration, and error concept; **O/U** exact release fields include `duration_ms`, `http.response.status_code`, `error.message`, `attempt`, `endpoint`, authentication/recovery fields, `auth.request_id`, `auth.cf_ray`, `auth.agent_id`, and `auth.task_id`. The release log has no explicit `success` attribute; success is a metric tag ([release recorder](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L526-L590)). `auth.request_id` is optional, not a documented durable model-request key. **N** stable request id.
- `codex.sse_event`: **D** kind/success/failure/duration/error concept. Ordinary success logs have `event.kind` and `duration_ms`, but no explicit `success`; failures add `error.message`. Release `0.144.5` `response.completed` emits **O/U** `input_token_count`, `output_token_count`, `cached_token_count`, `reasoning_token_count`, `tool_token_count`, `ttft_ms`, `service_tier`, and `model_reasoning_effort` ([release lines 906–932](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L906-L932)). `cache_write_token_count` is **U main/0.145-alpha only** ([main lines 926–944](https://github.com/openai/codex/blob/0f44bca9154e056a32fde7a89026b4620599e6f2/codex-rs/otel/src/events/session_telemetry.rs#L926-L944)). The release caller supplies total tokens as `tool_token_count`; it is not tool-only usage ([release caller](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/client.rs#L1999-L2013)).
- Response spans in release record **O/U** input, cache-read input, output, reasoning-output, and total usage. Cache-write span usage is **U main/0.145-alpha only**.
- `codex.websocket_request`: **D** duration/success/error concept; **O/U** exact release fields include `duration_ms`, `success`, `error.message`, connection/auth fields and optional agent/task ids. Docs also name `codex.websocket_event`, but release emits only metrics `codex.websocket.event` and `.duration_ms`, not that log event ([release handler](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L721-L779)). **D/O mismatch**
- `codex.user_prompt`: **D** prompt length and optionally content. Current logs contain **O** `prompt_length`, `prompt`; traces contain counts for text/image/local-image inputs. With `log_user_prompt = false`, log prompt content is `[REDACTED]` ([lines 947–987](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L947-L987)).
- `codex.tool_decision`: **D/O** `tool_name`, `call_id`, `decision`, `source` ([lines 990–1005](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L990-L1005)).
- `codex.tool_result`: **D/O** log fields `tool_name`, `call_id`, `arguments`, `duration_ms`, `success`, `output`, `mcp_server`, `mcp_server_origin`; trace-safe fields expose lengths/counts and `tool_origin`/`mcp_tool` instead of raw content ([lines 1100–1146](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/otel/src/events/session_telemetry.rs#L1100-L1146)). Tool arguments/output and hook payloads can contain secrets even when user prompt logging is disabled. **D security requirement**

### OTel gaps

There is no `turn_id`, `parent_thread_id`, fork id, skill id, capability snapshot id, or stable response id in common **log-event** fields. A completion log belongs to an exact agent thread but only an **I** ordering/span join places that individual completion in a turn.

With `trace_exporter` enabled, release emits a source-defined `turn` span with **O/U** `otel.name`, `thread.id`, `turn.id`, `model`, reasoning effort, and turn-delta input/cached/non-cached/output/reasoning/total token attributes ([release span](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/tasks/mod.rs#L384-L400); [population](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/tasks/mod.rs#L661-L703)). Response handling spans/events are children of that task span, so the trace hierarchy gives exact completion-to-turn association for release `0.144.5`. Main/0.145-alpha adds cache-write turn usage. No stable logical model-request id is added.

Release also exports undocumented **O/U** `codex.agent_communication`: sends carry `communication_id`, `kind = spawn | message | followup | result`, sender/receiver thread ids, state, and content ([event source](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/agent_communication.rs#L4-L78); [`codex_otel` export filter](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/otel_init.rs#L95-L103)). For `kind=spawn,state=send` this is an exact recursive parent edge, but source-only and sensitive. MCP call spans similarly expose server/origin/transport, connector, tool/call ids, `conversation.id`, and `turn.id` ([release source](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/mcp_tool_call.rs#L475-L509)).

OTel reports usage, not price. No currency, unit price, billed amount, ChatGPT-credit multiplier, or cost field was found in the OTel, protocol, or app-server v2 types. **N**

## 2. Lifecycle-hook contract

Hooks are enabled by default when configured and trusted. User-level `~/.codex/hooks.json` or inline `[hooks]` in `~/.codex/config.toml` is the correct one-time setup surface; project hooks depend on project trust. Matching command hooks run concurrently. Only command handlers execute today; `prompt` and `agent` handlers are parsed but skipped, and asynchronous command hooks are not supported ([official Hooks documentation](https://learn.chatgpt.com/docs/hooks); [current hook schema](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/schema.rs)). **D**

All hook events receive one JSON object on stdin. The documented common input fields are **D** `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`; the applicable events also carry `permission_mode`. Turn-scoped events carry the Codex extension `turn_id`. The docs explicitly warn that `transcript_path` points to a convenient transcript whose format “isn't a stable interface for hooks and may change.” **U** transcript contents/shape ([official Hooks documentation](https://learn.chatgpt.com/docs/hooks)).

The ten current event names are **D**:

| Hook | Exact current input beyond common fields | Meaning/stability |
|---|---|---|
| `SessionStart` | `source` = `startup \| resume \| clear \| compact` | **D** thread/activity start; no `turn_id` |
| `UserPromptSubmit` | `turn_id`, optional subagent `agent_id`/`agent_type`, `prompt` | **D** turn input boundary and full prompt |
| `PreToolUse` | `turn_id`, optional `agent_id`/`agent_type`, `tool_name`, `tool_input`, `tool_use_id` | **D** canonical invocation observation |
| `PermissionRequest` | `turn_id`, optional `agent_id`/`agent_type`, `tool_name`, `tool_input` | **D** requested approval; no `tool_use_id` in current schema |
| `PostToolUse` | `turn_id`, optional `agent_id`/`agent_type`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id` | **D** canonical result observation |
| `PreCompact` | `turn_id`, optional `agent_id`/`agent_type`, `trigger` = `manual \| auto` | **D** exact lifecycle, not summary content |
| `PostCompact` | same as `PreCompact` | **D** completion of compaction |
| `SubagentStart` | `turn_id`, `agent_id`, `agent_type` | **D** child identity and spawn turn; no explicit parent thread id |
| `SubagentStop` | `turn_id`, `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `last_assistant_message` | **D** child stop/result; `transcript_path` is the parent transcript in current source |
| `Stop` | `turn_id`, `stop_hook_active`, `last_assistant_message` | **D** root turn stop, not permanent session completion |

Tool-hook coverage is not universal. The current Hooks guide says `PreToolUse` and `PostToolUse` intercept supported simple Bash calls, `apply_patch`, and MCP tools; interception is incomplete for `unified_exec`, and these hooks do not cover `WebSearch` or other non-shell, non-MCP tools. **D** Therefore the payload is exact when the hook fires, but absence of a hook event is not proof that no tool ran. OTel and app-server items can add coverage, but no documented passive surface guarantees one uniform lifecycle event for every Codex tool.

The exact structs are defined together in [`schema.rs` lines 270–377 and 482–595](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/schema.rs#L270-L377). The remaining event inputs are at [lines 482–595](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/schema.rs#L482-L595); JSON schemas are generated as first-party fixtures under [`codex-rs/hooks/schema/generated`](https://github.com/openai/codex/tree/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/schema/generated). This is stronger than transcript parsing because the public docs explicitly point consumers to these schemas.

`session_id` in current Codex core is the tree-wide session id, while `SubagentHookContext.agent_id` is the concrete child thread id ([hook context](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/hooks/src/events/common.rs#L11-L16); [session identity](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/session/session.rs#L458-L467)). **O clarification**

For a thread-spawned child, current core dispatches `SubagentStop`, resolves the immediate parent's transcript path, and emits the child thread id as `agent_id` ([`hook_runtime.rs` lines 297–350](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/core/src/hook_runtime.rs#L297-L350)). **O** This helps nested correlation, but the input still lacks `parent_thread_id`; exact parentage from hooks alone depends on knowing which agent thread owns the spawning `turn_id`. That is **I**, not an explicit edge.

## 3. Local state and rollout JSONL

The current local state lives under `CODEX_HOME` (normally `~/.codex`), including sessions and `history.jsonl`; the manual documents the location but not rollout JSONL as an integration contract. The Hooks docs explicitly mark transcript format unstable. Therefore all field-level rollout use is **U**, even when current source has strongly typed Rust schemas.

At release `0.144.5`, each JSONL record is `RolloutLine { timestamp, ordinal?, type, payload }`. The tagged payload variants are **O/U** `session_meta`, `response_item`, `inter_agent_communication`, `inter_agent_communication_metadata`, `compacted`, `turn_context`, `world_state`, and `event_msg` ([release `protocol.rs` lines 3130–3145](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3130-L3145)).

The most useful current fields are:

- `session_meta`: **O/U** `session_id` (tree), `id` (thread), `forked_from_id?`, `parent_thread_id?`, `timestamp`, `cwd`, `originator`, `cli_version`, `source`, `thread_source?`, `agent_nickname?`, `agent_role?`, `agent_path?`, `model_provider?`, `dynamic_tools?`, `selected_capability_roots`, `multi_agent_version?`, and initial `context_window?` ([release lines 3008–3062](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3008-L3062)). Main adds `subagent_history_start_ordinal`; it is **U alpha**, not a release field.
- `turn_context`: **O/U** `turn_id?`, `cwd`, workspace roots, date/timezone, approval/sandbox/permission state, `model`, `personality?`, `collaboration_mode?`, `multi_agent_mode?`, `effort?`, and other baseline state ([lines 3243–3291](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3243-L3291)).
- `compacted`: **O/U** `message`, `replacement_history?`, `window_number?`, `first_window_id?`, `previous_window_id?`, `window_id?` ([lines 3204–3221](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/protocol/src/protocol.rs#L3204-L3221)). This can reconstruct a compaction window chain but exposes sensitive summary/history content.
- Locally observed on 2026-07-16: **O/U** `event_msg.task_started { turn_id, started_at, model_context_window, collaboration_mode_kind }`, `task_complete { turn_id, completed_at, duration_ms, time_to_first_token_ms, last_agent_message }`, `turn_aborted`, `token_count`, `context_compacted`, and `sub_agent_activity { agent_thread_id, agent_path, kind, event_id, occurred_at_ms }`. `token_count.info` currently contains `total_token_usage`, `last_token_usage`, and `model_context_window`, with input/cached/output/reasoning/total counts. These are observations of local versions, not supported schemas for an external watcher.

The local SQLite state is internal/unstable but release `0.144.5` includes `thread_spawn_edges(parent_thread_id, child_thread_id, status)`. **U** This is useful corroboration/discovery, not an external live-capture contract.

Product consequence: use a watcher only as a **version-gated compatibility adapter** for exact parentage, fork lineage, and historical backfill. Record `cli_version`, file path, source record type, byte/ordinal position, and parser version. Never silently promote parsed transcript fields to “documented.”

## 4. App-server v2: versioned supported fields, but not a passive tap

`codex app-server` provides versioned JSON-RPC fields and streams `turn/started`, `turn/completed`, item lifecycle, and `thread/tokenUsage/updated` for sessions hosted through that process ([release README](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server/README.md#L1371-L1395)). Its schema generator separates default supported fields from explicitly opt-in experimental fields. The fields below are not individually experimental; `path` and named opt-in methods/fields remain **U**. **D/O**

Current default v2 structures offer useful exact, versioned fields:

- `Thread`: **O** `id`, `sessionId`, `forkedFromId`, `parentThreadId`, timestamps/status, cwd, CLI version, source, agent nickname/role, git info, and optional turns; `path` is explicitly **U**.
- `Turn`: **O** `id`, `items`, `itemsView`, `status`, `error`, start/completion timestamps, `durationMs`.
- Public token notification: **D/O** `threadId`, `turnId`, cumulative `total`, `last`, and `modelContextWindow`; release breakdown is total/input/cached-input/output/reasoning-output. `cacheWriteInputTokens` is **U main/0.145-alpha only**. The separate raw per-response notification is internal-only.
- Tool items: **O** command, file, MCP, dynamic, collaboration-agent, subagent activity, and context compaction, including sender/receiver ids for collaboration.
- `mcpServerStatus/list` returns **O** server/tool/resource inventory; typed `UserInput::Skill { name, path }` proves an explicit mention, not an implicit load.

Release permalinks: [`Thread`/`Turn`](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L167-L251), [token notification/breakdown](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1404-L1474), [tool items](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L227-L390), [MCP inventory](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs#L32-L78), and [typed skill input](https://github.com/openai/codex/blob/87db9bc18ba5bc82c1cb4e4381b44f693ee35623/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L288-L319).

However, app-server is not a passive subscription endpoint for arbitrary CLI/IDE/app sessions. Its live notifications describe turns the connected client starts/hosts. Running a separate app-server does not attach to an already-running ordinary Codex client. **D architectural boundary** The Build Week “normal sessions after one-time setup” requirement therefore cannot use app-server as its sole capture path without changing how users launch/host Codex.

## 5. Exact answers by product concept

### Sessions, resumes, and forks

- A root-and-descendant tree has a shared internal/hook `session_id`; every root/subagent thread has its own thread id. **O**
- `SessionStart.source = resume` is the supported passive resume signal. **D** A resume continues the same durable session and should create a new activity episode.
- `SessionStart.source = compact` follows compaction-related session-start behavior and is not a resume/fork. **D**
- Fork lineage is present as app-server `forkedFromId` and rollout `forked_from_id`, but no fork-specific hook or OTel event is documented. **O/U/N** A new `startup` must not be labelled a fork without lineage evidence.

### Turns and model requests

- Hook `turn_id` is exact and should be the canonical turn id. **D**
- A `codex.api_request` is a transport attempt, not necessarily one logical model request; retries have `attempt`. **D**
- A single turn can contain multiple Responses API completions because tool use and compaction continue the loop. Log-only grouping is **I**; release trace parentage associates response handling to the exact turn **O/U**, but still lacks a stable logical model-request id.
- Exact serialized request context, system/developer instructions as sent, tool definitions, response id, and causal links from request → tool → retry are **N** on the passive stable surfaces.

### Tools and MCP

- Hooks are the strongest supported passive tool contract for the paths they intercept because pre/post payloads share `tool_use_id`, turn, input, and response. **D** Coverage is incomplete for unified exec and excludes WebSearch plus other non-shell, non-MCP tools, so missing hook data must remain `unavailable` rather than being interpreted as no activity.
- OTel adds duration/success and uses `call_id`; current source exposes MCP server/origin. Equality of hook `tool_use_id` and OTel `call_id` is not documented. Preserve both and classify a join as **I** until a target-version probe proves it.
- The configured MCP server-name list is available at conversation start, and used MCP tools are observable. **D/O** A complete callable MCP tool schema/capability snapshot is **N** in passive OTel/hooks.
- A full inventory can be queried from app-server only when that server owns the thread. **O** It is not a general passive collector contract.

### Skills and capabilities

The manual documents progressive disclosure: Codex initially receives skill name/description/path metadata and loads full `SKILL.md` only when it selects a skill ([official Build Skills docs](https://learn.chatgpt.com/docs/build-skills)). **D** Neither hooks nor OTel defines `SkillStart`, `SkillLoaded`, or `SkillStop`. **N**

Capture levels must be explicit:

1. **Exact explicit mention:** typed `UserInput::Skill { name, path }` when using app-server, or a literal `$skill` in a captured prompt. **O/I** (literal prompt parsing is inference).
2. **Observed file/tool activity:** a read of a `SKILL.md` path. **I** This is evidence of access, not proof that the workflow was followed.
3. **Implicit activation:** **N** as a stable passive event.
4. **Capability snapshot:** OTel exposes MCP server names, session model/policy, and actual tools used; full built-in tool, skill, plugin, and MCP schema set at each request is **N**.

### Tokens, context, compaction, and cost

- Provider-reported release categories are exact when present. **D/O** Preserve input, cached input, output, reasoning output, total, model, service tier, and producer event id/time. Cache-write input is **U main/0.145-alpha only**.
- Session cumulative usage is a sum; it is not context occupancy. **D conceptual distinction**
- Approximate request occupancy can be calculated as provider input tokens divided by the model context window. **I** The numerator may include cached input and is associated to a turn only by correlation on passive OTel.
- Exact contribution by instruction, skill, MCP definition/result, history item, tool output, or compaction summary is **N**. Local tokenization of captured text is an estimate and misses hidden/provider-transformed context.
- Compaction timing and trigger are exact through hooks. **D** The replacement summary/window chain is only **U** via rollout parsing.
- Currency cost is **N**. Any displayed amount must be `estimated_cost`, include currency, model-price-table version/effective date, calculation inputs, and billing-mode caveat. ChatGPT subscription/credit accounting must not be presented as API-token cost.

### Subagents and recursive parentage

Current product docs support subagent threads and configurable nesting; `agents.max_depth` defaults to 1, allowing root → child but preventing grandchildren until raised ([official Subagents docs](https://learn.chatgpt.com/docs/agent-configuration/subagents)). **D**

For every spawn, `SubagentStart` gives the spawning turn and child `agent_id`; `SubagentStop` gives the same child identity and its last assistant message. **D** The missing field is `parent_thread_id`. For direct children, root parentage can be inferred. For grandchildren, associate the spawning `turn_id` with its owning child thread, or use the current rollout `session_meta.parent_thread_id`. The former is **I**; the latter is exact data on an **U** surface.

Therefore the nested-subagent demo is conditional: run a target-version probe that spawns root → child → grandchild, verify hooks for all three threads, verify rollout `session_id`, `id`, and `parent_thread_id`, and record the producer version. If that proof fails, demo one level and declare nested parentage unsupported rather than fabricating the edge.

## 6. Recommended capture contract

### Supported primary sources

1. **OTel log and trace exporters:** ingest raw signals losslessly; use logs for documented event families and source-defined traces for turn/MCP correlation. Preserve unknown fields and producer version.
2. **User-level command hooks:** install one handler for all ten lifecycle events. Copy stdin to the local relay before any optional processing; return quickly and never block user work on network delivery.
3. **Versioned source metadata:** attach `source = codex_otel | codex_hook | codex_rollout | codex_app_server`, `app.version`/`cli_version`, capture time, producer event name, and raw payload hash/id.
4. **Rollout watcher only as fallback:** use for `parent_thread_id`, `forked_from_id`, compaction replacement/window ids, and historical recovery. Advertise these capabilities as unstable and version-gated.

### Canonical identity rules

- `canonical_session_id` ← hook/rollout `session_id` (tree-wide).
- `agent_run_id` ← root OTel `conversation.id`, child hook `agent_id`, or rollout/app-server thread `id`.
- `parent_agent_run_id` ← verified `codex.agent_communication` spawn sender/receiver edge, then reconcile with rollout/SQLite/app-server parent ids. All are exact current data on unstable or host-bound surfaces; otherwise infer from `SubagentStart.turn_id` ownership.
- `turn_id` ← hook `turn_id`; never synthesize it from timestamps when hooks are present.
- Preserve `forked_from_id` separately from `parent_thread_id`: a fork is lineage, not an agent parent edge.
- Preserve hook `tool_use_id` and OTel `call_id` independently until an observed reconciliation rule is proven for the installed version.

### Capability declarations the adapter should publish

| Capability | Declaration for initial Codex adapter |
|---|---|
| Sessions/tree identity | `exact` with hooks; root/thread mapping reconciled with OTel |
| Turns | `exact` with hooks |
| Agent thread identity | `exact` for spawned child id; root from OTel/session start |
| Immediate parent edge | `unstable_exact` via agent-communication/local state; otherwise `inferred` |
| Nested parentage | `conditional` on target-version probe |
| Tool input/result/timing | `exact_when_emitted`; hook coverage is incomplete; cross-source reconciliation inferred |
| Model slug/provider/request attempts | `exact` |
| Logical model-request identity | `inferred` |
| Provider token usage | `exact_when_reported`; release trace association exact-but-unstable, log-only join inferred |
| Context window | `exact_when_reported` |
| Context occupancy | `inferred` |
| Context-item contribution | `unavailable` (local estimate may be separate) |
| Compaction timing/trigger | `exact` |
| Compaction summary/window chain | `unstable_exact` via rollout |
| Resume | `exact` |
| Fork | `unstable_exact` passive fallback; exact/versioned for app-server-hosted sessions |
| Explicit skill mention | `partial`; implicit activation `unavailable` |
| MCP servers used/configured | `exact` names/uses; complete passive tool inventory `unavailable` |
| Provider-reported monetary cost | `unavailable`; estimate only |

## 7. Required target-version validation probe

Before implementation locks schemas, run one real macOS session with OTel and all hooks enabled that includes: two user turns, a built-in tool success and failure, an approval, one MCP call, explicit and implicit skill use, manual and automatic compaction if feasible, resume, fork, a child, and a grandchild after raising `agents.max_depth`. Capture raw OTel and hook payloads plus key-only rollout metadata.

The probe must answer these remaining empirical questions without upgrading them to public guarantees:

- Does the installed binary emit the documented `codex.websocket_event` log, and with which exact fields?
- Does hook `tool_use_id` equal OTel `call_id` for built-in and MCP calls?
- Does the release trace hierarchy retain exact completion-to-turn association under retries, tools, parallel subagents, and compaction, and what degrades when only logs are enabled?
- Do nested child hooks run in the immediate parent context, and can the spawning turn be mapped to its owning thread without rollout parsing?
- Does `SessionStart` fire on fork, and if so what `source` value appears? The schema has no `fork` value.
- Which clients (CLI, IDE, desktop) materialize rollout files soon enough for near-real-time fallback, and how do their `cli_version`/originator fields differ?

Negative or ambiguous results must reduce the adapter capability declaration. They must not be patched over by timestamp guessing without an `inferred` label.

## Sources

All sources are first-party:

1. OpenAI, [current Codex manual](https://developers.openai.com/codex/codex-manual.md), fetched and verified current on 2026-07-16. Relevant embedded sources: Observability and telemetry, Hooks, Skills, Subagents, slash commands, and config/state locations.
2. OpenAI, [`openai/codex` release `0.144.5` at `87db9bc…`](https://github.com/openai/codex/tree/87db9bc18ba5bc82c1cb4e4381b44f693ee35623), 2026-07-16, with explicitly marked comparisons to main/`0.145.0-alpha` at `0f44bca…`. Permalinks pin exact source/schema lines.
3. OpenAI, [Hooks documentation](https://learn.chatgpt.com/docs/hooks), including the warning that transcript format is not stable.
4. OpenAI, [Build Skills](https://learn.chatgpt.com/docs/build-skills) and [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
5. First-party local Codex artifacts under `~/.codex` generated by Codex versions `0.139.0`/`0.144.5`, inspected on 2026-07-16 at key/schema level only. These observations corroborate existence, not stability.
