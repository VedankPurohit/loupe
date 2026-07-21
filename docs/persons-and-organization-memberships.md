# Persons and Organization memberships

Loupe keeps a stable **Person** separate from each **Organization member**.
A Person can hold one membership in each of several Organizations, and every
membership carries its own `member` or `administrator` role. Administrator
authority in one Organization does not change the role in another.

The Person identifier is Loupe-generated and stable. Display name and email are
mutable profile data; email is not an identity key and never causes two People
to be linked automatically. Authentication-provider links are separate from
both the Person profile and Organization admission.

Browser Sessions remain bound to one active Organization membership. Creating
an Organization or redeeming an Invite through the current browser Session is
an explicit admission action and activates the resulting membership; merely
having another membership never switches context. Device and Analysis
credentials are also issued for one membership and cannot inherit authority
from another membership held by the same Person. A captured Session retains
the member and Device that owned it when its first Source event was accepted,
even if the Person later joins another Organization.

`GET /api/v1/session` returns the active Organization and member plus the
Person. A Google-authenticated Person without admission receives `null` for the
Organization and member. `GET /api/v1/person/memberships` returns only
memberships belonging to that authenticated Person, including an explicit empty
list during onboarding.

`POST /api/v1/organizations` atomically creates a new Organization, creates the
Person's first Administrator membership there, and makes that membership active
for the existing browser Session. `PUT /api/v1/session/active-membership` accepts
one `membershipId`; the server joins it back to the authenticated Person before
changing the active Organization. An identifier belonging to somebody else
returns the same stable not-found result as an absent membership. The browser
stores only that membership identifier in its URL so refresh, history, and deep
links re-run the same server proof.

An Administrator creates an Organization-scoped, single-use ordinary-Member
code with `POST /api/v1/invites` and may revoke it with
`POST /api/v1/invites/:id/revoke`. An already authenticated Person redeems it at
`POST /api/v1/invites/redeem`; the Person's authenticated profile supplies the
membership display name and the browser Session activates the admitted
membership. The legacy local Invite-code redemption shape remains accepted when
Google is not configured, preserving the bootstrap/operator compatibility seam.

When Google authentication is not configured, the one-time Bootstrap-code flow
remains the local/operator recovery and first-Organization path. Existing
browser Sessions continue to use their historical member identifier; the
forward Person migration adds identity without rewriting owned Sessions,
Source events, Devices, annotations, Candidates, or Organization standards.
