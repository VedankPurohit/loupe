# Mandatory Organization standard synchronization

The relay runs Organization-standard synchronization alongside capture and delivery whenever a Device credential is configured. There is no member opt-out. Distribution control remains an Administrator browser action; the daemon only uses the Device-scoped manifest, artifact, and own-installation-status endpoints.

## Device protocol

The daemon immediately requests `GET /api/v1/device/standards/manifest`, then polls again at the manifest's bounded `pollAfterSeconds` value. Contract validation restricts that interval to 5–300 seconds. The manifest's `targets` array contains every mandatory approved Organization standard. Each target has an independent sequence, `active` or `paused` state, selected release, and previous-release pointer. An empty array is idle. A paused target never downloads or switches content and reports the release that remains installed, while other active targets continue synchronizing.

For each active mandatory target, the daemon:

1. defers and reports `deferred_active_session` if the relay has an active Codex Session;
2. downloads the Device-scoped `artifactUrl` into memory without changing the current installation;
3. validates the artifact contract and identity and recomputes the canonical Candidate-package SHA-256 hash;
4. writes the verified package into a unique `.staging` directory;
5. renames staging into an immutable release directory;
6. atomically renames a temporary symlink over `current`; and
7. posts that target's result to `POST /api/v1/device/standards/installations`.

The artifact URL may be relative to the configured server URL. Authentication is the Device bearer credential on every request. The daemon has no evidence-query, approval, publication, pause, or rollback capability.

## Install namespace and collision policy

Organization content lives below:

```text
<Codex home>/skills/.organization-standards/<standard UUID>/
  current -> versions/<release UUID>
  state.json
  versions/<release UUID>/...
```

This reserved Organization-owned namespace never writes to a member's ordinary `<Codex home>/skills/<skill name>` directory. A same-named personal skill is preserved. Unsafe, absolute, duplicate, and parent-traversing artifact paths are rejected. An unmanaged file or directory at the atomic `current` pointer is treated as a collision, preserved, and reported as `switch_failed`.

Release directories are immutable by release identity and approved hash. Switching to a new release retains the previous working directory. A central rollback is represented by a newer sequence on that standard's manifest target selecting an earlier approved release; the daemon atomically selects that retained or reverified release and reports `rolled_back`. Other standard targets and installations are unaffected. This ticket intentionally performs no garbage collection, so the rollback version cannot disappear before a later retention policy exists.

## Active Session rule

The relay durably records only Session identifiers and last-observed lifecycle time in its local SQLite database. `SessionStart` and subsequent lifecycle activity mark a Session active; matching `Stop`/`SessionEnd` marks it idle. An unclosed record expires after 30 minutes so a relay or Codex crash cannot defer mandatory updates forever. No package download occurs while a Session is active.

## Failure and restart behavior

`download_failed`, `verification_failed`, `staging_failed`, and `switch_failed` reports include a stage, stable code, and message. A failed download or verification occurs before staging. A failed staging or atomic pointer operation does not delete the prior release. Installation status is observable centrally through the Device installation endpoint.

On restart the daemon removes abandoned `.staging` content and reconciles `state.json` from the atomically selected release's `.release.json` marker. This covers interruption before the switch, after the switch but before state persistence, and after successful persistence. Already-installed exact releases are reported without downloading again.
