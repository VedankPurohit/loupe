# Organization discovery and search

`GET /api/v1/organization/activity` is the shared browser/CLI discovery seam.
It queries PostgreSQL and returns stable Session ids, owner and repository
labels, human annotations, explicit pagination, descriptive aggregates, and a
navigable browser deep link. It never returns a productivity score or ranking.

## Filters and pagination

The query accepts `q` for PostgreSQL full-text search plus structured `from`,
`to`, `memberId`, `repository`, `activityState`, `outcome`, `reviewStatus`,
`tag`, `model`, `tool`, `capability`, and `error` filters. Model, Tool,
capability, and error filters only match retained captured evidence. `page`
starts at 1 and `pageSize` defaults to 25 with a maximum of 100. Results use a
stable `lastObservedAt`/Session-id order; the response always returns `total`,
`hasMore`, and `nextPage`.

`activityState` is the derived `live`, `idle`, or `resumed` projection and is
not a permanent outcome. Aggregates are descriptive counts over the complete
filtered population before pagination: Sessions, distinct Members, distinct
repositories, Activity states, and human outcomes. Member and repository
facets expose counts, never a leaderboard.

## Human annotations

`PATCH /api/v1/sessions/:id/annotations` accepts an outcome (`successful`,
`partial`, `failed`, or `unknown`), review status (`exemplar`, `needs_help`, or
`ordinary`), and free-form tags. A real Session owner or any Administrator may
write these fields. Other Members receive the stable
`SESSION_ANNOTATION_FORBIDDEN` error. Annotations are stored separately from
the rebuildable execution projection so later delivery cannot erase them.

## Example data boundary

Nothing is seeded during startup. An Administrator must explicitly call
`POST /api/v1/administration/example-packs/starter-v1/import`, use the browser
action, or run:

```bash
loupe-diagnostic examples import starter-v1 \
  --server-url http://127.0.0.1:3000 \
  --browser-session "$LOUPE_BROWSER_SESSION"
```

The versioned operation is idempotent and uses a server-controlled transaction,
not the Device delivery or source-event path. It creates only a permanently
designated Example member and Seeded Session; the Seeded Session has no Device
owner and therefore cannot impersonate real capture.

Seeded Sessions are excluded from activity, search, facets, and aggregates by
default. `includeSeeded=true` is the only inclusion switch, and the response
reports `syntheticInclusion: "included"`. Every included record carries
`synthetic.kind = "seeded"`, `examplePackVersion`, an Example owner label, and
a deep link that preserves explicit inclusion. Session detail preserves the
same designation.

## CLI search

The plain CLI uses the same route and supports human or structured output:

```bash
loupe-diagnostic search --query compilation --repository acme/project
loupe-diagnostic search --include-seeded --page 2 --page-size 10 --json
```

Use `--member`, `--outcome`, `--review-status`, `--tag`, `--model`, `--tool`,
`--capability`, or `--error` for structured filters. API validation,
authentication, authorization, and not-found failures retain the stable
machine-readable `/api/v1` error envelope.
