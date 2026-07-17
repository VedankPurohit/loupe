# Diagnostic CLI

`loupe-diagnostic` is a deliberately plain first-day inspector. It reads one
canonical Session from `GET /api/v1/sessions/:id` and prints its Activity
state and episodes, Turns, Root and Subagent runs, evidence strength, and
parent-edge reconciliation. It does not connect to PostgreSQL or import server
implementation code.

## Run it

Build the package, then provide the value of an authenticated member's
`browser_session` cookie. The environment variable keeps the credential out of
the command arguments and is preferred for normal diagnostic use.

```bash
pnpm --filter @workspace/diagnostic-cli build
LOUPE_SERVER_URL=http://127.0.0.1:3000 \
  LOUPE_BROWSER_SESSION='<browser-session-token>' \
  pnpm --filter @workspace/diagnostic-cli diagnostic inspect '<session-id>'
```

The browser Session can come from the supported Bootstrap redemption flow or a
test session. The CLI sends it only as the `browser_session` cookie to the
configured server. A Device credential is intentionally not accepted because
Device scope cannot inspect Organization Sessions.

For isolated development without installing the package bin, run the source
entry point directly:

```bash
pnpm --filter @workspace/diagnostic-cli exec tsx src/cli.ts inspect '<session-id>' \
  --server-url http://127.0.0.1:3000 \
  --browser-session '<browser-session-token>'
```

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
