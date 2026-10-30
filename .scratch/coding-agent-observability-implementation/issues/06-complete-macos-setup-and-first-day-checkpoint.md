# 06 — Complete reversible macOS setup and the first-day checkpoint

**Type:** implementation and verification

**Required skills:** `implement`, `tdd`

**What to build:** One explicit Codex setup flow safely previews and applies user-level capture configuration, installs a restartable per-user `launchd` relay, verifies a test event, and can disconnect or uninstall cleanly; the complete first-day path then passes after a real interruption.

**Blocked by:** 04 — Build the Codex adapter and deliver events reliably; 05 — Project and inspect live execution.

**Status:** complete

**Documentation impact:** Document prerequisites, preview and consent, existing-config merge/backup, service lifecycle, configurable server URL, verification, disconnect, uninstall, recovery, and the first-day runbook.

**Testing plan:** Test setup against an isolated Codex home and service-manager boundary, then run a real macOS `launchd` acceptance probe. The first red test previews an existing configuration without modifying it and proves that apply followed by uninstall restores the prior state.

- [x] Setup discloses Organization-visible capture, server URL, ordinary redaction default, Demo-canary default, files/configuration affected, and service installation before applying changes.
- [x] Existing supported Codex configuration and hooks are merged or rejected safely with backup and deterministic restoration.
- [x] `launchd` starts the relay at login and restarts it after process failure without requiring a per-Session wrapper.
- [x] Disconnect revokes delivery without deleting server history; uninstall additionally removes the installed service and capture changes.
- [x] A real relay/server interruption recovers every accepted event exactly once.
- [x] The first-day acceptance journey proves setup, real capture, SQLite durability, PostgreSQL persistence, canonical inspection, browser updates, and CLI inspection.

**Completion note:** Real macOS acceptance passed with `codex-cli 0.144.5`: one Session produced four Turns, two Agent runs including a default Subagent, three startup/resume episodes, and eleven Tool records. A retained queued event was accepted, retried after launchd restart, acknowledged as `duplicate`, and drained exactly once; the checkpoint, browser-authenticated API query, production web origin, and diagnostic CLI passed. Disconnect/uninstall restored the original `~/.codex/config.toml` byte-for-byte (SHA-256 `b8432e…8639`, mode `0600`) and removed hooks, state, plist, job, database, ports, and temporary files. Physical logout/login remains a documented manual pre-showcase check; a transient SQLite lock succeeded on immediate retry and is retained for later concurrency hardening.
