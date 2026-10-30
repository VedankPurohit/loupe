# 14 — Approve and synchronize mandatory Organization standards

**Type:** implementation

**Required skills:** `implement`, `tdd`

**What to build:** An Administrator reviews the exact Candidate artifact, may reject or edit it, and on approval publishes a mandatory Organization standard that every Enrolled daemon polls, verifies, and installs atomically when no active Session can be affected; the Administrator can pause or roll back distribution.

**Blocked by:** 02 — Enroll devices and control capture policy; 06 — Complete reversible macOS setup and the first-day checkpoint; 12 — Implement the selected polished investigation interface; 13 — Deliver agent-driven analysis and Candidate submission.

**Status:** complete

**Documentation impact:** Document Candidate states, immutable versions, approval/hash semantics, Device read scopes, manifest polling, active-Session deferral, collision policy, atomic switch, status, failure recovery, pause, rollback, and mandatory membership policy.

**Testing plan:** Use `/api/v1`, Playwright, multiple isolated daemon destinations, and a controllable manifest server. The first red test approves one exact hash in the browser and observes two Enrolled devices install that release while a changed unapproved version remains unavailable.

- [x] Reject, edit, and approve are Administrator-only browser actions; every edit creates a new immutable version and resets approval.
- [x] Approval binds to the exact artifact hash and publishes one immutable mandatory Organization standard release.
- [x] Device credentials can read only approved manifests/artifacts, their own capture policy and installation state, and cannot browse evidence or administer releases.
- [x] Daemons poll at a bounded interval, download to staging, verify before removal, defer while a Session is active, switch atomically, and retain a working rollback version.
- [x] Failed download, verification, staging, or switch leaves the current version active and reports an observable failure.
- [x] Administrator pause and rollback reach every Enrolled device; members have no opt-out and personal skill content is not silently overwritten.

**Completion note:** Core verification passed with 33 server tests, three focused standards tests, one Candidate-approval Playwright journey, typechecks, builds, and real disposable migrations. Daemon verification passed with 20 relay tests, typecheck, build, and diff hygiene. The combined system enforces exact-hash Administrator approval, immutable mandatory releases, Device-scoped manifests/artifacts/status, active-Session deferral, exact verification, atomic switching, observable failure, restart recovery, pause/rollback, retained working versions, and a collision-safe Organization namespace preserving personal skills. Retained release garbage collection remains deferred.
