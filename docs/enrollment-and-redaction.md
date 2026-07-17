# Device enrollment and capture policy

An Enrolled device is a Mac authorized for one Organization member. Enrollment
does not copy the member's browser authority into the relay.

Real people join through the separate Administrator-issued Invite-code flow;
see [Members, historical ownership, and Git context](members-ownership-and-git-context.md).
Redeeming an Invite creates one ordinary Member browser session. Enrolling a
second device never creates another Member.

## Enrollment and revocation

1. An authenticated member opens **Capture Settings**, names one Mac, and creates
   a device-enrollment grant.
2. The server returns the grant once. It expires after 10 minutes and can be
   exchanged only once.
3. Setup exchanges the grant at `POST /api/v1/device-enrollments/redeem` for a
   separate Device credential.
4. Revoking the Enrolled device revokes its Device credentials without revoking
   the member's browser session or deleting accepted capture history.

Disconnect and re-enrollment create a new Device identity. They do not reassign
historical Sessions; ownership remains bound to the first accepting Device.

Enrollment grants are stored as salted scrypt verifiers. Device credentials and
browser sessions are stored only as SHA-256 token digests. PostgreSQL disclosure
therefore does not reveal a redeemable grant, Device credential, or browser token.

The Device bearer scope is deliberately narrow:

| Capability | Browser member | Device credential |
| --- | --- | --- |
| Create an enrollment grant | Own devices | No |
| List health and capture-policy versions | Own devices | Own device only |
| Change capture policy or revoke | Own devices | No |
| Deliver redacted capture records | No | Yes |
| Browse Organization capture evidence | Yes | No |
| Submit Candidates or administer | Role-dependent later | No |

The server returns an explicit `DEVICE_CREDENTIAL_SCOPE_FORBIDDEN` error when a
Device credential attempts Organization Session browsing, capture-record reads,
Candidate submission, or Administrator actions. The real capture route is kept
separate from any future Example-data loader; a Device credential cannot create
an Example member or Seeded session.

`GET /api/v1/device/health` updates and returns the calling device's last contact
time and effective policy version. Capture Settings shows the same last-contact
time, active/revoked health, and policy version through `GET /api/v1/devices`.
The current `healthy` label means the credential authenticated successfully; the
timestamp, rather than the label alone, indicates recency.

## Ordinary redaction

Ordinary high-confidence redaction is enabled for every new Enrolled device.
The relay replaces only a matched secret substring, preserving surrounding
prompt, tool-input, or tool-output content. The initial conservative rules are:

- OpenAI-style `sk-` or `sk-proj-` API keys with at least 20 URL-safe secret
  characters.
- GitHub `ghp_` personal access tokens with the documented 36-character body,
  and `github_pat_` tokens with a high-confidence body length.

These intentionally do not claim comprehensive secret detection. A member can
disable ordinary redaction only with the explicit per-device Settings toggle.
That lower-safety choice increments the policy version and may persist secrets;
the relay does not silently infer consent from missing policy data.

For every replacement, the relay records:

- a coarse secret type;
- the versioned matching rule;
- original source path and substring offsets; and
- `HMAC-SHA-256(secret, device fingerprint key)` as a keyed, non-reversible
  fingerprint.

The fingerprint key must contain at least 32 bytes and is supplied to the relay;
it is never written to the queue. The plaintext match is not included in the
replacement, evidence, SQLite row, or delivered PostgreSQL record.

## Demo redaction canary

The Demo redaction canary is a separate setting and is disabled by default. When
enabled, it recognizes only the reserved harmless prefix
`demo_redaction_canary_` followed by at least 16 URL-safe characters. For example:

```text
demo_redaction_canary_0123456789ABCDEF
```

The match is case-sensitive. Short values and similar prefixes are left intact.
The canary proves that the configured relay-to-server redaction path operated; it
does not prove that ordinary rules detect every credential.

## Persistence boundary and current limitation

The relay's public capture interface redacts before inserting into its real
SQLite Delivery queue. The Device delivery API accepts that sanitized record and
stores it in PostgreSQL. Members can inspect the stored record through `/api/v1`;
the delivering Device cannot read it back.

The initial queue uses Node 22's built-in `node:sqlite`, which Node still labels
experimental. Its API stability must be revisited before declaring the relay
packaging production-stable. The server validates the delivered redaction
evidence shape but does not possess the device's fingerprint key and therefore
does not recreate local evidence; protection against a modified relay sending
unredacted content remains a defense-in-depth follow-up.
