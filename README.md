# Loupe

> See inside every agent run.

> [!IMPORTANT]
> **Loupe is a temporary working codename and is expected to change.** Do not treat it as a final brand, register naming-dependent infrastructure without confirmation, or bake it into durable API, database, credential, or deployment identifiers.

Loupe is an open-source, self-hosted observability and organizational-learning platform for coding agents. It captures real Codex Sessions, reconstructs Root and Subagent activity, helps teams diagnose failures and compare effective workflows, and turns cited evidence into human-approved Organization standards.

## Project identity

- **Temporary product and project codename:** Loupe
- **Repository slug:** `loupe`
- **Intended GitHub repository:** `VedankPurohit/loupe`
- **Package namespace:** undecided; the unscoped npm and PyPI name `loupe` is already occupied
- **Website domain:** undecided

The `VedankPurohit/loupe` repository returned no existing project when checked on July 17, 2026. It has not been created or reserved by this repository update. The repository slug may change with the final product name.

## Current status

Loupe is runnable natively with local PostgreSQL or as a packaged Docker Compose deployment. Codex CLI `0.144.5` on macOS is the validated first integration. The repository includes one-time reversible capture setup, a restartable `launchd` relay, pre-persistence redaction, SQLite-backed offline delivery, append-only PostgreSQL source evidence, replayable projections, a production investigation interface, a scoped Analysis CLI and companion skill, human Candidate review, and mandatory Device synchronization of approved standards.

