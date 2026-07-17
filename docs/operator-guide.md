# Operator guide

This runbook takes a new operator from an empty checkout to a working Loupe
installation, then covers routine upgrades, backup, capture, analysis, and
Organization-standard distribution. Commands run from the repository root.
Loupe currently represents exactly one Organization per deployment.

Choose one server mode:

- **Native development** runs the API and Vite development server on the host
  and uses a locally installed PostgreSQL. It uses no Docker service.
- **Docker Compose** builds and starts the production API, production web
  application, and PostgreSQL with health checks and a persistent named volume.

Both modes run the same committed Drizzle migrations and expose the same
`/api/v1` contract. Do not run both modes on the same host ports at once.

## Native PostgreSQL development

Prerequisites are Node.js 22.22.3 or newer in the Node 22 line, pnpm 10.28.2,
and PostgreSQL 16 or newer accepting local connections.

```bash
pnpm install --frozen-lockfile
createdb agent_observer_dev
export DATABASE_URL=postgresql://localhost/agent_observer_dev
pnpm dev
```

The API applies pending migrations and listens on `http://127.0.0.1:3000`.
Vite listens on `http://127.0.0.1:5173` and proxies `/api` to the API. The
server prints the initial one-time Bootstrap code. Keep that terminal output
until the code has been redeemed.

Useful checks:

```bash
curl --fail http://127.0.0.1:3000/api/v1/health
curl --fail http://127.0.0.1:3000/api/v1/openapi.json >/tmp/loupe-openapi.json
```

Control-C stops both processes. `dropdb agent_observer_dev` permanently removes
the development database; use it only for a deliberate reset.

## Docker Compose deployment

Prerequisites are Docker Engine with the Compose v2 plugin. From an empty
checkout, one command builds the images and waits for all health checks:

```bash
docker compose up --build --wait
```

Open the production web application at `http://127.0.0.1:8080`. The API is at
`http://127.0.0.1:3000`. Retrieve the generated Bootstrap code from the API
container without printing other container configuration:

```bash
docker compose logs app
```

Treat this startup log as sensitive until the code expires or is redeemed.

PostgreSQL is internal to the Compose network and stores data in the named
volume `postgres-data`. The application uses the same `DATABASE_URL` semantics
as native mode and applies the same migrations before listening.

Routine lifecycle commands are:

```bash
docker compose ps
docker compose restart app
docker compose down
docker compose up --build --wait
```

Restarting `app` or running `docker compose down` preserves PostgreSQL data.
The following is a destructive reset and removes the Organization, credentials,
evidence, projections, Candidates, releases, and installation reports:

```bash
docker compose down --volumes
```

## Configuration reference

`.env.example` lists the native server baseline. Export overrides in the shell,
or create an untracked `.env` for Compose values; never commit real credentials
or database passwords.

| Setting | Mode | Default / meaning |
| --- | --- | --- |
| `DATABASE_URL` | Native/API | Required PostgreSQL connection URL. Compose constructs the equivalent internal URL. |
| `HOST` | Native/API | `127.0.0.1`; Compose sets `0.0.0.0` inside the container. |
| `PORT` | Native/API | `3000` inside the API process. |
| `BOOTSTRAP_CODE` | Both | Optional deterministic automation code. It must be `bootstrap_` plus at least 43 URL-safe characters. Omit it for a generated one-time code. |
| `TEST_DATABASE_ADMIN_URL` | Tests | PostgreSQL administrative URL; defaults to `postgresql://localhost/postgres`. Tests create disposable databases. |
| `WEB_PORT` | Native web / Compose | `5173` for Vite; `8080` for the Compose production web port. |
| `VITE_API_PROXY_TARGET` | Native web | API proxy target; defaults to `http://127.0.0.1:3000`. |
| `APP_PORT` | Compose | Host API port, default `3000`. |
| `POSTGRES_DB` | Compose | Database name, default `agent_observer`. |
| `POSTGRES_USER` | Compose | Database user, default `agent_observer`. |
| `POSTGRES_PASSWORD` | Compose | Database password, default `agent_observer`; change it outside disposable local use. |
| `LOUPE_SERVER_URL` | Analysis CLI | API base URL, default `http://127.0.0.1:3000`. |
| `LOUPE_ANALYSIS_CREDENTIAL` | Analysis CLI | Revocable bearer credential for evidence read and Candidate submission. |
| `LOUPE_BROWSER_SESSION` | Human CLI actions | Value of the authenticated `browser_session` cookie. Treat it as a secret. |
| `CODEX_HOME` | Relay setup | Codex configuration root, default `~/.codex`. |

