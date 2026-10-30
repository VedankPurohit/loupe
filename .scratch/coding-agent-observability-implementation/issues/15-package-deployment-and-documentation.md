# 15 — Package deployment and complete operational documentation

**Type:** implementation and documentation

**Required skills:** `implement`, `tdd`

**What to build:** A new operator can run the same application natively against local PostgreSQL or through one Docker Compose command, preserve data across restart, upgrade with the same migrations, and operate every delivered capture, analysis, and standard-synchronization capability using repository-native documentation.

**Blocked by:** 06 — Complete reversible macOS setup and the first-day checkpoint; 12 — Implement the selected polished investigation interface; 13 — Deliver agent-driven analysis and Candidate submission; 14 — Approve and synchronize mandatory Organization standards.

**Status:** complete

**Documentation impact:** Audit and complete the README, architecture, domain model, API/evidence model, native development, Compose deployment, configuration, migrations/upgrades, backup, bootstrap, capture setup/uninstall, Analysis CLI/skill, standard synchronization, security scopes, and troubleshooting material.

**Testing plan:** Run native and Compose smoke journeys from empty state and execute documented commands where practical. The first red deployment test starts Compose with empty volumes, bootstraps, accepts/queries an event, restarts, and retains the same Session.

- [x] One documented Compose command starts the application and PostgreSQL with health checks and persistent volumes.
- [x] The Docker-free native flow uses local PostgreSQL through configuration and requires no Docker service for development, tests, or migrations.
- [x] Native and Compose modes expose the same OpenAPI contract, migration version, bootstrap behavior, credential scopes, and configuration semantics.
- [x] Upgrade and restart preserve Organization, credentials, source events, projections, Candidates, releases, and installation status.
- [x] Every earlier ticket has updated its behavior-specific documentation; this ticket repairs gaps rather than reconstructing undocumented behavior from code.
- [x] A new human or coding agent can follow the documentation without access to the planning conversation.

**Completion note:** `pnpm test:compose` passed twice from empty unique volumes, including generated Bootstrap-code discovery, browser bootstrap, Device enrollment, accepted/queryable SourceEvent and projected Session, production web/API proxy, app restart, persistent authenticated evidence, and byte-equivalent OpenAPI. Targeted native server/web typechecks/builds, production runtime/health tests, default/override Compose config, docs validation, CLI/relay help, and diff hygiene passed. Repository-native operator and architecture/data-model guides cover native/Compose operation, migrations/upgrades, backup, credentials, capture, analysis, standards, troubleshooting, evidence states, and known limitations.
