# Loupe — Validate the Codex capture contract

Type: research
Status: resolved
Assignee: /root (Codex task 019f69c1-f332-70a1-a943-54e204b2d037)

## Question

Which current, documented Codex OpenTelemetry events, lifecycle-hook payloads, local state, and other stable surfaces can capture sessions, turns, model requests, token usage, costs, tools, skills, MCP capabilities, compactions, resumes, and nested subagents—and which required fields are missing, unstable, or only inferable?

## Resolution

Resolved 2026-07-16. The supported passive baseline is user-level Codex OpenTelemetry logs, OpenTelemetry traces, and lifecycle hooks, with every raw signal retained and producer-versioned. This gives documented session/tree and turn identifiers, supported tool payloads, compaction and resume signals, plus provider token usage; release `0.144.5` traces and the source-only `codex.agent_communication` event add exact but unstable turn and parent-edge correlation.

The stable passive contract does not provide a logical model-request or response id, explicit fork event, exact serialized context or per-item context contribution, implicit skill activation, a complete passive capability snapshot, or provider-reported monetary cost. Tool-hook coverage is also incomplete. App-server exposes richer versioned fields only for sessions it hosts, while rollout JSONL and local SQLite remain version-gated compatibility fallbacks rather than stable interfaces.

Research asset: [Codex capture contract: validated surfaces and gaps](../research/codex-capture-contract.md).
