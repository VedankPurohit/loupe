import { expect, test } from "@playwright/test";

test("an Administrator reviews the exact Candidate artifact and approves its hash", async ({
  page,
}) => {
  let approved = false;
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
    route.fulfill({ json: { items: [] } }),
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
  await expect(page.getByText(`sha256:${"a".repeat(64)}`)).toBeVisible();
  await expect(page.getByText("Cite captured Turns.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "session-1 · turn-1" })).toHaveAttribute(
    "href",
    "/?session=session-1&turn=turn-1",
  );
  await page.getByRole("button", { name: "Approve exact artifact" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});
