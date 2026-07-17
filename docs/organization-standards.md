# Candidate review and mandatory Organization standards

Candidate skill submission and Organization-standard distribution are two separate authority boundaries. An Analysis credential may submit an immutable Candidate package, but only an authenticated human Administrator browser Session may reject it, edit it into a new version, or approve its exact hash. Members, Analysis credentials, and Device credentials receive stable authorization denials for those actions.

## Candidate states and immutable versions

Every Candidate version is `pending_review`, `rejected`, or `approved`. Rejection and approval are final decisions for that immutable version. An Administrator edit never mutates the reviewed bytes: it creates a new semantic version, retains the existing evidence citations, independently hashes the canonical package, and starts in `pending_review`. Approval does not carry to the new version.

The production browser shows every artifact file, reviewer context, uncertainty, factual claim, classification, claim-to-citation mapping, navigable citation, version, and full `sha256:` hash. Before approval, an Administrator can edit claim statements, classifications, and mappings together with package content; saving creates a new immutable version and re-runs the same citation and repeated-pattern validation as an Analysis-credential submission. Seeded evidence never satisfies the two-distinct-real-Turn threshold. Approval sends that exact hash to:

```text
POST /api/v1/candidates/:candidateId/versions/:versionId/approve
```

The server compares the requested hash with the immutable stored package. A mismatch returns `409 CANDIDATE_APPROVAL_HASH_MISMATCH`; it never publishes the changed bytes. Successful approval creates one immutable, mandatory Organization standard release. Its artifact and approval identity are never rewritten.

Browser review routes are:

- `POST .../edit` — create a new unapproved immutable version.
- `POST .../reject` — record a final rejection and reason.
- `POST .../approve` — bind human approval to the exact stored artifact hash.

## Device read scope and polling

An Enrolled daemon polls with its revocable Device credential:

```text
GET /api/v1/device/standards/manifest
GET /api/v1/device/standards/artifacts/:releaseId
GET /api/v1/device/standards/installations
POST /api/v1/device/standards/installations
```

The manifest has schema version `1`, `pollAfterSeconds` of 30, and a `targets` array containing every approved Organization standard. A fresh Device therefore receives the complete mandatory set instead of only the most recently changed standard. Each target carries its own monotonically changing sequence, `active` or `paused` state, immutable release and version, exact approved artifact hash, artifact URL, collision policy, and nullable previous-release pointer. An empty array means the Organization has no approved standards. A Device can download only artifacts represented by an approved release. It can read only its own installation history and cannot browse evidence, list Candidates, review releases, or administer distribution.

Daemons bound polling to the server interval and process every target independently. For each active target they download into that standard's staging namespace, verify the canonical package hash before touching the active version, and switch atomically only when no active Session can be affected. Pausing or rolling back one standard does not hide, pause, or replace any other standard. `deferred_active_session` reports the blocking Session ids. Download, verification, staging, and switch failures preserve the current working version and report the failed stage, stable code, and human-readable message. A successful switch retains a working previous Organization version for rollback.

Organization content is mandatory. The daemon installs it in the Organization-managed namespace. If a personal skill has the same name, `organization_wins_preserve_personal` makes the approved Organization version effective without deleting or silently rewriting the member's personal content.

## Pause, resume, rollback, and status

Administrators manage distribution through:

```text
GET  /api/v1/organization-standards
POST /api/v1/organization-standards/:standardId/pause
POST /api/v1/organization-standards/:standardId/resume
POST /api/v1/organization-standards/:standardId/rollback
```

Pause retains that standard's approved target and stops installation work for it; daemons continue polling and reporting it while synchronizing other active targets. Resume makes that target active again. Rollback requires the id of an earlier approved immutable release for the selected standard, moves it to that target, records the displaced target as `previousReleaseId`, activates only that standard's distribution, and advances its sequence. Members cannot opt out or call these routes.

The Administrator browser lists release history, active/paused state, target, previous release, manifest sequence, and every Device installation report. Each report identifies the Device; installed and requested releases; state; failure stage, code, and message; blocking Session ids; Device-observed time; and server-received time. Failed or deferred reports remain observable instead of being collapsed into a generic unhealthy state. Retrying a failed synchronization stages and verifies again; it never removes the last working version first.

## Operational recovery

- Hash mismatch: do not install; report `verification_failed` and keep the active release.
- Network or download failure: report `download_failed`; retry at a bounded poll interval.
- Invalid staging content: report `staging_failed`; discard only the staging directory.
- Atomic switch failure: report `switch_failed`; restore or retain the active link.
- Active Session: report `deferred_active_session`; retry after the Session becomes inactive.
- Faulty approved release: an Administrator pauses or rolls back centrally; every Enrolled daemon observes the changed manifest.

Installation reports are append-only observations with both device-observed and server-received time. They do not change the immutable approval record or artifact.
