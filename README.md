# Loupe

> See inside every agent run.

> [!IMPORTANT]
> **Loupe is a temporary working codename and is expected to change.** Do not treat it as a final brand, register naming-dependent infrastructure without confirmation, or bake it into durable API, database, credential, or deployment identifiers.

Loupe is a planned open-source, self-hosted observability and organizational-learning platform for coding agents. It captures real agent sessions, reconstructs agent and subagent activity, helps teams diagnose failures and compare effective workflows, and turns evidence into human-approved organization standards.

## Project identity

- **Temporary product and project codename:** Loupe
- **Repository slug:** `loupe`
- **Intended GitHub repository:** `VedankPurohit/loupe`
- **Package namespace:** undecided; the unscoped npm and PyPI name `loupe` is already occupied
- **Website domain:** undecided

The `VedankPurohit/loupe` repository returned no existing project when checked on July 17, 2026. It has not been created or reserved by this repository update. The repository slug may change with the final product name.

## Current status

Loupe has a build-ready specification and a 16-ticket local implementation plan. Codex on macOS is the first planned live integration. The implementation must prove a real path from one-time setup through local capture, durable delivery, PostgreSQL persistence, near-real-time browser inspection, and scoped agent analysis.

The runnable TypeScript workspace, PostgreSQL schema, versioned server API, React application, first-Administrator Bootstrap journey, scoped device enrollment, capture Settings, and local pre-persistence redaction are now established. The capture adapter and full delivery/projection pipeline follow in later implementation tickets.

## Native development quickstart

The native flow uses locally installed PostgreSQL; Docker is neither required nor used.

Prerequisites:

- Node.js 22.22.3 or newer within the Node 22 line
- pnpm 10.28.2 (the workspace pins this version)
- PostgreSQL 16 or newer, accepting local connections

From the repository root:

```bash
pnpm install
createdb agent_observer_dev
export DATABASE_URL=postgresql://localhost/agent_observer_dev
pnpm dev
```

The server runs all pending migrations, starts at `http://127.0.0.1:3000`, and prints a high-entropy, single-use Bootstrap code on the first startup of an empty database. The Vite application starts at `http://127.0.0.1:5173`. Open it, enter the printed code, an Organization name, and your display name. Successful redemption creates the one Organization, its first Administrator, and an HttpOnly browser session.

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

One deployment represents exactly one Organization. The initial migration enforces that boundary while retaining Organization identifiers as a future migration seam. Bootstrap credentials use a random salt and scrypt verifier; browser session tokens are also persisted only as digests. Database contents do not contain a redeemable Bootstrap code or browser token.

## API contract

All public HTTP routes live under `/api/v1`. The initial routes are:

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`
- `GET /api/v1/bootstrap/status`
- `POST /api/v1/bootstrap/redeem`
- `GET /api/v1/session`
- `POST /api/v1/invites` (Administrator browser session only)
- `POST /api/v1/invites/redeem`
- `POST /api/v1/device-enrollment-grants`
- `POST /api/v1/device-enrollments/redeem`
- `GET /api/v1/devices`
- `PATCH /api/v1/devices/:id/capture-policy`
- `POST /api/v1/devices/:id/revoke`
- `GET /api/v1/device/health`
- `GET /api/v1/device/capture-policy`
- `POST /api/v1/device/capture-records`
- `GET /api/v1/capture-records/:id` (browser member only)

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

Never edit an already-deployed migration; add a new migration so native and future packaged deployments share the same upgrade history.

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
```

Playwright covers the critical browser Bootstrap journey against the real server and PostgreSQL migration path. Install its pinned Chromium build once, then run:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright harness owns a disposable `agent_observer_playwright` database, cleans it between runs, and uses `/api/v1`; UI tests do not insert records directly.

## Documents

- [`VISION.md`](./VISION.md) — product promise, architecture direction, governance, and longer-term opportunity space.
- [`DEMO.md`](./DEMO.md) — the real Build Week demonstration contract.
- [`CONTEXT.md`](./CONTEXT.md) — the shared domain glossary.
- [`docs/enrollment-and-redaction.md`](./docs/enrollment-and-redaction.md) — enrollment grants, credential scopes, device Settings, revocation, and ordinary/Demo redaction behavior.
- [`docs/adapter-and-delivery.md`](./docs/adapter-and-delivery.md) — Codex adapter capabilities, immutable source-event envelopes, durable queueing, batch acknowledgements, retries, replay, and delivery troubleshooting.
- [`docs/live-execution.md`](./docs/live-execution.md) — canonical Session/Turn/Agent identities, Activity episodes, replay and reconciliation, query contracts, SSE recovery, and parentage limits.
- [Wayfinder map](./.scratch/coding-agent-observability/map.md) — decisions, validation frontier, and scope boundaries.
- [Build-ready specification](./.scratch/coding-agent-observability/spec.md) — normative product, architecture, testing, and acceptance strategy.
- [Implementation tickets](./.scratch/coding-agent-observability-implementation/issues/) — 16 typed, test-planned work packages with explicit blockers and documentation obligations.
- [Visual build route](./.scratch/coding-agent-observability-implementation/roadmap.html) — interactive overview of phases, checkpoints, ticket dependencies, and scope boundaries.

## Publishing guardrail

The local Git repository currently has no remote. Do not create, rename, push, or publish a remote repository without explicit authorization. When publication is authorized, use Vedank Purohit's personal GitHub account, [`VedankPurohit`](https://github.com/VedankPurohit), and do not publish from a work account.
