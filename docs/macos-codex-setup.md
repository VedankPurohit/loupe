# macOS Codex capture setup

The macOS setup is explicit, user-level, and reversible. It configures supported
Codex `0.144.5` lifecycle hooks and OTLP/HTTP JSON export, enrolls this Mac with
the existing Device-enrollment API, and installs the relay as a per-user
`launchd` service. Normal Codex use needs no wrapper after setup.

## Prerequisites and disclosure

- macOS with Codex `0.144.5`, Node.js `22.22.3` or later in the Node 22 line,
  pnpm `10.28.2`, and the Loupe server running.
- An authenticated browser Session for the Organization member who will own the
  Enrolled device. Copy the value of the HttpOnly `browser_session` cookie only
  into the command invocation; do not put it in shell history or a repository.
- Captured prompts, hook payloads, and telemetry are Organization-visible to all
  Organization members.
- Ordinary high-confidence secret redaction is enabled by default. It is
  conservative, not comprehensive. The exact-prefix Demo canary is a separate
  setting and is disabled by default.
- Setup previews the server URL, all affected files, capture visibility,
  redaction defaults, and service installation before it changes anything.

Build the relay CLI, then preview setup:

```bash
pnpm --filter @workspace/relay build
node packages/relay/dist/cli.js setup \
  --server-url http://127.0.0.1:3000 \
  --browser-session "$BROWSER_SESSION" \
  --device-name "Development Mac"
```

The preview does not modify `CODEX_HOME` (default `~/.codex`), the relay state
directory, or `~/Library/LaunchAgents`. Review it, then repeat with `--yes` to
give consent and apply:

```bash
node packages/relay/dist/cli.js setup \
  --server-url http://127.0.0.1:3000 \
  --browser-session "$BROWSER_SESSION" \
  --device-name "Development Mac" \
  --yes
```

For an isolated test, add `--codex-home /tmp/codex-home` and
`--state-dir /tmp/relay-state`. The setup command safely appends a managed OTel
table and merges its commands into supported `hooks.json` event arrays. It
stores exact prior file bytes in a private setup-state backup. An existing OTel
table, explicitly disabled hooks, unsupported hooks JSON, or configuration that
changes between preview and apply is rejected deterministically. It is never
silently overwritten.

The command exchanges a short-lived enrollment grant for a Device credential,
installs `org.coding-agent-observability.relay.plist`, starts it, records a test
event in SQLite, and waits for an authenticated idempotent acknowledgement.
For a Compose deployment, keep the API URL on port `3000` (or the configured
`APP_PORT`); the production browser URL on port `8080` is not the relay endpoint.

## Service lifecycle and health

The plist uses `RunAtLoad` and `KeepAlive`, so the relay starts at login and
`launchd` restarts it after failure. It is not a per-Session wrapper. Inspect
local status without displaying the Device credential:

```bash
node packages/relay/dist/cli.js status
launchctl print "gui/$(id -u)/org.coding-agent-observability.relay"
```

The relay listens only on `127.0.0.1:4318` for Codex OTLP logs/traces. Hooks
record synchronously into the same local SQLite Delivery queue and return
without waiting for the central server. The daemon retries asynchronously with
bounded backoff; accepted or duplicate acknowledgements remove queue rows.
Poisoned evidence stays local and appears in `status`.

To exercise restart behavior without rebooting, kill the PID printed by
`launchctl print`, then confirm a different PID appears. Before a showcase,
also log out and back in once and rerun `status`; this is the manual login-start
check that an automated process should not force on a developer's Mac.

## Disconnect and uninstall

Disconnect revokes the Device credential through the browser-authorized API and
stops the relay. It does not delete already accepted PostgreSQL history:

```bash
node packages/relay/dist/cli.js disconnect \
  --browser-session "$BROWSER_SESSION"
```

Uninstall first disconnects if necessary, unloads and removes the per-user
service, restores the exact prior Codex configuration/hook bytes, and removes
the relay state/SQLite queue. It also preserves server history:

```bash
node packages/relay/dist/cli.js uninstall \
  --browser-session "$BROWSER_SESSION"
```

If either managed Codex file changed after setup, uninstall refuses to overwrite
it and reports `UNINSTALL_CONFIG_CHANGED`. Preserve the reported file, reconcile
the post-setup edit, and retry; the private backup remains available meanwhile.

## First-day checkpoint

1. Start PostgreSQL, the server, and web application with `pnpm dev`.
2. Complete setup and keep the setup-verification acknowledgement.
3. Start an ordinary real Codex Session (no wrapper). Include two Turns, one
   supported successful tool call, a harmless failed command, and a Subagent.
   Exercise an approval if practical; the target-version probe documents that
   approval capture varies by surface.
4. During the Session, stop the central server or unload the relay. Confirm
   `status` shows queued evidence, restart the interrupted component, and wait
   for the queue to drain. The server's immutable idempotency contract makes a
   lost acknowledgement retry a duplicate, not a second source event.
5. Open `http://127.0.0.1:5173`, select the real Session, and confirm live or
   recovered timeline updates. The browser recovers through `/api/v1`; a stream
   interruption is not a Session outcome.
6. Run the executable checkpoint below with the same real Session id. It checks
   `launchd`, the drained SQLite queue, PostgreSQL-backed canonical Session
   inspection, the browser origin, and the existing diagnostic CLI.

```bash
SESSION_ID=the-real-session-id \
BROWSER_SESSION="$BROWSER_SESSION" \
scripts/first-day-checkpoint.sh
```

The script does not create Seeded evidence or inspect PostgreSQL directly. A
missing real capture, pending queue, stopped service, unavailable browser, or
missing canonical Session fails the checkpoint rather than substituting a
fixture.

## Troubleshooting

- `ENROLLMENT_*`: verify the server URL and browser Session, then preview again.
- `SETUP_VERIFICATION_FAILED`: inspect relay stderr and `/api/v1/health`; the
  local event remains durable for retry.
- `DELIVERY_HTTP_401` or `DEVICE_DISCONNECTED`: the Device credential was
  revoked; re-enroll explicitly rather than copying another credential.
- `EADDRINUSE` on port 4318: another OTLP receiver is configured. Setup rejects
  an existing `[otel]` table so this must be reconciled deliberately.
- `launchctl` failure: inspect the plist and relay stderr under the state
  directory, then use `launchctl bootout`/`bootstrap` as shown above.
- Node's built-in SQLite API is still experimental. This is a packaging risk,
  not a loss-of-durability fallback; PostgreSQL remains the only Central store.
