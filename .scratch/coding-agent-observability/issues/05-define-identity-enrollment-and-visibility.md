# Loupe — Define identity, listener enrollment, and visibility

Type: grilling
Status: resolved
Assignee: /root (Codex task 019f69c1-f332-70a1-a943-54e204b2d037)
Blocked by: 04

## Question

What minimal single-organization identity model supports real users, an administrator, session ownership, listener enrollment, organization-visible content, seeded examples, and invite-code enrollment without building full hosted account management?

## Answer

Resolved 2026-07-17.

### Organization and human identity

- One self-hosted deployment contains exactly one Organization. An organization identifier remains on organization-owned records, but there is no organization creation, selection, switching, or cross-organization behavior.
- An Organization member is a stable human identity with exactly one of two roles: Member or Administrator. Both roles receive ordinary organization access; an Administrator additionally approves and publishes Organization standards.
- The first bootstrap creates an Administrator. Invite-code redemption creates a Member. More than one Administrator is representable, but role-management UI and owner/superuser roles are outside this scope.

### Authentication and credential boundaries

Authentication uses separate, independently revocable artifacts for separate actors:

- A browser session authenticates an Organization member and inherits that member's role.
- An Analysis credential belongs to an Organization member. It can read organization evidence and submit Candidate skills, but cannot mutate captured evidence, approve a Candidate skill, or publish an Organization standard—even when its member is an Administrator.
- A Device credential belongs to one Enrolled device. It can deliver captured activity, read only its own capture policy and delivery/installation status, and read approved Organization-standard manifests/artifacts required for mandatory synchronization. It cannot browse Organization evidence, use the Analysis API, submit Candidates, or approve, publish, pause, or roll back a release. (Amended 2026-07-17 after the mandatory-standard distribution decision.)

The server stores one-time bootstrap and invite secrets only in verifier form. Codes may expire or be revoked. Passwords, email delivery, recovery, OAuth/OIDC, hosted signup, and general account or role administration are deferred.

### Bootstrap, invitation, and device enrollment

- First startup issues a single-use Bootstrap code. Redeeming it creates the initial Administrator and establishes that member's browser session.
- An Administrator may issue a single-use Invite code for this one Organization. Redeeming it creates an ordinary Member and establishes that member's browser session; the code does not select a role or organization.
- An authenticated member authorizes Codex setup to enroll a particular per-user relay installation. Enrollment exchanges a short-lived, single-use grant for a separate Device credential; the grant is never the long-lived delivery credential.
- Each Enrolled device is associated with exactly one Organization member at a time. One member may have multiple Enrolled devices. Changing the associated member requires explicit disconnect and re-enrollment; editing a machine name or reusing another member's credential is not reassignment.
- Disconnect revokes the Device credential and stops future delivery authorization without deleting previously accepted sessions. Uninstall may additionally remove the local relay and capture configuration, as defined by the delivery/setup contract.

This keeps Invite codes as the seam for adding humans and device enrollment as a separate authorization step, so adding a second laptop never creates a duplicate Member.

### Session ownership

- The server assigns a Session owner from the member associated with the authenticating Device credential when the Session is first accepted. A client-supplied owner is never authoritative.
- Session ownership is historical and does not change when a device is later disconnected, revoked, renamed, or enrolled by another member.
- Later source events retain their delivering-device provenance. If an event for an existing Session arrives through another credential, the original Session owner remains authoritative; the mismatch is retained for reconciliation rather than silently transferring ownership.
- Members and Administrators may assign the already-defined lightweight outcome, review status, and tags. These annotations do not change ownership.

### Visibility

- The Organization is the only authenticated content boundary. Every Member and Administrator can inspect all captured Session content in the Organization by default, including another member's sessions.
- There are no private Sessions, per-user access lists, or repository/folder visibility rules during the hackathon. Administrators do not receive a separate hidden-data tier.
- Codex setup must disclose the organization-visible default before enabling capture. Default secret redaction still applies; organization visibility is not a substitute for redaction.
- Analysis credentials follow the same organization boundary but only through their narrower read-and-submit scope.

### Seeded examples

- Seeded Sessions belong to dedicated Example members with the ordinary Member role, never to a real member or Administrator.
- Both the Example member and every Seeded session carry an explicit synthetic/example designation that all UI, API, CLI, citation, and comparison surfaces preserve.
- Seeded Sessions are excluded from real-data aggregates and real-evidence claims by default. A user or analysis query may include them explicitly for onboarding or comparison, but they cannot silently satisfy a Repeated pattern's real-evidence requirement.
- A versioned Example data pack is loaded only through an explicit Administrator CLI command or UI action. Loading is idempotent, never automatic at startup, never uses a Device credential, and can create only explicitly designated Example members and Seeded sessions. (Amended 2026-07-17 after review.)

### Deferred account-management depth

This decision does not add multi-organization isolation, organization lifecycle management, public signup, passwords, email verification, external identity providers, account recovery, member-directory administration, custom roles, per-resource permissions, device-management UI, or hosted billing. The credential and identity boundaries above leave those as later extensions without making them prerequisites for the self-hosted hackathon product.
