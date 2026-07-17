# Loupe Build Week Demonstration

## What the demonstration proves

Loupe is a real, self-hosted observability and organizational-learning system for coding agents. The demonstration must prove that actual Codex activity can be captured on a developer's Mac, delivered reliably to a locally or remotely deployed server, reconstructed into a useful execution model, inspected live in a browser, and queried by another coding agent through a CLI.

The demonstration is not a remote-control product. It observes, explains, compares, and recommends; it does not steer another person's active agent or computer.

## What must be real

- A native or Docker Compose server backed by PostgreSQL.
- A one-time Codex setup command.
- A macOS relay managed as a restartable `launchd` service.
- SQLite-backed offline delivery and server acknowledgements.
- Codex OpenTelemetry and lifecycle-hook capture.
- Default high-confidence local secret redaction before delivery, preserving redaction type, fingerprint, rule, and source location without the secret value.
- A separately toggled Demo redaction canary that matches only its exact harmless synthetic prefix and is disabled by default.
- A real Codex session with turns, tools, models, token usage, and subagent activity.
- Append-only source-event storage and canonical projection.
- Near-real-time organization and session views.
- Real session search and inspection through the server API.
- A real scoped Analysis CLI that reads organization evidence and submits Candidate skills through that API, without evidence mutation, approval, publication, or deployment authority.
- An analysis skill that teaches a coding agent to query and cite session evidence.
- Mandatory daemon polling and atomic installation of Administrator-approved Organization standards, with observable status and Administrator pause/rollback.

Synthetic fixtures may support automated tests, onboarding, screenshots, or additional example users. They must never replace the real capture, persistence, search, inspection, comparison, or CLI path.

## Primary flow

1. Start the self-hosted server locally through the native PostgreSQL development flow or with one Docker Compose command.
2. Run the one-time Codex setup command. It enrolls the listener, configures supported telemetry and hooks, installs the relay, and verifies delivery. Explicitly enable the Demo redaction canary in Settings for the demonstration.
3. Start a real Codex session that performs useful work, calls supported tools, explicitly mentions or uses a skill, and spawns at least one subagent. Include the exact harmless Demo-canary value in captured content so the real relay can prove substring-only redaction before local or central persistence. A nested subagent should be included if the validated Codex capture contract can reconstruct it reliably.
4. Open the organization view and watch the session appear and update without refreshing or controlling the developer's machine.
5. Open the session detail and inspect its turns, parent-child agent hierarchy, model requests, tools, errors, skills, MCP capabilities, compactions, resumes, source provenance, and redaction evidence at the fidelity Codex actually supports. Verify that the synthetic credential value was not persisted or displayed.
6. Inspect token consumption and context occupancy over time. Show the initial context baseline and annotate skill or MCP evidence, tool failures, retries, compactions, and subagent creation where data is available, without presenting unavailable implicit activation as observed.
7. Diagnose a concrete problem using linked evidence rather than an unexplained score.
8. Search for relevant real historical sessions. If additional seeded users are needed, have an Administrator explicitly load the idempotent Example data pack through the CLI or UI; keep every example clearly identified and excluded from real evidence by default.
9. Give a coding agent the Analysis skill. Let it use the real CLI to query the organization, inspect evidence, compare sessions, and submit a complete Candidate skill with citations and uncertainty.
10. Have an Administrator review the exact immutable artifact in the UI, reject or edit it if necessary, and approve it through a human-only action. Observe every Enrolled daemon poll, download, verify, and atomically install the mandatory release. If time permits, demonstrate Administrator pause or rollback.

## First-day checkpoint

The earliest credible checkpoint is an unbroken real path:

1. One-time setup.
2. Restartable relay.
3. Actual Codex event capture.
4. Reliable delivery.
5. PostgreSQL persistence.
6. Basic canonical session, turn, and agent projection.
7. A browser and CLI that show the captured session.

Polish, deeper analysis, and broader interaction must not come at the cost of this path.

## Remaining hackathon target

- High-fidelity token, context, capability, and failure analysis, with cost shown only as an explicitly versioned estimate.
- A navigable session timeline and agent hierarchy.
- Organization-level live/recent activity, aggregate signals, and search.
- Evidence-backed session comparison and pattern discovery.
- The real analysis CLI and companion skill.
- A Candidate-skill workflow with human review, hash-bound approval, and mandatory daemon synchronization with Administrator pause and rollback.
- Packaged Docker Compose deployment and Docker-free native development.
- Repository-native setup, architecture, deployment, CLI, and troubleshooting documentation.

## Honest limitations

- Every adapter declares what it observes exactly, infers, or cannot capture.
- Unsupported Codex fields are not fabricated.
- Transcript parsing is not treated as a stable primary contract.
- Correlation is not presented as causation.
- Token consumption, context occupancy, and estimated context contribution remain visibly distinct.
- Seeded examples are labelled as examples.
- Sessions are resumable histories; inactivity is not permanent completion.