The implementation remains a Build Week prototype with explicit capability limits. Read [Architecture and data model](docs/architecture-and-data-model.md#known-limitations) before treating any inferred or unavailable field as observed evidence.

## Docker Compose quickstart

With Docker Engine and the Compose v2 plugin installed:

```bash
docker compose up --build --wait
docker compose logs app
```

The first command starts the production web application, API, and PostgreSQL with health checks. The second shows the one-time Bootstrap code. Open `http://127.0.0.1:8080`; the API is at `http://127.0.0.1:3000`. PostgreSQL data persists in the `postgres-data` named volume across `docker compose down` and restart. `docker compose down --volumes` is an intentional destructive reset.

See the [Operator guide](docs/operator-guide.md) for configuration, upgrades, backup/restore, bootstrap, capture setup, Analysis, standard synchronization, and troubleshooting.

## Native development quickstart

The native flow uses locally installed PostgreSQL; Docker is neither required nor used.

Prerequisites:

- Node.js 22.22.3 or newer within the Node 22 line
- pnpm 10.28.2 (the workspace pins this version)
- PostgreSQL 16 or newer, accepting local connections

From the repository root:

```bash
pnpm install --frozen-lockfile
createdb agent_observer_dev
export DATABASE_URL=postgresql://localhost/agent_observer_dev
pnpm dev
```

The server runs all pending migrations, starts at `http://127.0.0.1:3000`, and prints a high-entropy, single-use Bootstrap code on the first startup of an empty database. The Vite application starts at `http://127.0.0.1:5173`. Open it, enter the printed code, an Organization name, and your display name. Successful redemption creates the one Organization, its first Administrator, and an HttpOnly browser Session.

The random Bootstrap code is shown only when its verifier is first created and expires after 24 hours. Redeem it before discarding the server output. If it expires before redemption, stop and restart the server: startup retires the expired verifier and prints one new single-use code. The expired code remains unusable. In a multi-process deployment, only the process that creates the replacement prints it, so retain that process's startup output.

For deterministic local automation only, `BOOTSTRAP_CODE` may supply the initial code; production operators should use the generated value. An injected code must start with `bootstrap_` and contain at least 43 URL-safe characters (`A-Z`, `a-z`, `0-9`, `_`, or `-`) after that prefix. Invalid values, including an empty value, stop startup before a verifier is persisted.

To stop development, press Control-C. To remove the disposable development database:

```bash
dropdb agent_observer_dev
```

## Architecture

The pnpm workspace keeps public contracts and persistence boundaries explicit:

| Module | Responsibility |
| --- | --- |
| `apps/server` | Fastify server, versioned routes, browser-session authentication, and Bootstrap orchestration |
| `apps/web` | React/Vite browser application; it uses only `/api/v1` and does not access PostgreSQL |
| `packages/contracts` | Shared Zod request/response schemas used for runtime validation, TypeScript types, and OpenAPI generation |
| `packages/database` | Drizzle PostgreSQL schema, migrations, and migration runner |
| `packages/relay` | Local SQLite capture queue and ordinary/Demo pre-persistence redaction boundary |
| `apps/diagnostic-cli` | Human and structured Analysis CLI for evidence, citations, and Candidate submission |
| `skills/analyze-organization-evidence` | Companion Analysis skill enforcing evidence and uncertainty rules |

One deployment represents exactly one Organization. The initial migration enforces that boundary while retaining Organization identifiers as a future migration seam. Bootstrap credentials use a random salt and scrypt verifier; browser session tokens are also persisted only as digests. Database contents do not contain a redeemable Bootstrap code or browser token.

The full capture, projection, query, and standards-distribution flow plus the table-level domain map are documented in [Architecture and data model](docs/architecture-and-data-model.md).

## API contract

All public HTTP routes live under `/api/v1`. The initial routes are:

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`
- `GET /api/v1/bootstrap/status`
- `POST /api/v1/bootstrap/redeem`
- `GET /api/v1/session`
- `POST /api/v1/session/logout` (revokes the current browser Session and clears its cookie)
- `POST /api/v1/invites` (Administrator browser session only)
- `POST /api/v1/invites/redeem`
- `POST /api/v1/device-enrollment-grants`
- `GET`/`POST /api/v1/device-enrollment/authorize` (browser-confirmed loopback installer hand-off)
- `POST /api/v1/device-enrollments/redeem`
- `GET`/`POST /api/v1/device-disconnect/authorize` (browser-confirmed disconnect)
- `POST /api/v1/device-connection/revoke` (newly Enrolled device self-revocation for failed-setup rollback)
- `GET /api/v1/devices`
- `PATCH /api/v1/devices/:id/capture-policy`
- `POST /api/v1/devices/:id/revoke`
- `GET /api/v1/device/health`
- `GET /api/v1/device/capture-policy`
- `POST /api/v1/device/capture-records`
- `POST /api/v1/device/source-event-batches`
- `GET /api/v1/capture-records/:id` (browser member only)
- `GET /api/v1/source-events/:id` (browser or Analysis evidence reader)
- `GET /api/v1/sessions` and `GET /api/v1/sessions/:id`
- `GET /api/v1/live` (browser-session SSE invalidations)
- `GET /api/v1/organization/activity` (structured/full-text discovery; Seeded excluded by default)
- `POST /api/v1/comparisons` (selected Session/Turn evidence comparisons and stable refusals)
- `POST`/`GET /api/v1/analysis-credentials` and `POST /api/v1/analysis-credentials/:id/revoke`
- `POST`/`GET /api/v1/candidates` (Analysis submission and immutable Candidate history)
- `POST /api/v1/candidates/:candidateId/versions/:versionId/{edit,reject,approve}` (Administrator browser only)
- `GET /api/v1/device/standards/manifest` and approved artifact/install-status routes (Device credential only)
- `GET /api/v1/organization-standards` plus pause, resume, and rollback (Administrator browser only)
- `GET /api/v1/sessions/:id/turns/:turnId` (authorized Turn citation target)
- `GET /api/v1/sessions/:id/activity/:sourceEventId` (authorized activity citation target)
- `PATCH /api/v1/sessions/:id/annotations` (Session owner or Administrator)
- `POST /api/v1/administration/example-packs/starter-v1/import` (Administrator only, explicit and idempotent)

OpenAPI and Fastify runtime validation derive from the same shared Zod schemas. Errors have a stable machine-readable envelope:

```json
{
  "error": {
    "code": "BOOTSTRAP_CODE_ALREADY_REDEEMED",
    "message": "Bootstrap has already been completed."
  }
}
```

Clients must tolerate additive response fields. Breaking contract changes require a new API version rather than an incompatible `/api/v1` change.

See [Analysis CLI and Candidate skills](docs/analysis-cli-and-candidates.md) for scoped credential creation/revocation, structured commands, evidence rules, and immutable Candidate submission.

`GET /api/v1/session` authenticates with the HttpOnly `browser_session` cookie. The cookie name, OpenAPI cookie security scheme, and route security requirement come from the shared contract package. Unknown `/api/v1` routes, malformed JSON, and validation failures also return the stable error envelope instead of Fastify's default response.

Health is database-aware: `GET /api/v1/health` reports `200` only when the PostgreSQL-backed identity store is configured and reachable; otherwise it returns `503 DATABASE_UNAVAILABLE`.

## Database migrations

The development server applies committed Drizzle migrations automatically before listening. Operators can run them independently:

```bash
export DATABASE_URL=postgresql://localhost/agent_observer_dev
pnpm db:migrate
```

When intentionally changing `packages/database/src/schema.ts`, generate and review a migration before running tests:

```bash
pnpm db:generate
pnpm db:migrate
```

Never edit an already-deployed migration; add a new migration so native and Compose deployments share the same upgrade history.

## Emitted server runtime

The build emits runnable JavaScript for the shared contract, database, and server packages. After building, start the production API process under plain Node with the same database and migrations:

```bash
pnpm build
export DATABASE_URL=postgresql://localhost/agent_observer_dev
pnpm --filter @workspace/server start
```

## Testing conventions

The primary deterministic seam is `/api/v1`. Vitest creates disposable real PostgreSQL databases, runs the committed migrations, and asserts through HTTP responses rather than database rows. `TEST_DATABASE_ADMIN_URL` may override the administrative connection; it defaults to `postgresql://localhost/postgres`. Disposable application URLs preserve that connection's host, port, user, password, and query options while replacing only the database name. The Playwright harness honors the same override.

```bash
pnpm test
pnpm typecheck
pnpm build
scripts/docs-validate.sh
```

Playwright covers the critical browser Bootstrap journey against the real server and PostgreSQL migration path. Install its pinned Chromium build once, then run:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright harness owns a disposable `agent_observer_playwright` database, cleans it between runs, and uses `/api/v1`; UI tests do not insert records directly.

The packaged deployment smoke journey requires a running Docker Engine. It uses
a unique Compose project and host ports, starts from empty volumes, bootstraps,
enrolls a Device, ingests and queries a real source event, restarts the API, and
asserts that the same Session and OpenAPI contract remain:

```bash
pnpm test:compose
```

## Documents

- [`VISION.md`](./VISION.md) — product promise, architecture direction, governance, and longer-term opportunity space.
- [`DEMO.md`](./DEMO.md) — the real Build Week demonstration contract.
- [`CONTEXT.md`](./CONTEXT.md) — the shared domain glossary.
- [`docs/operator-guide.md`](./docs/operator-guide.md) — native and Compose operation, configuration, upgrades, backup/restore, bootstrap, capture, Analysis, synchronization, and troubleshooting.
- [`docs/architecture-and-data-model.md`](./docs/architecture-and-data-model.md) — runtime architecture, PostgreSQL model, evidence states, credential scopes, security boundaries, and known limitations.
- [`docs/enrollment-and-redaction.md`](./docs/enrollment-and-redaction.md) — enrollment grants, credential scopes, device Settings, revocation, and ordinary/Demo redaction behavior.
- [`docs/adapter-and-delivery.md`](./docs/adapter-and-delivery.md) — Codex adapter capabilities, immutable source-event envelopes, durable queueing, batch acknowledgements, retries, replay, and delivery troubleshooting.
- [`docs/live-execution.md`](./docs/live-execution.md) — canonical Session/Turn/Agent identities, Activity episodes, replay and reconciliation, query contracts, SSE recovery, and parentage limits.
- [`docs/session-evidence.md`](./docs/session-evidence.md) — Tool and lifecycle coverage, Token categories and Turn association, Context methods, versioned estimated cost, capability gaps, and refusal language.
- [`docs/organization-discovery-and-search.md`](./docs/organization-discovery-and-search.md) — filters, pagination, descriptive aggregates, annotations, deep links, and the explicit Seeded Example-pack boundary.
- [`docs/session-comparisons.md`](./docs/session-comparisons.md) — populations, completeness, citations, real-Turn evidence rules, synthetic inclusion, and unsupported-claim refusals.
- [`docs/organization-standards.md`](./docs/organization-standards.md) — immutable Candidate review, exact-hash approval, Device manifest/artifact scopes, atomic synchronization, failure recovery, pause, rollback, and collision policy.
- [`docs/production-investigation-interface.md`](./docs/production-investigation-interface.md) — selected production interface, synchronized evidence views, accessibility, live recovery, and deep links.
- [`docs/investigation-prototypes.md`](./docs/investigation-prototypes.md) — three working ticket-11 investigation directions, their run commands, evaluation matrix, and screenshot checklist for the user-selection gate.
- [`docs/macos-codex-setup.md`](./docs/macos-codex-setup.md) — setup preview and consent, `launchd`, configuration backup/restore, disconnect, uninstall, recovery, and the executable first-day checkpoint.
- [Continuation Wayfinder map](./.scratch/coding-agent-observability-continuation/map.md) — capture, synthetic-data, UI, identity, and deployment decisions with supporting research.
- [Current specification](./.scratch/coding-agent-observability-local-presentability/spec.md) — normative local-presentability, multi-Organization, authentication, testing, and acceptance strategy.
- [Current implementation tickets](./.scratch/coding-agent-observability-local-presentability/issues/) — 17 tracer-bullet work packages with explicit blockers and public testing seams.

## Publishing guardrail

The local Git repository currently has no remote. Do not create, rename, push, or publish a remote repository without explicit authorization. When publication is authorized, use Vedank Purohit's personal GitHub account, [`VedankPurohit`](https://github.com/VedankPurohit), and do not publish from a work account.
