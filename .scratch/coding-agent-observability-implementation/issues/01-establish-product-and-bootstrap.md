# 01 — Establish the runnable product and Organization bootstrap

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** A contributor can start the TypeScript/pnpm product against PostgreSQL, open the React application, redeem the server's single-use Bootstrap code, and become the first authenticated Administrator through the versioned HTTP interface.

**Blocked by:** None — can start immediately.

**Status:** complete

**Documentation impact:** Establish and verify the native-development quickstart, architecture overview, API-contract conventions, migration workflow, and testing conventions.

**Testing plan:** Use `/api/v1` as the primary seam with real PostgreSQL migrations and Playwright for bootstrap. The first red test requests server health and the generated API description, then proves that redeeming one Bootstrap code creates exactly one authenticated Administrator and that reuse is rejected.

- [x] A pnpm-managed TypeScript workspace starts the Fastify server and React/Vite application through the documented native flow.
- [x] Drizzle migrations create the initial PostgreSQL schema from an empty database.
- [x] `/api/v1` is runtime-validated with Zod and described by OpenAPI without contract drift.
- [x] First startup exposes a single-use Bootstrap code whose stored form cannot be redeemed from database disclosure alone.
- [x] Redeeming the code creates the one Organization, first Administrator, and browser session; a second redemption fails with a stable error.
- [x] Vitest and Playwright run through documented commands and cover the vertical bootstrap journey.

**Completion note:** Independently verified with `pnpm test` (13 tests), `pnpm typecheck`, `pnpm build`, and a non-default-PostgreSQL `pnpm test:e2e` run (2 browser tests) that left no disposable database behind. The emitted server and migrations run under plain Node; Bootstrap expiry recovery, concurrent single use, stable API errors, verifier-only credential storage, OpenAPI cookie authentication, and real database health behavior are covered. No capability downgrade was required.
