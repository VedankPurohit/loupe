# Ticket 16 hackathon demonstration evidence

Run date: 2026-07-17 (Asia/Kolkata)  
Baseline: `9b094fb`  
Deployment: disposable Docker Compose project `loupe-ticket16-47089`  
API / production web: `http://127.0.0.1:3316` / `http://127.0.0.1:8116`

This report contains sanitized identifiers and counts only. Credentials and the
exact Demo-canary values were never copied into this repository. Seeded content
was not loaded and did not satisfy any claim.

## Result

The real capture-to-standard loop passed through Compose, Bootstrap, two Device
enrollments, reversible macOS setup, target `codex-cli 0.144.5`, offline SQLite
delivery, PostgreSQL projection, production browser, Analysis CLI, cited
Candidate submission, exact-hash Administrator approval, two isolated install
destinations, active-Session deferral, atomic installation, and pause/resume.

The run found and repaired one real relay defect: setup verification opened a
synthetic active Session without closing it, which deferred mandatory standards
for 30 minutes. The retained regression exercises the relay runtime seam and
requires setup verification to enqueue matching `SessionStart` and `Stop`
events while leaving no active Session.

## Sanitized evidence ledger

- Organization: `4add7097-5639-4700-bdab-81ab8cd708d0`.
- Primary Device: `2f1551a5-5dee-4d93-9e8c-45cb8bd60dad`.
- Secondary Device: `e1bd133e-cdc1-4247-98f2-cac45c634004`.
- Real Session: `019f708c-df6b-73a3-b52c-77f70e7c0a4a`.
- Canonical execution: 3 Activity episodes, 4 Turns, 2 Agent runs, 1 default
  Subagent, 13 Tool records, and 2 resumes.
- Root Turn ids used for the repeated-pattern claim:
  `019f7091-0b62-75f0-96c8-cd88b5e3bac1` and
  `019f7096-1eb1-7603-99d7-59f243ce68b2`.
- Exact real citation activity ids:
  `a03499e1-17ad-451b-aa66-9a770a25c03a` and
  `b8cbbe38-044f-4a3a-96c0-b841b1d8abe0`.
- Candidate: `577f1b91-5259-49b3-8c86-2b33d2b2ab79`, immutable version
  `6ecc6815-096c-47c3-8fd4-3a7814681b69`.
- Standard: `67b98388-87e4-4e81-9a8b-1d0cd13c44b4`, release
  `41ff62ba-f550-4775-a5de-c2a25fd49e54`.
- Approved artifact hash:
  `sha256:0cd2b4e85a34c02aad08b2aec1250d80d78d7b9070e9d5cdadc7c1376a173dba`.

## Acceptance observations

| Boundary | Evidence |
| --- | --- |
| Deployment | Compose built production API/web images; PostgreSQL, API, and web health checks passed; Bootstrap was redeemed once. |
| Setup | Preview was non-mutating. Apply installed and started the per-user `launchd` relay and acknowledged its test delivery. Demo canary was explicitly changed from policy v1 disabled to policy v2 enabled. |
| Target producer | The repository-local invocation reported `codex-cli 0.144.5`; the global `codex` remained untouched at `0.139.0`. No model override was supplied. |
| Real work | Root Tool evidence includes successful `/bin/pwd`, intentional exit 7, companion-skill file access, MCP resource listing, and one default Subagent. |
| Redaction before SQLite | With the API stopped, SQLite held 15 pending events: exact raw canary 0, surrounding phrase 1, typed redaction evidence 1. |
| Replay and PostgreSQL | API restart drained pending events to 0. PostgreSQL then reported exact raw canary 0, surrounding phrase 1, typed redaction evidence 1. |
| Search and comparison | Analysis CLI search returned 1 matching real Session with Seeded excluded. Comparison reported `repeated_pattern`, 2 distinct real Turns, 0 Seeded Turns, and 2 exact citations. |
| Candidate review | The public Administrator API returned the complete one-file package, 2 citations, medium uncertainty, and exact hash. A wrong hash returned `409 CANDIDATE_APPROVAL_HASH_MISMATCH`; the exact hash produced the mandatory immutable release. |
| Distribution | The secondary destination first reported `deferred_active_session`, then installed atomically. After the setup-lifecycle fix, the real primary launchd daemon installed the same release and hash. Both `current` links targeted `versions/41ff62ba-f550-4775-a5de-c2a25fd49e54`. |
| Distribution control | Administrator pause returned 204; a Device poll observed `paused`, reported `idle`, and retained the installed release. Resume returned 204 and restored an active manifest targeting the same release. |
| First-day checkpoint | Passed with running service, drained SQLite, PostgreSQL/API query, production web origin, 4 Turns, and 2 Agent runs. |

