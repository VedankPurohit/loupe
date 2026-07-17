# Members, historical ownership, and Git context

## Invite codes and roles

An authenticated Administrator creates an Invite code with
`POST /api/v1/invites`. The request may set `expiresInHours` from 1 through
168; omitted values expire after 24 hours. The plaintext code is returned only
to the issuing browser. PostgreSQL stores its random lookup plus salted scrypt
verifier, never a redeemable code.

An unauthenticated person enters the code and a display name in the browser, or
calls `POST /api/v1/invites/redeem`. Successful redemption creates exactly one
ordinary Member and an HttpOnly browser session. The code cannot select an
Organization or role, cannot create an Administrator, and cannot be reused.
Expired, revoked, invalid, and already-used values share the stable
`INVITE_CODE_INVALID` response so the endpoint does not disclose verifier
state. Ordinary Members receive `ADMINISTRATOR_REQUIRED` if they try to issue
another code.

Both Members and Administrators have the same Organization-visible access to
captured Session evidence. Administrator authority is additional governance
authority; it is not a hidden evidence tier. Passwords, email delivery,
recovery, public signup, and general role management remain outside this flow.

## Server-authoritative historical ownership

The first accepted source event carrying a new canonical `session_id` fixes
that Session's owner from the authenticating Device credential:

- `owner.memberId` is the Member associated with that Enrolled device.
- `owner.deviceId` is the accepting Enrolled device.
- owner-like fields in a source payload are retained only as source evidence;
  they are never authoritative inputs to ownership.

The retained source-event row records its delivering Device and server-derived
Member. Projection replay orders ownership by server receipt, not the event's
client timestamp. Disconnect, Device revocation, machine-name changes, or a
later enrollment never mutate the original event or owner. Re-enrollment
creates a new Enrolled-device identity; it does not transfer an existing
Session.

If another Device later delivers evidence for the same Session, the original
owner remains selected. Every delivering Device appears in
`ownershipReconciliation.inputs`, while `selectedValue` remains the first
Device and the rule remains `first_accepted_device_owns_session`. This makes a
cross-device delivery anomaly inspectable without turning it into reassignment.

## Relay-local Git sampling

The relay exports `inspectGitContext` and
`enrichSourceEventWithGitContext`. Sampling runs `git` with an argument array,
never through a shell, and records:

- repository root and worktree path;
- sanitized `origin` remote identity, when present;
- branch, or `branch: null` plus `detached: true` for detached HEAD;
- commit identifier;
- sample time; and
- `relay_local_git` / `local_observation` provenance with `observed` stability,
  exact local derivation, and the inspected cwd.

HTTP(S), SSH URL, and scp-style remotes have user information removed. URL
query strings and fragments are also removed, so credential-bearing userinfo
or token query parameters cannot enter the observation. Unparseable non-local
remote values are omitted rather than retained unsafely. A repository without
an `origin` remains an available Git sample with `remoteIdentity: null`.

The result uses explicit status and reason values instead of invented fields:

| Status | Meaning |
| --- | --- |
| `available` | Repository, commit, and ref inspection succeeded. |
| `not_repository` | The sampled cwd was not inside a Git repository. |
| `inspection_failed` | Git ran but the required state could not be read safely. |
| `unavailable` | The Git command could not be executed. |

Unavailable results keep repository, remote, branch, worktree, commit, and
detached state `null`. Diagnostics from Git are not copied into the public
reason because they could echo sensitive remote configuration.

The sample is attached additively to a Source event, retained in PostgreSQL,
and exposed on the canonical Session. It proves only what the relay observed at
`sampledAt`; it is not Codex-source-reported evidence and must not be presented
as proof of repository state at an earlier event time.