Host port overrides affect the browser or host-side CLI URL, not the API's
container port. The packaged Compose ports bind to `127.0.0.1` by default.
A network deployment therefore needs an intentional Compose override and an
HTTPS-terminating reverse proxy; enroll devices with the API URL they can reach.
Choose the `POSTGRES_*` identity before the first volume initialization and keep
it stable. Changing those variables later does not rename an existing database
or role inside `postgres-data`.

## Migrations and upgrades

The API runs every committed migration at startup in both modes. An operator
can apply the same migration history explicitly in native mode:

```bash
export DATABASE_URL=postgresql://localhost/agent_observer_dev
pnpm db:migrate
```

Before an upgrade, take a PostgreSQL backup. Then update the checkout and use
the mode-specific sequence:

```bash
# Native
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm --filter @workspace/server start

# Compose
docker compose up --build --wait
```

Do not edit a migration that has already been deployed. Schema changes add and
review a new migration with `pnpm db:generate`. Application restart and upgrade
are expected to preserve the Organization, all credential records, append-only
source events, projections, annotations, Example-pack marker, Candidate history,
releases, and Device installation status.

## Backup, restore, and persistence

PostgreSQL is the authoritative central backup boundary. Back up the entire
database, not individual projection tables: identity, immutable source evidence,
human annotations, Candidate artifacts, releases, and synchronization reports
form one consistent history. The relay's local SQLite file is only the durable
queue for capture not yet acknowledged by the server.

Native custom-format backup and restore:

```bash
pg_dump --format=custom --dbname "$DATABASE_URL" > loupe.dump
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" < loupe.dump
pnpm db:migrate
```

For Compose, first set the values to the same ones used by the deployment:

```bash
export POSTGRES_USER=${POSTGRES_USER:-agent_observer}
export POSTGRES_DB=${POSTGRES_DB:-agent_observer}
docker compose exec -T postgres \
  pg_dump --format=custom --username "$POSTGRES_USER" "$POSTGRES_DB" \
  > loupe.dump
```

Restore while the application is stopped so it cannot write during replacement:

```bash
docker compose stop app
docker compose exec -T postgres \
  pg_restore --clean --if-exists --no-owner \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  < loupe.dump
docker compose up --build --wait
```

Store backups encrypted with access appropriate for Organization-visible prompt
and Tool content. Test restoration on an isolated database before relying on a
backup. A PostgreSQL restore does not restore a Mac relay's pending queue or its
Device credential; keep the relay state directory protected separately if
unacknowledged capture must survive loss of that Mac.

## Bootstrap, members, and devices

On the first empty-database startup, redeem the printed Bootstrap code in the
browser with the Organization name and first Administrator display name. The
code is single-use, expires after 24 hours, and is stored only as a verifier.
An expired unredeemed code is replaced on the next server startup.

An Administrator creates a single-use Invite code in the browser. Invite
redemption creates an ordinary Member and an HttpOnly browser Session; it does
not enroll a Mac. Each signed-in Member separately opens Capture Settings and
creates a ten-minute Device-enrollment grant during relay setup. A Member may
have several devices. Revocation stops that Device credential without deleting
accepted history or changing the Session's original owner.

See [Members, historical ownership, and Git context](members-ownership-and-git-context.md)
and [Device enrollment and capture policy](enrollment-and-redaction.md) for the
full role, ownership, redaction, and revocation contract.

## Codex setup, disconnect, and uninstall

The supported capture target is macOS with Codex `0.144.5`. Build the relay,
preview every change, then explicitly apply it:

```bash
pnpm --filter @workspace/relay build
node packages/relay/dist/cli.js setup \
  --server-url http://127.0.0.1:3000 \
  --browser-session "$LOUPE_BROWSER_SESSION" \
  --device-name "Development Mac"

node packages/relay/dist/cli.js setup \
  --server-url http://127.0.0.1:3000 \
  --browser-session "$LOUPE_BROWSER_SESSION" \
  --device-name "Development Mac" \
  --yes
```

Normal Codex Sessions are captured after setup; no per-Session wrapper is used.
Check the per-user `launchd` service and durable queue without exposing the
Device credential:

```bash
node packages/relay/dist/cli.js status
launchctl print "gui/$(id -u)/org.coding-agent-observability.relay"
```

Disconnect revokes delivery and stops the service while leaving configuration
and local state available. Uninstall removes the service and queue and restores
the exact pre-setup Codex file bytes. Both preserve accepted server history:

```bash
node packages/relay/dist/cli.js disconnect \
  --browser-session "$LOUPE_BROWSER_SESSION"
node packages/relay/dist/cli.js uninstall \
  --browser-session "$LOUPE_BROWSER_SESSION"
```

