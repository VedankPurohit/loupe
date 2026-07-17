# Browser Session inspector

The deliberately plain Session inspector is an authenticated browser consumer of the
versioned HTTP interface. It does not read PostgreSQL or maintain a browser-only
execution model.

## Query and live behavior

- `GET /api/v1/sessions` discovers canonical Sessions.
- `GET /api/v1/sessions/:id` supplies the selected Session, Activity episodes,
  Turns, Agent runs, parent edges, and chronological timeline.
- `GET /api/v1/live` is authenticated by the HttpOnly browser-session cookie.
  Its `session.updated` events are invalidations, not a second source of execution
  state. The inspector queries again after each invalidation.
- The browser's `EventSource` reconnects after interruption. Every successful
  connection performs an ordinary list/detail query, so updates missed while
  disconnected are recovered without treating disconnection as a Session outcome.

## Evidence display

The inspector keeps the API distinctions visible:

- Evidence stability (`documented`, `observed`, `inferred`, `unstable`, or
  `unavailable`) is shown beside its derivation (`exact`, `inferred`, or
  `unavailable`).
- Exact, inferred, and unresolved parent edges have different text and styling.
  An unresolved edge remains outside a fabricated complete hierarchy.
- Parent and ownership reconciliation show the named rule and confidence returned
  by the API.
- Live, idle, and resumed are Activity states. Permanent completion is explicitly
  not assumed.
- Tool input/result, duration, outcome, approval, retry, identifier, and coverage
  fields are shown independently; unavailable is never rendered as zero or no
  activity.
- Provider Token categories are tabular and separate from the explicitly
  inferred Context occupancy and first-request baseline. The inspector does not
  render an unsupported Context-composition chart.
- Cost cards always carry estimate/unavailable state, price-table metadata,
  model mapping, inputs, and billing caveat from `/api/v1`.
- Compaction, resume, version-gated fork, explicit/inferred Skill evidence,
  configured/used MCP evidence, and unavailable implicit/passive inventory
  capabilities remain distinct.
