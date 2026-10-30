# Chart Loupe, the Codex-first coding-agent observability platform

## Destination

A decision-complete, build-ready specification and sequenced implementation plan for Loupe: a real, open-source, self-hosted Codex observability platform with a working first-day vertical slice and a credible path through the remaining hackathon window.

## Notes

- The domain and agreed product direction live in [`VISION.md`](../../VISION.md), [`DEMO.md`](../../DEMO.md), and [`CONTEXT.md`](../../CONTEXT.md); every session must read them first.
- **Loupe is a temporary working codename and is expected to change.** Use `loupe` only as a provisional repository slug; keep package names and the website domain undecided, and do not encode the codename into durable product identifiers.
- Do not create or publish a remote repository without an explicit later request. When publication is authorized, use the personal GitHub account [`VedankPurohit`](https://github.com/VedankPurohit), never a work account.
- Use `openai-docs` for current Codex capability claims, `domain-modeling` when language changes, `grilling` for human decisions, and `prototype` for capture or interface questions that require something concrete to react to.
- Core ingestion, persistence, search, inspection, and CLI queries must use real captured data. Fixtures are allowed only for tests, onboarding, and UI prototyping.
- Planning may produce the final specification and execution sequence, but product implementation is outside this map.
- Preserve source evidence and explicitly label unsupported, inferred, and exact observations.
- Refer to maps and tickets by their names in human-facing writing.
- Whenever a ticket resolution changes product or demo commitments, reconcile `VISION.md`, `DEMO.md`, and `CONTEXT.md` in the same closeout so the top-level contract does not drift behind the map.

## Decisions so far

<!-- Closed-ticket index. The working vision contains pre-map decisions; resolved ticket answers remain in their ticket files and are linked here. -->

- [Loupe — Validate the Codex capture contract](issues/01-validate-codex-capture-contract.md) — The passive baseline is versioned OTel logs/traces plus user hooks; request, context, cost, skill, capability, and stable parent-edge gaps require explicit inference or compatibility fallbacks.
- [Loupe — Lock the first-day slice and hackathon delivery scope](issues/04-lock-first-day-and-hackathon-scope.md) — Build continuously from a real first-day capture path through rich UI, agent-driven analysis, human-approved immutable Candidate skills, and mandatory daemon synchronization with Administrator pause/rollback; defer other agents, platforms, auth depth, and non-skill interventions.
- [Loupe — Define identity, listener enrollment, and visibility](issues/05-define-identity-enrollment-and-visibility.md) — Use one Organization, Member/Administrator roles, separate browser/analysis/device credentials, narrowly scoped Device reads for own capture policy and approved-standard synchronization, immutable server-assigned Session ownership, organization-visible defaults, explicit Administrator-loaded Example data, and single-use bootstrap/invite enrollment seams.

## Superseded planning tickets

The following Wayfinder questions are preserved as planning history but no longer form a second execution queue. Their implementation successors are the source of truth for status, blockers, tests, and completion:

- [Prove macOS capture, restart recovery, and parentage](issues/02-prove-macos-capture-and-parentage.md) → implementation tickets [02](../coding-agent-observability-implementation/issues/02-enroll-devices-and-control-capture-policy.md), [03](../coding-agent-observability-implementation/issues/03-prove-target-codex-adapter.md), [06](../coding-agent-observability-implementation/issues/06-complete-macos-setup-and-first-day-checkpoint.md), and [07](../coding-agent-observability-implementation/issues/07-support-members-ownership-and-git-context.md).
- [Define the canonical observability model](issues/03-define-canonical-observability-model.md) → implementation tickets [04](../coding-agent-observability-implementation/issues/04-deliver-events-to-the-central-store.md) and [05](../coding-agent-observability-implementation/issues/05-project-and-inspect-live-execution.md).
- [Define delivery, ingestion, persistence, and queries](issues/06-define-delivery-ingestion-and-query-contracts.md) → implementation tickets [04](../coding-agent-observability-implementation/issues/04-deliver-events-to-the-central-store.md), [05](../coding-agent-observability-implementation/issues/05-project-and-inspect-live-execution.md), and [09](../coding-agent-observability-implementation/issues/09-deliver-organization-discovery-and-search.md).
- [Prototype the investigation UI](issues/07-prototype-organization-and-session-ui.md) → implementation tickets [11](../coding-agent-observability-implementation/issues/11-prototype-investigation-interfaces.md) and [12](../coding-agent-observability-implementation/issues/12-implement-selected-interface.md).
- [Define Token, Context, capability, and cost analysis](issues/08-define-token-context-and-cost-analysis.md) → implementation ticket [08](../coding-agent-observability-implementation/issues/08-explain-rich-session-evidence.md).
- [Define search, comparison, and pattern analysis](issues/09-define-search-comparison-and-pattern-analysis.md) → implementation tickets [09](../coding-agent-observability-implementation/issues/09-deliver-organization-discovery-and-search.md) and [10](../coding-agent-observability-implementation/issues/10-compare-sessions-and-enforce-evidence.md).
- [Prototype the Analysis CLI and skill](issues/10-prototype-analysis-cli-and-skill.md) → implementation ticket [13](../coding-agent-observability-implementation/issues/13-deliver-analysis-and-candidate-submission.md).
- [Prove deployment and operator flow](issues/11-prove-deployment-and-operator-flow.md) and [define repository-native documentation](issues/12-define-repository-native-documentation.md) → implementation ticket [15](../coding-agent-observability-implementation/issues/15-package-deployment-and-documentation.md).
- [Synthesize the build-ready specification](issues/13-synthesize-build-ready-specification.md) → completed [specification](spec.md) and [implementation tracker](../coding-agent-observability-implementation/issues/).
- [Define outcome evidence](issues/14-define-outcome-evidence.md) → implementation tickets [09](../coding-agent-observability-implementation/issues/09-deliver-organization-discovery-and-search.md) and [10](../coding-agent-observability-implementation/issues/10-compare-sessions-and-enforce-evidence.md) for the hackathon; broader engineering-outcome connectors remain deferred.

[Content governance](issues/15-define-content-governance.md) deliberately remains open for retention, deletion, export, audit, legal hold, and broader classification controls beyond the resolved hackathon baseline.

## Not yet specified

The only deliberately open Wayfinder question is broader content governance beyond the resolved hackathon baseline. Other post-hackathon product work remains outside this map unless explicitly reopened.


## Out of scope

- Remote control or steering of another person's computer or active coding-agent session.
- Automatic organization-wide publication of generated skills or workflows without administrator approval.
- Automatic grouping of related turns into inferred work units for the initial product.
- A separate background analytics or automatic pattern-mining engine during the hackathon; analysis is agent-driven through the Analysis CLI.
- Non-skill Candidate interventions, including automations, configuration, MCP-specific changes, instructions, and human training.
- Full engineering-outcome connectors, alerting, anomaly detection, budgets, historical backfill, and cross-observability export.
- Agent adapters beyond Codex and relay lifecycle support beyond macOS.
- Full signup/OAuth, role administration, hosted multi-organization operation, billing, and tenant isolation.
- Repository/folder capture scoping and full retention, audit, export, deletion, and legal-hold controls.
- User token, cost, or productivity leaderboards during the hackathon.
- Implementing the product while charting this map.
