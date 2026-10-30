# Production investigation interface

The production Loupe web application uses the **Execution map** direction selected in ticket 11. It is an evidence instrument, not a generic dashboard: the Organization activity rail leads into a causal execution topology, a time scanline, and a synchronized evidence inspector.

The implementation consumes only the authenticated `/api/v1` surface. Organization discovery and Session detail use ordinary browser requests, mutations use the annotation and comparison endpoints, and live updates use a credentialed `EventSource` connected to `/api/v1/live`. The web application does not import server or database modules.

## Information architecture

The primary desktop workspace has three synchronized regions:

1. **Organization activity field.** Search, aggregate activity, real or clearly labelled Seeded identity, Session state, repository context, and the comparison tray begin the investigation.
2. **Execution topology.** Root and Subagent routes, exact/inferred/unresolved parent edges, chronological activity, Tools, Token samples, failures, activity episodes, and a time scrubber share one causal map.
3. **Evidence inspector.** Selecting a Session, Agent run, activity, Tool, or Token sample reveals compact facts, input/result evidence, fidelity, Context occupancy, coverage gaps, redaction boundaries, and source-event provenance.

The topology is followed by an always-available non-spatial Agent tree and linear timeline. These are not reduced mobile substitutes: they expose the same selection state and provenance in a semantic reading order. Session annotations and cited comparison results remain below the investigation workspace.

## Primary journeys

### Discover and follow a failure

- Search Organization activity or move between Sessions with `J` and `K`.
- Open a Session from the activity field.
- Select a route or chronological node, or press `F` to select the earliest captured failed Tool.
- The map scanline moves to the Tool, the evidence inspector receives its exact input/result and coverage state, and the linear chronology highlights the same evidence.
- The failure label states what was captured. It does not claim that the Tool caused the human-assigned outcome.

### Inspect hierarchy and fidelity

- Select a Root or Subagent route in the map or semantic Agent tree.
- Parentage is labelled **Exact parent**, **Inferred parent**, or **Unresolved parent** from the API reconciliation evidence.
- Fidelity labels combine stability and derivation. Unavailable evidence remains unavailable; it is never rendered as zero or converted into an exact edge.
- Expand a provenance footnote to read the supporting source-event identifiers.

### Annotate and compare

- A Session owner or Administrator can save outcome, review status, and tags through the annotation endpoint.
- Select Sessions in the activity rail, describe a claim, and run a comparison.
- Classification, completeness, refusal, caveats, real-Turn population, Seeded inclusion, and navigable evidence citations are shown together.

## Accessibility and responsive behavior

- All investigation targets are native buttons with meaningful accessible names and visible focus treatment.
- The Agent hierarchy uses `tree`/`treeitem` semantics and synchronized `aria-selected` state.
- The chronological fallback is an ordered, labelled region with native expandable provenance details.
- `/` focuses Organization search, `J`/`K` changes Session, `F` jumps to the first failed Tool and moves focus to its evidence heading, and arrow keys move the time scanline when the user is not editing a field.
- Status and error messages use live-region semantics. Errors name the failed operation and provide a retry action.
- At narrower widths the Session field becomes a horizontal rail, the evidence inspector becomes a sheet below the map, and the semantic hierarchy/timeline stack in reading order. The map remains horizontally navigable rather than compressing targets below a usable size.
- `prefers-reduced-motion: reduce` disables nonessential motion and smooth scrolling.
- Exact, inferred, unavailable, failed, redacted, Seeded, Example-member, live, resumed, and interrupted states are communicated with text in addition to color and shape.

## Live-update states

- **Connecting:** the authenticated SSE connection has not opened yet.
- **Connected:** live Session updates refresh the Organization population and selected Session through `/api/v1`.
- **Interrupted:** the interface says that live updates are interrupted, performs an ordinary API refresh, and leaves `EventSource` to reconnect.
- **Recovered:** reopening the stream triggers another API refresh so evidence delivered during the interruption appears even if its live event was missed.

The current selected route or evidence target is preserved when the same Session refreshes.

## Deep links

- `?session=<session-id>` opens a Session when it is present in the current Organization activity population.
- `&activity=<source-event-id>` selects the matching chronological activity.
- `&turn=<turn-id>` selects chronological evidence associated with that Turn.
- `&includeSeeded=true` includes Seeded Sessions and keeps their Seeded/Example labels visible.

Opening or changing a Session updates the URL without a navigation. Comparison citations use the browser links returned by `/api/v1`, preserving the server-owned citation format.

## Deliberate differences from the prototype

- Fixture mode was removed. Production never falls back to bundled evidence; deterministic data still enters browser tests through `/api/v1`.
- The prototype inspector became a compact workbench-style evidence drawer with redaction and coverage states.
- Notebook-style numbered provenance became native expandable footnotes beside the linear chronology and inside the inspector.
- The semantic Agent tree and chronological fallback are always rendered, rather than appearing only at narrow widths.
- Session annotations, cited comparison results, bootstrap/invite flows, and capture administration remain part of the authenticated production application.
- Large-graph clustering and virtualization remain deferred until real measurements justify them. The production map uses a horizontally navigable canvas and does not hide long executions behind inferred grouping.

## Browser test boundary

Playwright sets up all captured Session evidence through `/api/v1`. Its primary production assertion opens real Organization activity, selects an unresolved Subagent route, and observes matching state in the topology, evidence inspector, Agent tree, linear timeline, and provenance output. The test also covers bootstrap, authenticated refresh, SSE interruption/recovery, and late evidence delivery without using implementation selectors or pixel snapshots.
