# Diagnostic CLI

`coding-agent-analysis` is the plain Analysis CLI. It searches, inspects, watches,
compares, and cites canonical evidence through `/api/v1`, and submits complete
Candidate skills. It does not connect to PostgreSQL or import server code.

## Run it

Build the package, create a revocable Analysis credential using an authenticated
browser Session, then keep the returned bearer value in the environment.

```bash
pnpm --filter @workspace/diagnostic-cli build
CODING_AGENT_OBSERVABILITY_BROWSER_SESSION='<browser-session>' \
  pnpm --filter @workspace/diagnostic-cli diagnostic credential create \
  --name "Organization analyst" --json
CODING_AGENT_OBSERVABILITY_SERVER_URL=http://127.0.0.1:3000 \
  CODING_AGENT_OBSERVABILITY_ANALYSIS_CREDENTIAL='<analysis-credential>' \
  pnpm --filter @workspace/diagnostic-cli diagnostic inspect '<session-id>'
```

Browser Sessions are used only to create, list, or revoke the member's Analysis
credentials and to import Administrator Example data. A Device credential is
intentionally not accepted for Organization evidence or Candidate submission.

For isolated development without installing the package bin, run the source
entry point directly:

```bash
pnpm --filter @workspace/diagnostic-cli exec tsx src/cli.ts inspect '<session-id>' \
  --server-url http://127.0.0.1:3000
```

For file-based automation, store either credential in a regular file with mode
`0600` and use `--analysis-credential-file PATH` or
`--browser-session-file PATH`; pass `-` to read one credential from stdin.
Token-valued legacy flags are rejected because process arguments may be visible.
Non-loopback server URLs must use HTTPS.

The command exits `0` on a valid Session response, `1` for HTTP/API/contract
failures, and `2` for invalid arguments. It never treats inactivity, a Stop
event, or an unresolved parent edge as a completed Session.

## Search and explicit Example data

Search Organization activity through the same `/api/v1` PostgreSQL query used
by the browser. Seeded examples stay excluded unless explicitly included:

```bash
pnpm --filter @workspace/diagnostic-cli diagnostic search \
  --query compilation --repository acme/project
pnpm --filter @workspace/diagnostic-cli diagnostic search \
  --include-seeded --page 1 --page-size 25 --json
```

Administrators can explicitly and idempotently load the versioned starter
Example pack through the separate server-controlled path:

```bash
pnpm --filter @workspace/diagnostic-cli diagnostic examples import starter-v1
```

## Compare and cite evidence

Compare complete Sessions by id or individual Turns as `session-id:turn-id`:

```bash
pnpm --filter @workspace/diagnostic-cli diagnostic compare \
  session-a:turn-a session-b:turn-b \
  --claim "The selected Turns used the same workflow."
```

The output names the selected real/Seeded population, completeness, evidence
classification, caveats, stable refusal reason when applicable, and navigable
browser citations. `--include-seeded` is explicit and illustrative only. Use
`--kind outcome`, `--kind causal`, or `--kind productivity` to ask Loupe to
assess those claims; unsupported conclusions are refused rather than inferred
from Tokens, cost, duration, Tool count, model choice, or correlation. Add
`--json` for the stable structured response.

Resolve a citation, watch live discovery events, or submit a Candidate manifest:

```bash
pnpm --filter @workspace/diagnostic-cli diagnostic cite \
  session-a:turn-a:00000000-0000-4000-8000-000000000000 --json
pnpm --filter @workspace/diagnostic-cli diagnostic watch --json
pnpm --filter @workspace/diagnostic-cli diagnostic candidate submit candidate.json --json
```

See [`docs/analysis-cli-and-candidates.md`](../../docs/analysis-cli-and-candidates.md)
for credential scopes, pagination, structured errors, Candidate schema, artifact
hashing, validation errors, and the companion Analysis skill.