Read [macOS Codex capture setup](macos-codex-setup.md) before using non-default
`CODEX_HOME` or state directories, testing interruption recovery, or resolving
configuration conflicts.

## Analysis CLI and companion skill

Build the CLI from the checkout. The exact repository-local invocation is shown
below; later examples in behavior-specific documents use its bin name
`loupe-diagnostic` for readability.

```bash
pnpm --filter @workspace/diagnostic-cli build
node apps/diagnostic-cli/dist/cli.js --help
```

A signed-in human creates an Analysis credential with the value of their
browser-session cookie, then uses the returned one-time plaintext token:

```bash
node apps/diagnostic-cli/dist/cli.js credential create \
  --name "Organization analyst" \
  --browser-session "$LOUPE_BROWSER_SESSION" --json

export LOUPE_SERVER_URL=http://127.0.0.1:3000
export LOUPE_ANALYSIS_CREDENTIAL=analysis_REDACTED
node apps/diagnostic-cli/dist/cli.js search --query compilation --json
node apps/diagnostic-cli/dist/cli.js inspect SESSION_ID --json
```

Give a coding agent the repository companion skill at
`skills/analyze-organization-evidence/SKILL.md`. It requires stable citations,
uncertainty, and two distinct real captured Turns before a repeated-pattern
claim. It can submit a complete Candidate skill, but cannot approve, publish,
pause, roll back, annotate, or mutate evidence. See
[Analysis CLI and Candidate skills](analysis-cli-and-candidates.md).

## Organization-standard synchronization

An Administrator reviews the exact immutable Candidate version in the browser.
Approval binds to its SHA-256 artifact hash and publishes a mandatory release.
Every connected relay polls the Device-scoped manifest (normally every 30
seconds), downloads to staging, verifies the same hash, and atomically switches
the Organization-managed `current` pointer. A same-named personal skill is
preserved; the Organization version is effective.

Distribution is deferred while Codex has an active Session. Failures and
deferrals are reported centrally without deleting the last working version.
Administrators use the browser to pause, resume, or roll back to an earlier
approved release; Members and devices cannot opt out or perform those actions.

See [Candidate review and mandatory Organization standards](organization-standards.md)
for human authority and API behavior, and
[Mandatory Organization standard synchronization](standard-sync-daemon.md) for
the daemon filesystem and recovery protocol.

## Troubleshooting

Start at the public boundaries instead of inspecting PostgreSQL tables:

```bash
curl -i http://127.0.0.1:3000/api/v1/health
curl -i http://127.0.0.1:3000/api/v1/openapi.json
docker compose ps                  # Compose only
docker compose logs app postgres   # Compose only
node packages/relay/dist/cli.js status
```

| Symptom | Operator action |
| --- | --- |
| API health is `503 DATABASE_UNAVAILABLE` | Verify `DATABASE_URL`, PostgreSQL health, network/DNS, and credentials; the server does not substitute SQLite. |
| No Bootstrap code in the browser | Read the API startup log. If bootstrap is already complete, sign in with the existing browser Session; startup does not issue a second Administrator. |
| Browser cannot reach `/api/v1` | Verify the API port and the native Vite proxy or Compose web service; then fetch OpenAPI directly. |
| Relay has pending rows | Check server URL, `/api/v1/health`, Device revocation, and relay stderr. Pending rows survive restart and retry. |
| Relay has poisoned rows | Use the stable delivery error in status/logs; fix schema, hash, or deduplication conflict before any future explicit requeue. Do not delete the central event. |
| `DEVICE_CREDENTIAL_SCOPE_FORBIDDEN` | A Device credential was used on a browser/Analysis route. Use the appropriate credential; do not broaden the Device token. |
| `ANALYSIS_CREDENTIAL_REQUIRED` or scope forbidden | Create or replace a non-revoked Analysis credential. Administrator ownership does not add approval scope to it. |
| Setup reports a Codex config conflict | Reconcile the existing `[otel]`, hooks feature, or unsupported `hooks.json` manually, then preview again. Setup never silently overwrites it. |
| Uninstall reports `UNINSTALL_CONFIG_CHANGED` | Preserve the post-setup edit, reconcile it with the private setup backup, and retry. |
| Standard install is deferred or failed | End the active Codex Session or inspect the reported download/verification/staging/switch stage. The previous working release remains active. |

Do not use Seeded Sessions to declare capture, delivery, search, comparison, or
Analysis acceptance. Run `scripts/first-day-checkpoint.sh` with a real Session
for the local capture chain. Run `scripts/docs-validate.sh` after documentation
edits. Known evidence and platform limits are listed in
[Architecture and data model](architecture-and-data-model.md#known-limitations).
