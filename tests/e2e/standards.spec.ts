import { expect, test } from "@playwright/test";

test("an Administrator reviews the exact Candidate artifact and approves its hash", async ({
  page,
}) => {
  let approved = false;
  let editedClaims: unknown;
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Standards Lab",
        },
        member: {
          id: "22222222-2222-4222-8222-222222222222",
          displayName: "Standards Administrator",
          role: "administrator",
        },
      },
    }),
  );
  await page.route("**/api/v1/devices", (route) =>
    route.fulfill({ json: { devices: [] } }),
  );
  await page.route("**/api/v1/candidates", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            candidate: {
              id: "33333333-3333-4333-8333-333333333333",
              name: "evidence-first",
              status: approved ? "approved" : "pending_review",
              createdAt: "2026-07-17T14:00:00.000Z",
              deepLink:
                "/?candidate=33333333-3333-4333-8333-333333333333&version=44444444-4444-4444-8444-444444444444",
            },
            version: {
              id: "44444444-4444-4444-8444-444444444444",
              version: "1.0.0",
              immutable: true,
              artifactHash: `sha256:${"a".repeat(64)}`,
              package: {
                files: [
                  {
                    path: "SKILL.md",
                    content:
                      "---\nname: evidence-first\ndescription: Cite evidence.\n---\n\nCite captured Turns.",
                  },
                ],
              },
              reviewerContext: "Require navigable evidence.",
              uncertainty: { level: "low", statement: "One real Turn observed." },
              claims: [
                {
                  id: "claim-1",
                  statement: "Recommendations should cite captured Turns.",
                  classification: "single_case_hypothesis",
                  citationIds: ["citation-1"],
                },
              ],
              citations: [
                {
                  id: "citation-1",
                  sessionId: "session-1",
                  turnId: "turn-1",
                  activityId: "55555555-5555-4555-8555-555555555555",
                  synthetic: "real",
                  evidence: {
                    stability: "observed",
                    derivation: "exact",
                    confidence: "high",
                    source: "codex_hook",
                  },
                  links: {
                    session: "/api/v1/sessions/session-1",
                    turn: "/api/v1/sessions/session-1/turns/turn-1",
                    activity:
                      "/api/v1/sessions/session-1/activity/55555555-5555-4555-8555-555555555555",
                    browser: "/?session=session-1&turn=turn-1",
                  },
                },
                {
                  id: "citation-2",
                  sessionId: "session-2",
                  turnId: "turn-7",
                  activityId: "99999999-9999-4999-8999-999999999999",
                  synthetic: "real",
                  evidence: {
                    stability: "observed",
                    derivation: "exact",
                    confidence: "high",
                    source: "codex_hook",
                  },
                  links: {
                    session: "/api/v1/sessions/session-2",
                    turn: "/api/v1/sessions/session-2/turns/turn-7",
                    activity:
                      "/api/v1/sessions/session-2/activity/99999999-9999-4999-8999-999999999999",
                    browser: "/?session=session-2&turn=turn-7",
                  },
                },
              ],
              submittedAt: "2026-07-17T14:00:00.000Z",
              submittedBy: {
                memberId: "22222222-2222-4222-8222-222222222222",
                analysisCredentialId: "66666666-6666-4666-8666-666666666666",
              },
              review: {
                state: approved ? "approved" : "pending_review",
                note: null,
                decidedAt: null,
                decidedByMemberId: null,
              },
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/organization-standards", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            standardId: "77777777-7777-4777-8777-777777777777",
            name: "evidence-first",
            state: "active",
            sequence: 4,
            target: {
              standardId: "77777777-7777-4777-8777-777777777777",
              releaseId: "88888888-8888-4888-8888-888888888888",
              candidateId: "33333333-3333-4333-8333-333333333333",
              candidateVersionId: "44444444-4444-4444-8444-444444444444",
              name: "evidence-first",
              version: "1.1.0",
              artifactHash: `sha256:${"b".repeat(64)}`,
              mandatory: true,
              immutable: true,
              approvedAt: "2026-07-17T15:30:00.000Z",
              approvedByMemberId: "22222222-2222-4222-8222-222222222222",
            },
            previousReleaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            releases: [
              {
                standardId: "77777777-7777-4777-8777-777777777777",
                releaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                candidateId: "33333333-3333-4333-8333-333333333333",
                candidateVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                name: "evidence-first",
                version: "1.0.0",
                artifactHash: `sha256:${"a".repeat(64)}`,
                mandatory: true,
                immutable: true,
                approvedAt: "2026-07-17T14:30:00.000Z",
                approvedByMemberId: "22222222-2222-4222-8222-222222222222",
              },
              {
                standardId: "77777777-7777-4777-8777-777777777777",
                releaseId: "88888888-8888-4888-8888-888888888888",
                candidateId: "33333333-3333-4333-8333-333333333333",
                candidateVersionId: "44444444-4444-4444-8444-444444444444",
                name: "evidence-first",
                version: "1.1.0",
                artifactHash: `sha256:${"b".repeat(64)}`,
                mandatory: true,
                immutable: true,
                approvedAt: "2026-07-17T15:30:00.000Z",
                approvedByMemberId: "22222222-2222-4222-8222-222222222222",
              },
            ],
            installations: [
              {
                deviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                releaseId: "88888888-8888-4888-8888-888888888888",
                installedReleaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                state: "deferred_active_session",
                observedAt: "2026-07-17T16:00:00.000Z",
                serverReceivedAt: "2026-07-17T16:00:02.000Z",
                activeSessionIds: ["active-session-1", "active-session-2"],
              },
              {
                deviceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                releaseId: "88888888-8888-4888-8888-888888888888",
                installedReleaseId: null,
                state: "verification_failed",
                observedAt: "2026-07-17T16:05:00.000Z",
                serverReceivedAt: "2026-07-17T16:05:03.000Z",
                activeSessionIds: [],
                failure: {
                  stage: "verification",
                  code: "ARTIFACT_HASH_MISMATCH",
                  message: "Downloaded artifact did not match the approved hash.",
                },
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/organization/activity**", (route) =>
    route.fulfill({
      json: {
        items: [],
        syntheticInclusion: "excluded",
        filters: { page: 1, pageSize: 25, includeSeeded: false },
        page: { page: 1, pageSize: 25, total: 0, hasMore: false, nextPage: null },
        aggregates: {
          sessions: 0,
          members: 0,
          repositories: 0,
          activityStates: { live: 0, idle: 0, resumed: 0 },
          outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
        },
        members: [],
        repositories: [],
      },
    }),
  );
  await page.route("**/api/v1/sessions", (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await page.route("**/api/v1/live", (route) => route.abort());
  await page.route("**/edit", async (route) => {
    editedClaims = route.request().postDataJSON().claims;
    await route.fulfill({ status: 201, json: {} });
  });
  await page.route("**/approve", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      artifactHash: `sha256:${"a".repeat(64)}`,
    });
    approved = true;
    await route.fulfill({
      status: 201,
      json: {
        release: {
          standardId: "77777777-7777-4777-8777-777777777777",
          releaseId: "88888888-8888-4888-8888-888888888888",
          candidateId: "33333333-3333-4333-8333-333333333333",
          candidateVersionId: "44444444-4444-4444-8444-444444444444",
          name: "evidence-first",
          version: "1.0.0",
          artifactHash: `sha256:${"a".repeat(64)}`,
          mandatory: true,
          immutable: true,
          approvedAt: "2026-07-17T14:30:00.000Z",
          approvedByMemberId: "22222222-2222-4222-8222-222222222222",
        },
      },
    });
  });

  await page.goto(
    "/?candidate=33333333-3333-4333-8333-333333333333&version=44444444-4444-4444-8444-444444444444",
  );

  await expect(
    page.getByRole("heading", { name: "Candidate approvals" }),
  ).toBeVisible();
  const candidate = page.getByRole("article", {
    name: "evidence-first Candidate version 1.0.0",
  });
  await expect(candidate.getByText(`sha256:${"a".repeat(64)}`)).toBeVisible();
  await expect(candidate.locator("pre")).toContainText("Cite captured Turns.");
  const claim = page.getByRole("article", {
    name: "Factual claim Recommendations should cite captured Turns.",
  });
  await expect(claim.getByText("Single-case hypothesis", { exact: true })).toBeVisible();
  await expect(claim.getByRole("link", { name: "session-1 · turn-1" })).toHaveAttribute(
    "href",
    "/?session=session-1&turn=turn-1",
  );
  await expect(claim.getByRole("link", { name: "session-2 · turn-7" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit as new version" }).click();
  const claimEditor = page.getByRole("group", { name: "Factual claim 1" });
  await claimEditor.getByLabel("Claim statement").fill(
    "Recommendations should cite multiple captured Turns.",
  );
  await claimEditor.getByLabel("Classification").selectOption("repeated_pattern");
  await claimEditor.getByLabel("session-2 · turn-7").check();
  await page.getByLabel("New version").fill("1.1.0");
  await page.getByRole("button", { name: "Save unapproved version" }).click();
  await expect
    .poll(() => editedClaims)
    .toEqual([
      {
        id: "claim-1",
        statement: "Recommendations should cite multiple captured Turns.",
        classification: "repeated_pattern",
        citationIds: ["citation-1", "citation-2"],
      },
    ]);

  const deferredDevice = page.getByRole("article", {
    name: "Device cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  await expect(deferredDevice.getByText("Deferred active session", { exact: true })).toBeVisible();
  await expect(deferredDevice.getByText("active-session-1", { exact: true })).toBeVisible();
  await expect(deferredDevice.getByText("active-session-2", { exact: true })).toBeVisible();
  await expect(deferredDevice.getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { exact: true })).toBeVisible();
  await expect(deferredDevice.getByText("2026-07-17T16:00:00.000Z", { exact: true })).toBeVisible();
  await expect(deferredDevice.getByText("2026-07-17T16:00:02.000Z", { exact: true })).toBeVisible();

  const failedDevice = page.getByRole("article", {
    name: "Device dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  await expect(failedDevice.getByText("Verification failed", { exact: true })).toBeVisible();
  await expect(failedDevice.getByText("verification", { exact: true })).toBeVisible();
  await expect(failedDevice.getByText("ARTIFACT_HASH_MISMATCH", { exact: true })).toBeVisible();
  await expect(
    failedDevice.getByText("Downloaded artifact did not match the approved hash."),
  ).toBeVisible();

  const releaseHistory = page.getByRole("region", { name: "Release history" });
  await expect(releaseHistory.getByText("Version 1.0.0", { exact: true })).toBeVisible();
  await expect(releaseHistory.getByText("Version 1.1.0", { exact: true })).toBeVisible();
  await expect(releaseHistory.getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { exact: true })).toBeVisible();
  await expect(releaseHistory.getByText("88888888-8888-4888-8888-888888888888", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve exact artifact" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});
