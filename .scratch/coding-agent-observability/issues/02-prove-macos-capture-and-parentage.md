# Loupe — Prove macOS capture, restart recovery, and agent parentage

Type: prototype
Status: superseded
Blocked by: 01

Superseded by: [Implementation 02 — Enroll devices and control capture policy](../../coding-agent-observability-implementation/issues/02-enroll-devices-and-control-capture-policy.md), [03 — Probe the target-version Codex capture contract](../../coding-agent-observability-implementation/issues/03-prove-target-codex-adapter.md), [06 — Complete reversible macOS setup and the first-day checkpoint](../../coding-agent-observability-implementation/issues/06-complete-macos-setup-and-first-day-checkpoint.md), and [07 — Support Members, ownership, and Git context](../../coding-agent-observability-implementation/issues/07-support-members-ownership-and-git-context.md). This planning question remains historical context; execution and validation now belong to those tickets.

## Question

Can a reversible one-time setup install a macOS `launchd` relay, configure Codex telemetry and hooks, survive process and machine restarts, capture a real multi-turn session with nested subagents, reconstruct every supported parent-child edge without fabricating missing relationships, verify default local secret redaction before delivery, and capture repository/remote/branch/worktree/commit context with explicit source, sampling time, and confidence rather than attributing later git state to an earlier event?
