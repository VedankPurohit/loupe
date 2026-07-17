# Codex 0.144.5 capture contract probe

This document records a real macOS probe of `codex-cli 0.144.5`. It is the
producer evidence for the Codex Agent-adapter contract; it is not the
production adapter. When a result is negative or ambiguous, the declared
capability is reduced instead of repaired with timestamp guesses.

## Evidence vocabulary

- `documented`: the current public Codex documentation names the surface or
  field family.
- `observed`: this exact producer emitted the field or relationship locally.
- `inferred`: the value requires correlation or calculation; its inputs and
  method must be retained.
- `unstable`: source-defined traces, agent-communication events, app-server,
  rollout/transcript/local-state data, or other version-gated evidence.
- `unavailable`: no supported fact was captured. It does not mean zero, false,
  or that the activity did not happen.

The labels describe different dimensions and may coexist. For example, the
nested parent edge was exact data in this run, but only on unstable sources.

Official source baseline: the current [Codex
manual](https://developers.openai.com/codex/codex-manual.md), [Hooks
documentation](https://learn.chatgpt.com/docs/hooks), and [Subagents
documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
The manual was fetched through the official OpenAI-docs workflow on 2026-07-17.

## Producer and procedure

The probe ran on macOS 26.5.1 (build 25F80) on 2026-07-17. The global binary
was `codex-cli 0.139.0` before and after the probe. The target was invoked only
through the version-pinned npm package:

```sh
npx -y @openai/codex@0.144.5 --version
# codex-cli 0.144.5
```

Run the isolated probe:

```sh
python3 probes/codex-0.144.5/run_probe.py
```

The runner creates a new `loupe-codex-0144-5-*` tree in the operating system's
temporary area containing a Codex home, empty work directory, and raw capture
directory. It writes user-level
OTLP/HTTP JSON log and trace exporters plus all lifecycle hooks into that
temporary Codex home. It references the existing ChatGPT login through a
temporary symlink; it does not copy or inspect credential bytes. It uses only
harmless synthetic prompts and `gpt-5.6-sol`, the model selected by the target
process. Raw output contains account and content-bearing telemetry and must
remain outside the repository.

Sanitize the printed raw directory into versioned fixtures, then assert the
contract:

```sh
python3 probes/codex-0.144.5/sanitize_probe.py \
  /tmp/loupe-codex-0144-5-EXAMPLE/raw \
  packages/agent-adapter/test/fixtures/codex/0.144.5
python3 -m unittest -v tests/probe/test_codex_0144_5_contract.py
```

Exercise the fork and approval surfaces through a real PTY before sanitizing:

```sh
python3 probes/codex-0.144.5/run_interactive_probe.py \
  /tmp/loupe-codex-0144-5-EXAMPLE
```

The completed capture retained provenance for 49 hook records, 73 OTLP log
batches, and 32 OTLP trace batches across seven root Turns and two Subagent
Turns. These are batch/record counts, not selected-fixture counts. The raw
temporary capture, including the TUI terminal stream, was deleted after
sanitization and verification.

## Workload and observed coverage

The single durable Session included:

- seven root Turns: one `exec` startup, five `exec resume` episodes, and one
  interactive `codex fork` Turn;
- Bash success plus a command with exit code 1;
- an MCP `echo` call against a temporary local `probe` server;
- an explicit `$probe-skill` mention and a separate implicit-scenario prompt;
- one automatic compaction with paired `PreCompact`/`PostCompact` hooks in the
  regenerated capture;
- root → child → grandchild delegation after `agents.max_depth = 2`;
- a non-interactive permission scenario under `approval_policy = "untrusted"`;
- a PTY-hosted `codex fork` scenario that approved only the synthetic command
  `touch approval-interactive.txt` inside the isolated temporary workspace.

The approval scenario produced no `PermissionRequest`, did not create the
requested file, and completed without a tool call. It proves only that approval
was not observable in the non-interactive probe. The PTY retry produced one
documented `PermissionRequest`, a matching synthetic file effect, and normal
`Stop` lifecycle evidence. Its ANSI terminal text was not used as evidence.
The interactive process was terminated only after the hook lifecycle stopped.

## Capability matrix

| Capability | Evidence | Target-version decision |
|---|---|---|
| Session/tree identity | documented + observed | Exact hook `session_id`; one value covered root, child, and grandchild evidence. Keep it distinct from per-thread identity. |
| Turn identity | documented + observed | Exact hook `turn_id`; never synthesize a competing timestamp Turn id. Six root prompt Turns and two Subagent trace Turns were distinct. |
| Agent-run/thread identity | documented + observed | Root/thread identity is OTel `conversation.id`/trace `thread.id`; hook `agent_id` identifies each child. |
| Resume | documented + observed | Exact `SessionStart.source = resume`; five new Activity episodes remained in the same Session. |
| Hook tool payloads | documented + observed | Exact when emitted, but coverage remains incomplete. Ten unique `PostToolUse.tool_use_id` values all appeared as OTel `call_id` in this run: exact 10/10 reconciliation for this fixture. Equality is observed and version-gated, not a public rule. |
| Tool failure | observed + ambiguous | CLI output contained one exit code 1, but the matching hook response had no structured exit field and OTel `tool_result.success` was `"true"`. A stable passive failure outcome is unavailable without source-specific interpretation. |
| Approval | documented + observed | One `PermissionRequest` hook fired in the PTY scenario for `tool_name = Bash`; the hook payload is exact when emitted. The non-interactive scenario remains negative evidence about that surface, not about approval generally. |
| OTel log → Turn join | inferred | OTel logs had `conversation.id` but no `turn_id`; a log-only Turn association remains temporal correlation. |
| Trace → Turn join | observed + unstable | Nine source-defined `session_task.turn` spans carried both `thread.id` and `turn.id`. Each of the 21 selected usage-bearing response spans walks through sanitized intervening ancestors to its nearest exact Turn; the associated Turns include root, child, and grandchild threads. Exact for this version, not a documented schema. |
| Direct/nested parentage | observed + unstable | Two `codex.agent_communication kind=spawn,state=send` edges formed a nested chain and matched the two hook child ids. Rollout `parent_thread_id` corroborated root → child → grandchild. Hooks alone omit parent thread id, so their Turn-ownership join remains inferred. |
| Fork | observed + unstable | `codex fork` is a real interactive CLI command. Its user-thread `session_meta` had `source = cli`, `thread_source = user`, `forked_from_id` present, and no `parent_thread_id`; the matching hook `SessionStart.source` was still `startup`. Subagents also set both lineage and parent fields, so the user-thread/source conditions are required and rollout remains version-gated. |
| MCP use | documented + observed | Hook `mcp__probe__echo`, OTel server `probe`, and an `mcp.tools.call` span were exact when emitted. A complete passive MCP tool/schema inventory remains unavailable. |
| Explicit skill mention | observed + unstable/partial | Source-defined traces showed one `mentioned_skill_count = 1`, supported by the captured explicit prompt before sanitization. This is mention/injection evidence, not proof the workflow was followed. |
| Implicit skill activation | unavailable | The implicit-scenario Turn created no documented activation event. File access or trace internals may be supporting evidence only; they cannot become exact activation. |
| Compaction timing/trigger | documented + observed | Exactly one automatic `PreCompact` + `PostCompact` pair emitted `trigger = auto`. Replacement history and window data remain unstable rollout evidence. |
| `codex.websocket_event` log | documented + unavailable | Not emitted. The run did emit `codex.websocket_connect`, `codex.websocket_request`, and `codex.sse_event`; do not substitute them under the missing event name. |
| API/model activity | documented + observed | `codex.api_request` records transport attempts. Stable logical Model-request and response identities remain unavailable. |
| Provider Token usage | documented + observed | Completion logs and source-defined response/Turn spans carried input, cached-input, output, reasoning-output, and total usage when reported. Log-only Turn association is inferred; trace association is unstable exact. |
| Context window | documented + observed | Exact when emitted. Context occupancy remains inferred; per-item contribution and exact serialized request context remain unavailable. |
| Capability snapshot | unavailable | Configured MCP server names and tools actually used are evidence, not a complete passive built-in/MCP/skill/plugin snapshot. |
| Provider monetary cost | unavailable | No currency or billed amount was emitted. Any future cost is a separately labelled estimate with a versioned price table and billing caveat. |

## Observed payload contract

### Lifecycle hooks

Observed common keys were `session_id`, `transcript_path`, `cwd`,
`hook_event_name`, `model`, and `permission_mode`. Turn-scoped events added
`turn_id`. This run observed:

- `SessionStart`: `source` values `startup` and `resume`;
- `UserPromptSubmit`: `prompt`;
- `PreToolUse`: `tool_name`, `tool_input`, `tool_use_id`;
- `PostToolUse`: `tool_name`, `tool_input`, `tool_response`, `tool_use_id`;
- `PreCompact`/`PostCompact`: `trigger = auto`;
- `SubagentStart`: `agent_id`, `agent_type`, but no `parent_thread_id`;
- `SubagentStop`: child identity, transcript path, stop state, and last message;
- `Stop`: `stop_hook_active` and last message.

The non-interactive Turn produced no `PermissionRequest`; the PTY fork produced
one with the common identity fields plus `tool_name` and structurally sanitized
`tool_input`. Absence in the first surface remains capture coverage, not a claim
that approval never exists.

### OTel logs and traces

Observed log event names were `codex.conversation_starts`,
`codex.api_request`, `codex.sse_event`, `codex.user_prompt`,
`codex.tool_decision`, `codex.tool_result`, `codex.websocket_connect`,
`codex.websocket_request`, and undocumented `codex.agent_communication`.
Unknown record fields such as `observedTimeUnixNano`, `flags`, and additive
attributes are retained in the selected sanitized fixtures. Additive unknown
objects and arrays retain their keys, scalar types, and shape, but their string
values are default-denied and structurally tokenized. This prevents a future
content-bearing field from bypassing sanitization merely because its key is new.

The trace fixture retains selected Turn, response usage, tool, MCP,
skill-mention, and sampling spans plus every intervening sanitized ancestor
needed to reach the nearest Turn. `retention_reason` distinguishes selected
spans from ancestors. The important source-defined Turn attributes are
`thread.id`, `turn.id`, model, and Turn token categories. These are
observed/unstable, even though their values were exact in the run.

### Rollout compatibility evidence

The key-only rollout fixture records source-file slots and ordinals, all payload
keys, and only the identity/version fields needed to preserve relationships.
All retained `session_meta` observations reported `cli_version = 0.144.5`.
Child and grandchild records included both `parent_thread_id` and
`forked_from_id` equal to their immediate parent. The user fork instead had a
lineage id without an Agent parent id and created a distinct tree-wide Session
id.
The observed `originator` was `Codex Desktop` even though the command surface
was `codex exec`, because the probe inherited the desktop environment. Treat
originator as source metadata, not independent proof of client surface.

Rollout parsing remains unstable and version-gated. It cannot masquerade as the
passive supported baseline or silently override conflicting hooks/OTel.

## Ticket-04 adapter obligations

1. Retain every accepted source observation append-only before projection.
   Store source name, producer version, producer event/type, occurrence and
   receipt time, capture path, parser version where applicable, payload hash or
   source id, redaction state, and the sanitized/raw payload according to policy.
2. Preserve unknown events and fields, but never treat preservation as permission
   to preserve unknown string content. Retain keys, scalar types, and nested
   shape while structurally tokenizing unknown strings. The fixtures normalize repeated OTel
   resource blocks into numbered slots only to keep test artifacts compact;
   every selected resource, log-record, span, and additive field remains.
3. Project canonical Session from tree-wide hook/rollout `session_id`, Agent run
   from per-thread OTel/hook/rollout identity, and Turn from hook `turn_id`.
4. Preserve hook `tool_use_id` and OTel `call_id` independently. The observed
   10/10 equality may enable a version-gated reconciliation rule with retained
   inputs; it is not a cross-version invariant.
5. Prefer exact unstable `codex.agent_communication` or rollout parent edges
   only under an explicit `0.144.5` parser gate. With hooks alone, label
   parentage inferred and retain Turn-ownership evidence/confidence.
6. Keep `parent_thread_id` separate from `forked_from_id`. In this producer,
   both appeared on subagents, so neither field by itself proves a user fork.
7. Missing hooks mean coverage is unavailable, not that activity did not occur.
   Do not turn absent implicit skill or uniform tool-failure evidence into
   false/zero values. Permission is exact only when the hook emits; fork remains
   an unstable rollout capability despite this observed user-fork fixture.
8. A capability declaration must expose source stability and derivation
   separately. Unsupported producer versions must downgrade or reject
   version-gated parsing rather than emit stable-looking canonical values.

## Fixtures and executable assertions

The fixtures live under
`packages/agent-adapter/test/fixtures/codex/0.144.5/`:

- `hooks.sanitized.json` — all 49 sanitized hook records;
- `otel-logs.sanitized.json` — selected event families with resource slots;
- `otel-traces.sanitized.json` — selected spans, ancestor closure, and exact
  completion-to-nearest-Turn relationships;
- `rollout-key-only.sanitized.json` — version-gated identity/key metadata;
- `interactive-probe.sanitized.json` — non-sensitive PTY attempt facts; raw
  terminal text is excluded;
- `probe-manifest.json` — counts, classifications, and explicit downgrades.

The first TDD run failed because `hooks.sanitized.json` did not yet exist. After
the real capture and sanitizer were added, the identity assertion turned green.
The complete command now runs nine assertions covering two-Turn identity,
adversarial additive-field sanitization, target-only tool-id reconciliation,
nested parentage, exact source-defined trace association, raw provenance,
failed-command ambiguity, and interactive fork/approval evidence.

## Known limitations and follow-up

- Only automatic compaction was exercised. Manual compaction uses the same
  documented trigger field but has no local fixture here.
- Fork is proven only on the interactive CLI with unstable rollout lineage;
  there is still no passive hook/OTel fork event or stable cross-surface rule.
- The PTY renderer did not expose reliable plain-text prompt/completion markers
  through ANSI output. Approval and completion are substantiated by hooks,
  rollout metadata, and the isolated synthetic file effect instead.
- The probe used the CLI/exec path in a Codex desktop-hosted environment. IDE
  and standalone desktop materialization timing were not compared.
- No retry was forced, so exact completion-to-Turn behavior under a transport
  retry remains unproved even though tools, MCP, nested agents, resume, and
  compaction were covered.
- The local MCP server proves observed MCP use, not the completeness of passive
  MCP capability discovery.
- Sanitized fixtures are test evidence, not a replacement for real capture,
  delivery, persistence, search, inspection, or demonstration paths.
