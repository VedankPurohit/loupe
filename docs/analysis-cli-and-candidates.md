# Analysis CLI and Candidate skills

The Analysis CLI uses a revocable member-owned bearer credential against the same `/api/v1` evidence contracts as the browser. Its fixed scopes are `organization:evidence:read` and `candidate:submit`; an Administrator-owned credential receives no additional authority.

Build it once from the repository root:

```bash
pnpm --filter @workspace/diagnostic-cli build
node apps/diagnostic-cli/dist/cli.js --help
```

The examples below use the package bin name `loupe-diagnostic`. From an
uninstalled checkout, replace that name with
`node apps/diagnostic-cli/dist/cli.js`. There is no published global CLI package
in this repository.

## Create and revoke a credential

Credential management is a human action authenticated by the member's browser Session. The plaintext credential is returned only on creation; PostgreSQL stores its SHA-256 digest.

```bash
loupe-diagnostic credential create --name "Organization analyst" \
  --server-url http://127.0.0.1:3000 \
  --browser-session "$LOUPE_BROWSER_SESSION" --json

loupe-diagnostic credential list --json
loupe-diagnostic credential revoke ANALYSIS_CREDENTIAL_ID
```

Set the returned value for investigation commands:

```bash
export LOUPE_SERVER_URL=http://127.0.0.1:3000
export LOUPE_ANALYSIS_CREDENTIAL=analysis_REDACTED
```

Revocation is immediate. Later requests return the stable `ANALYSIS_CREDENTIAL_REQUIRED` envelope. Revocation does not delete accepted evidence, previously submitted Candidate versions, or reviewer history.

`LOUPE_BROWSER_SESSION` is the value of the HttpOnly `browser_session` cookie,
not an Analysis or Device token. Treat it as a secret, keep it out of shell
history where practical, and unset it after credential management.

An Analysis credential cannot change Session annotations or retained evidence; approve, publish, pause, or roll back a standard; or call Device capture ingestion. These return `ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN` even when the credential belongs to an Administrator. A Device credential remains separately forbidden from Organization evidence and Candidate submission.

## Investigate evidence

Commands default to human output and accept `--json` for stable contract output:

```bash
loupe-diagnostic search --query compilation --page 1 --page-size 25 --json
loupe-diagnostic inspect SESSION_ID --json
loupe-diagnostic compare SESSION_A:TURN_A SESSION_B:TURN_B \
  --claim "Both Turns used the captured workflow." --json
loupe-diagnostic cite SESSION_ID:TURN_ID:ACTIVITY_UUID --json
loupe-diagnostic watch --json
```

Search returns explicit `page`, `pageSize`, `total`, `hasMore`, and `nextPage`. It excludes Seeded Sessions by default and reports `syntheticInclusion`; `--include-seeded` is explicit. Inspection preserves stable ids, browser deep links, synthetic designation, evidence stability/derivation, and unavailable values. Comparison returns population and completeness metadata, stable refusal reasons, citation links, and the one-real-Turn versus two-real-Turn classification. `cite` resolves both the Turn and exact retained activity and reports fidelity plus absolute API/browser links. Structured watch output is newline-delimited JSON; `--max-events N` bounds automation.

API errors use `{ "error": { "code", "message" } }`. With `--json`, the CLI writes the same stable envelope to stderr and exits nonzero.

## Submit a complete Candidate

Use the companion skill at `skills/analyze-organization-evidence`. Its Candidate manifest reference shows the complete JSON shape. Each submission must include:

- a lowercase hyphenated Candidate name and immutable semantic version;
- a complete installable package with a root `SKILL.md` whose name matches;
- reviewer context and explicit low/medium/high uncertainty;
- factual claims whose `citationIds` all resolve to submitted Session/Turn/activity citations;
- two distinct real captured Turns for a `repeated_pattern` claim; and
- an exact SHA-256 artifact hash.

```bash
loupe-diagnostic candidate submit candidate.json --json
```

Start from the complete reference manifest at
`skills/analyze-organization-evidence/references/candidate-manifest.md`; do not
submit the reference placeholders unchanged.

The CLI supplies a missing hash by sorting package files by path and hashing the UTF-8 JSON serialization of `{"files":[...]}`. The server independently verifies the hash, resolves every citation inside the credential's Organization, and stores the package, context, uncertainty, claims, citations, submitter, and hash as an immutable version. The response includes stable Candidate/version ids and a reviewer deep link.

Stable rejection codes include `CANDIDATE_PACKAGE_INCOMPLETE`, `CANDIDATE_PACKAGE_INVALID`, `CANDIDATE_CLAIMS_UNCITED`, `CANDIDATE_CITATION_INVALID`, `CANDIDATE_REPEATED_PATTERN_REQUIRES_TWO_REAL_TURNS`, `CANDIDATE_ARTIFACT_HASH_MISMATCH`, and `CANDIDATE_VERSION_EXISTS`. Prose-only submissions are not Candidate skills. Change the version whenever any file changes.
