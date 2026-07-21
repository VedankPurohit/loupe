# Production investigation interface

The production Loupe web application uses the approved **Open Memory evidence-ledger** direction. It is an evidence instrument, not a generic dashboard: Organization activity leads into a Session ledger, then a synchronized evidence inspector that connects each claim to captured provenance and fidelity.

The implementation consumes only the authenticated `/api/v1` surface. Organization discovery and Session detail use ordinary browser requests, mutations use the annotation and comparison endpoints, and live updates use a credentialed `EventSource` connected to `/api/v1/live`. The web application does not import server or database modules.

## Information architecture

The primary desktop workspace has three synchronized regions:

1. **Organization activity.** Search, aggregate activity, real or clearly labelled Seeded identity, Session state, repository context, and the comparison tray begin the investigation.
2. **Session ledger.** The selected Session leads with owner, repository/folder/worktree, branch/commit, activity state, Turn count, model evidence, and compact coverage. Root agent run and Subagent run routes, exact/inferred/unresolved parent edges, chronological activity, Tools, Token samples, failures, and activity episodes remain traceable within the ledger.
3. **Evidence inspector.** Selecting a Session, Agent run, activity, Tool, or Token sample reveals compact facts, input/result evidence, fidelity, Context occupancy, coverage gaps, redaction boundaries, and source-event provenance.

The Session ledger includes a semantic Agent tree and linear Turn timeline. These expose the same selection state and provenance in a readable order rather than acting as reduced mobile substitutes. Token, Context, capability, and coverage evidence follows the selected Turn evidence. Session annotations and cited comparison results remain below the investigation workspace.

## Primary journeys

### Discover and follow a failure

- Search Organization activity or move between Sessions with `J` and `K`.
- Open a Session from Organization activity.
- Select a route or chronological node, or press `F` to select the earliest captured failed Tool.
- The Session ledger focuses the Tool, the evidence inspector receives its exact input/result and coverage state, and the linear chronology highlights the same evidence.
- The failure label states what was captured. It does not claim that the Tool caused the human-assigned outcome.

### Inspect hierarchy and fidelity

- Select a Root agent run or Subagent run route in the Session ledger or semantic Agent tree.
- Parentage is labelled **Exact parent**, **Inferred parent**, or **Unresolved parent** from the API reconciliation evidence.
- Fidelity labels combine stability and derivation. Unavailable evidence remains unavailable; it is never rendered as zero or converted into an exact edge.
- Expand a provenance footnote to read the supporting source-event identifiers.

### Annotate and compare

- A Session owner or Administrator can save outcome, review status, and tags through the annotation endpoint.
- Select Sessions in Organization activity, describe a claim, and run a comparison.
- Classification, completeness, refusal, caveats, real-Turn population, Seeded inclusion, and navigable evidence citations are shown together.

## Accessibility and responsive behavior

- All investigation targets are native buttons with meaningful accessible names and visible focus treatment.
- The Agent hierarchy uses `tree`/`treeitem` semantics and synchronized `aria-selected` state.
- The chronological fallback is an ordered, labelled region with native expandable provenance details.
- `/` focuses Organization search, `J`/`K` changes Session, `F` jumps to the first failed Tool and moves focus to its evidence heading, and arrow keys move the time scanline when the user is not editing a field.
- Status and error messages use live-region semantics. Errors name the failed operation and provide a retry action.
- At narrower widths Organization activity becomes a horizontal list, the evidence inspector moves below the Session ledger, and the semantic hierarchy/timeline stack in reading order. Ledger progression remains horizontally navigable rather than compressing targets below a usable size.
- `prefers-reduced-motion: reduce` disables nonessential motion and smooth scrolling.
- Exact, inferred, unavailable, failed, redacted, Seeded, Example-member, live, resumed, and interrupted states are communicated with text in addition to color and shape.

## Live-update states

- **Connecting:** the authenticated SSE connection has not opened yet.
- **Connected:** live Session updates refresh the Organization population and selected Session through `/api/v1`.
- **Interrupted:** the interface says that live updates are interrupted, performs an ordinary API refresh, and leaves `EventSource` to reconnect.
- **Recovered:** reopening the stream triggers another API refresh so evidence delivered during the interruption appears even if its live event was missed.

The current selected Turn or evidence target is preserved when the same Session refreshes.

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
- Large-Session clustering and virtualization remain deferred until real measurements justify them. The production Session ledger remains horizontally navigable and does not hide long executions behind inferred grouping.

## Browser test boundary

Playwright sets up all captured Session evidence through `/api/v1`. Its primary production assertion opens real Organization activity, selects a Session and an unresolved Subagent run route, and observes matching state in the Session ledger, evidence inspector, Agent tree, Turn timeline, and provenance output. The test also covers authenticated refresh, SSE interruption/recovery, and late evidence delivery without using implementation selectors or pixel snapshots.
