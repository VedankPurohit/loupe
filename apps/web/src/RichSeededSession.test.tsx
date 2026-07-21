import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type {
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

import { SessionInspector } from "./SessionInspector.js";

const syntheticEvidenceId = "11111111-1111-5111-a111-111111111111";
const evidence = {
  stability: ["observed"],
  derivation: "exact",
  sourceEventIds: [],
  references: [
    {
      origin: "example_pack_server_controlled",
      examplePackVersion: "rich-v1",
      syntheticEvidenceId,
    },
  ],
} as const;

const richDetail = {
  session: {
    id: "seeded-rich-v1-provenance-safe-00",
    owner: { memberId: "22222222-2222-4222-8222-222222222222", deviceId: null },
    ownerProfile: { displayName: "Ada Lovelace · Example", isExample: true },
    gitContext: null,
    firstObservedAt: "2026-06-08T09:00:00.000Z",
    lastObservedAt: "2026-06-08T09:19:00.000Z",
    activityState: "resumed",
    completion: { status: "not_assumed", evidence: "unavailable" },
    rootAgentRunId: "example-agent-rich-v1-root-00",
    projectionVersion: "example-rich-v1-1",
    ownershipReconciliation: {
      inputs: [],
      rule: "example_pack_server_controlled",
      selectedValue: "22222222-2222-4222-8222-222222222222",
      confidence: "high",
    },
    annotations: {
      outcome: "partial",
      reviewStatus: "needs_help",
      tags: ["Example", "Seeded"],
      updatedAt: "2026-06-08T09:19:00.000Z",
    },
    synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
    deepLink: "/?session=seeded-rich-v1-provenance-safe-00&includeSeeded=true",
  },
  activities: [
    {
      id: "example-activity-rich-v1-startup-00",
      source: "startup",
      state: "resumed",
      startedAt: "2026-06-08T09:00:00.000Z",
      endedAt: "2026-06-08T09:19:00.000Z",
      sourceEventId: null,
      reference: evidence.references[0],
    },
  ],
  turns: [
    {
      id: "example-turn-rich-v1-inspect-00",
      agentRunId: "example-agent-rich-v1-root-00",
      firstObservedAt: "2026-06-08T09:01:00.000Z",
      lastObservedAt: "2026-06-08T09:09:00.000Z",
      evidence,
    },
  ],
  agentRuns: [
    {
      id: "example-agent-rich-v1-root-00",
      kind: "root",
      codexThreadId: "example-thread-rich-v1-root-00",
      agentType: "implementation",
      firstObservedAt: "2026-06-08T09:00:00.000Z",
      lastObservedAt: "2026-06-08T09:19:00.000Z",
      identityEvidence: evidence,
      parentEdge: null,
    },
  ],
  timeline: [
    {
      sourceEventId: null,
      reference: evidence.references[0],
      event: "ExampleSessionStarted",
      occurredAt: "2026-06-08T09:00:00.000Z",
      turnId: "example-turn-rich-v1-inspect-00",
      agentRunId: "example-agent-rich-v1-root-00",
      evidence,
    },
  ],
  evidence: {
    tools: [],
    lifecycle: [],
    apiRequests: [],
    tokenUsage: [],
    context: {
      limits: [],
      occupancy: [],
      firstRequestBaseline: null,
      contribution: {
        status: "unavailable",
        method: "no_exact_per_item_context_contract",
        note: "Unavailable by design in this Seeded Example Session.",
        evidence: {
          ...evidence,
          stability: ["unavailable"],
          derivation: "unavailable",
        },
      },
    },
    costEstimates: [],
    capabilities: [],
  },
} as unknown as ExecutionSessionDetail;

const includedActivity = {
  items: [
    {
      id: richDetail.session.id,
      owner: {
        memberId: richDetail.session.owner.memberId,
        displayName: richDetail.session.ownerProfile.displayName,
        isExample: true,
      },
      repository: { remoteIdentity: null, branch: null },
      activityState: "resumed",
      lastObservedAt: richDetail.session.lastObservedAt,
      annotations: richDetail.session.annotations,
      synthetic: { kind: "seeded", examplePackVersion: "rich-v1" },
    },
  ],
  page: { total: 1, limit: 50, offset: 0 },
  aggregates: {
    activityStates: { live: 0, idle: 0, resumed: 1 },
    outcomes: { successful: 0, partial: 1, failed: 0, unknown: 0 },
    members: 1,
  },
} as unknown as OrganizationActivityResponse;

const excludedActivity = {
  ...includedActivity,
  items: [],
  page: { ...includedActivity.page, total: 0 },
} as OrganizationActivityResponse;

test("Seeded browser evidence stays opt-in, labelled, and server-controlled", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/organization/activity")) {
      const body = url.includes("includeSeeded=true") ? includedActivity : excludedActivity;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify(richDetail), { status: 200 });
  }));

  render(
    <SessionInspector
      member={{
        id: "33333333-3333-4333-8333-333333333333",
        displayName: "Administrator",
        role: "administrator",
      }}
    />,
  );

  expect(await screen.findByText("No Sessions match this evidence search.")).toBeVisible();
  await user.click(
    screen.getByRole("checkbox", { name: "Include clearly labelled Seeded examples" }),
  );

  expect(await screen.findByText("Seeded Session · rich-v1 · owned by an Example member")).toBeVisible();
  expect(screen.getByText("Example member", { exact: true })).toBeVisible();
  const timeline = screen.getByRole("region", { name: "Linear execution timeline" });
  expect(
    within(timeline).getByRole("button", {
      name: /Seeded.*ExampleSessionStarted.*example-turn-rich-v1-inspect-00/i,
    }),
  ).toBeVisible();
  await user.click(within(timeline).getByText("Provenance · exact"));
  expect(
    within(timeline).getByText(/Server-controlled Example-pack evidence · rich-v1/),
  ).toBeVisible();
  expect(within(timeline).queryByText(/No source-event identifier is available/)).not.toBeInTheDocument();
});