## Production-browser recording checklist

- [x] Open the real Session deep link and show the exact Session id and real owner.
- [x] Show Root and default Subagent hierarchy.
- [x] Show Tool and redaction evidence without displaying the canary.
- [x] Show the Candidate exact hash and approved state.
- [x] Capture a full-page Session screenshot.
- [x] Capture a full-page Candidate screenshot.
- [ ] For a live presentation, zoom into the failed exit-7 Tool and the two
  resumed Turns so the fidelity labels remain readable on the projector.

Screenshots:

- `docs/demo/ticket-16-production-session.png`
- `docs/demo/ticket-16-production-candidate.png`

## Honest target-version limitations

- Loupe projected zero Token-usage records for this Session even though Codex's
  own structured completion output reported usage. The UI/CLI therefore show
  Token evidence as unavailable; no chart or cost estimate was fabricated.
- Exact Context composition and contribution remain unavailable. Context
  contribution is explicitly `unavailable` with the documented passive-capture
  limitation.
- Session Git context was unavailable for this capture even though the Codex
  process ran inside a Git checkout.
- Subagent parentage is inferred with medium confidence from one defensible hook
  parent, not claimed exact.
- Skill-file access is inferred evidence of access, not proof the workflow was
  followed. Implicit skill activation remains unavailable.
- A generic MCP resource-list Tool was captured, but the passive capability
  summary still reports configured MCP inventory and observed MCP use as
  unavailable.
- Compaction, approval, and fork were not forced during this run. Two resume
  episodes were captured exactly. The documented target-version probe remains
  the evidence for conditional compaction/fork/approval surfaces.
- `codex-cli 0.144.5` logged a nonfatal incompatibility parsing the current
  model-list response and the repository-required `rtk` wrapper was absent.
  Neither prevented the real Turn.

## Cleanup and recovery proof

- Analysis credential and secondary Device credential were revoked before the
  database was destroyed. Primary Device revocation occurred during uninstall.
- Uninstall removed `hooks.json`, relay setup state, SQLite, the LaunchAgent,
  launchd job, and the listener on port 4318.
- The exact Session rollout file containing local producer content was removed.
- Both Organization-standard install destinations were removed.
- Compose removed all three containers, its network, and its PostgreSQL volume.
- `~/.codex/config.toml` remains mode `0600` and contains zero Loupe managed
  OTel markers. Its final SHA-256 is
  `7cc70dffcf530b576d2da82afcf444e978cc0ff5748f2eff174d2b3b87dae017`.
  The pre-setup hash was
  `b8432e2a754d0a4851e4c8f30eed5e9351b05d7209e856a96ee63d6eabb98639`;
  byte identity was intentionally not forced because target Codex wrote its own
  approval/plugin metadata during the real run. Uninstall first refused with
  `UNINSTALL_CONFIG_CHANGED`; cleanup preserved those Codex changes while
  removing only Loupe's exact managed block.

## Reproduction commands

Use fresh credentials and a new harmless canary; never paste credential values
or the canary into a committed file.

```bash
APP_PORT=3316 WEB_PORT=8116 docker compose --project-name loupe-ticket16 up --build --wait
pnpm --filter @workspace/relay build
node packages/relay/dist/cli.js setup --server-url http://127.0.0.1:3316
CODING_AGENT_OBSERVABILITY_BROWSER_SESSION="$BROWSER_SESSION" node packages/relay/dist/cli.js setup --server-url http://127.0.0.1:3316 --yes
npx -y @openai/codex@0.144.5 exec --json --dangerously-bypass-hook-trust "<harmless demo prompt>"
SERVER_URL=http://127.0.0.1:3316 WEB_URL=http://127.0.0.1:8116 SESSION_ID="$SESSION_ID" BROWSER_SESSION="$BROWSER_SESSION" scripts/first-day-checkpoint.sh
pnpm --filter @workspace/relay test -- runtime.test.ts
CODING_AGENT_OBSERVABILITY_BROWSER_SESSION="$BROWSER_SESSION" node packages/relay/dist/cli.js uninstall
docker compose --project-name loupe-ticket16 down --volumes --remove-orphans
```
