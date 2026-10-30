# Loupe — Define delivery, ingestion, persistence, and live-query contracts

Type: grilling
Status: superseded
Blocked by: 03, 05

Superseded by: [Implementation 04 — Build the Codex adapter and deliver events reliably](../../coding-agent-observability-implementation/issues/04-deliver-events-to-the-central-store.md), [05 — Project and inspect live execution](../../coding-agent-observability-implementation/issues/05-project-and-inspect-live-execution.md), and [09 — Deliver Organization discovery and search](../../coding-agent-observability-implementation/issues/09-deliver-organization-discovery-and-search.md). Their acceptance criteria now own the delivery, projection, live-query, and explicit Example-data paths.

## Question

What concrete contracts make SQLite-backed relay delivery, authenticated batch ingestion, idempotent PostgreSQL raw-event storage, canonical projection, reprocessing, search, and near-real-time read-only updates reliable and operable, while providing a separate server-controlled ingestion path for explicitly synthetic Example members and Seeded sessions that never impersonates a Device credential or real capture?
