# Analysis CLI and Candidate skills

The Analysis CLI uses a revocable member-owned bearer credential against the same `/api/v1` evidence contracts as the browser. Its fixed scopes are `organization:evidence:read` and `candidate:submit`; an Administrator-owned credential receives no additional authority.

Build it once from the repository root:

```bash
pnpm --filter @workspace/diagnostic-cli build
node apps/diagnostic-cli/dist/cli.js --help
```

The examples below use the package bin name `coding-agent-analysis`. From an
uninstalled checkout, replace that name with
`node apps/diagnostic-cli/dist/cli.js`. There is no published global CLI package
in this repository.

## Create and revoke a credential

Credential management is a human action confirmed in the member's authenticated
browser. The CLI opens the confirmation page, receives only a short-lived,
state-bound grant at a loopback callback, redeems it once, and writes the
plaintext credential directly to an owner-only `0600` file. It never reads the
browser's HttpOnly Session or prints the credential; PostgreSQL stores only its
SHA-256 digest.

```bash
coding-agent-analysis credential create --name "Organization analyst" \
  --server-url http://127.0.0.1:3000 --json

coding-agent-analysis credential status --json
coding-agent-analysis credential revoke --json
```

The default file is `~/.config/loupe/analysis-credential`. Use `--output PATH`
when creating it and `--analysis-credential-file PATH` on later commands to use
a different path. Investigation commands load the default file automatically:

```bash
export CODING_AGENT_OBSERVABILITY_SERVER_URL=http://127.0.0.1:3000
coding-agent-analysis search --query compilation
```

Revocation is immediate and also removes the selected local credential file.
Later requests return the stable `ANALYSIS_CREDENTIAL_REQUIRED` envelope.
Revocation does not delete accepted evidence, previously submitted Candidate
versions, or reviewer history. Existing credential files must be regular files
with mode `0600`; use `-` to read one credential from stdin. Token-valued argv
flags are rejected because other local processes may inspect command arguments.

Cleartext HTTP is accepted only for `localhost`, `127.0.0.1`, and `::1`.
Every remote Analysis endpoint must use HTTPS.

An Analysis credential cannot change Session annotations or retained evidence; approve, publish, pause, or roll back a standard; or call Device capture ingestion. These return `ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN` even when the credential belongs to an Administrator. A Device credential remains separately forbidden from Organization evidence and Candidate submission.

## Investigate evidence

Commands default to human output and accept `--json` for stable contract output:

```bash
coding-agent-analysis search --query compilation --page 1 --page-size 25 --json
coding-agent-analysis inspect SESSION_ID --json
coding-agent-analysis compare SESSION_A:TURN_A SESSION_B:TURN_B \
  --claim "Both Turns used the captured workflow." --json
coding-agent-analysis cite SESSION_ID:TURN_ID:ACTIVITY_UUID --json
coding-agent-analysis watch --json
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
coding-agent-analysis candidate submit candidate.json --json
```

Start from the complete reference manifest at
`skills/analyze-organization-evidence/references/candidate-manifest.md`; do not
submit the reference placeholders unchanged.

The CLI supplies a missing hash by sorting package files by path and hashing the UTF-8 JSON serialization of `{"files":[...]}`. The server independently verifies the hash, resolves every citation inside the credential's Organization, and stores the package, context, uncertainty, claims, citations, submitter, and hash as an immutable version. The response includes stable Candidate/version ids and a reviewer deep link.

Stable rejection codes include `CANDIDATE_PACKAGE_INCOMPLETE`, `CANDIDATE_PACKAGE_INVALID`, `CANDIDATE_CLAIMS_UNCITED`, `CANDIDATE_CITATION_INVALID`, `CANDIDATE_REPEATED_PATTERN_REQUIRES_TWO_REAL_TURNS`, `CANDIDATE_ARTIFACT_HASH_MISMATCH`, and `CANDIDATE_VERSION_EXISTS`. Prose-only submissions are not Candidate skills. Change the version whenever any file changes.
