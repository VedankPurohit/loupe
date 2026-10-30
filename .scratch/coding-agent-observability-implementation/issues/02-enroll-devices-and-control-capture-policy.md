# 02 — Enroll devices and control capture policy

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** An authenticated Organization member can authorize one Mac, exchange a short-lived grant for a revocable Device credential, inspect the Enrolled device, and control only that device's capture policy without granting the relay general Organization access.

**Blocked by:** 01 — Establish the runnable product and Organization bootstrap.

**Status:** complete

**Documentation impact:** Document enrollment, credential scopes, revocation, per-device Settings, ordinary redaction, and the Demo redaction canary.

**Testing plan:** Exercise enrollment and Settings through `/api/v1`, then run the relay's public redaction interface against temporary SQLite and the server. The first red test proves a grant is single-use and the resulting Device credential can read its own policy but cannot query Organization Sessions.

- [x] A browser-authenticated member can create and redeem a short-lived, single-use device-enrollment grant.
- [x] The resulting Device credential is independently revocable and cannot browse Organization evidence, submit Candidates, or exercise Administrator actions.
- [x] Ordinary high-confidence redaction is enabled by default and replaces only matching secret substrings before SQLite or PostgreSQL persistence.
- [x] Surrounding prompt and tool content remains intact and redaction evidence contains type, keyed fingerprint, rule, and source location without the secret.
- [x] The separately toggled Demo redaction canary is disabled by default and matches only its exact harmless synthetic prefix.
- [x] Device health and the effective capture-policy version are visible to the member through the browser and API.

**Completion note:** Verified with `pnpm test` (18 server/relay tests), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (2 browser journeys), and `git diff --check`. Tests use real PostgreSQL and temporary SQLite and confirm tested secret values are absent from both stores. Capability limits: ordinary detection intentionally begins with conservative OpenAI/GitHub patterns; Node 22's built-in SQLite API remains experimental; full batch acknowledgement and replay behavior belongs to ticket 04.
