import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type {
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

import { SessionInspector } from "./SessionInspector.js";

const evidence = {
  stability: ["unavailable"],
  derivation: "unavailable",
  sourceEventIds: [],
} as const;

function detailWithUnavailableUsage(toolResult?: string): ExecutionSessionDetail {
  return {
    session: {
      id: "session-unavailable",
      organizationId: "organization-1",
      owner: { memberId: "member-1", displayName: "Ada" },
      ownerProfile: { memberId: "member-1", displayName: "Ada", isExample: false },
      activityState: "idle",
      firstObservedAt: "2026-07-17T00:00:00.000Z",
      lastObservedAt: "2026-07-17T00:00:01.000Z",
      rootAgentRunId: "agent-root",
      projectionVersion: "1",
      ownershipReconciliation: {
        inputs: [], rule: "test", selectedValue: "member-1", confidence: "high",
      },
      annotations: {
        outcome: "unknown", reviewStatus: "ordinary", tags: [], updatedAt: null,
      },
      synthetic: { kind: "real", examplePackVersion: null },
      deepLink: "/?session=session-unavailable",
      gitContext: null,
    },
    activities: [],
    turns: [],
    agentRuns: [{
      id: "agent-root",
      sessionId: "session-unavailable",
      kind: "root",
      parentAgentRunId: null,
      parentEdge: null,
      agentType: "codex",
      firstObservedAt: "2026-07-17T00:00:00.000Z",
      lastObservedAt: "2026-07-17T00:00:01.000Z",
      identityEvidence: evidence,
    }],
    timeline: [],
    evidence: {
      tools: toolResult === undefined ? [] : [{
        id: "tool-redaction",
        toolName: "shell",
        occurredAt: "2026-07-17T00:00:00.500Z",
        identifiers: { hookToolUseId: null, otelCallId: null },
        input: { note: "The redaction preference is enabled" },
        result: { output: toolResult },
        durationMs: null,
        outcome: "success",
        approval: "unavailable",
        retryCount: null,
        turnAssociation: { turnId: null, strength: "unavailable", method: "not captured" },
        evidence,
        coverageGaps: [],
      }], lifecycle: [], capabilities: [], costEstimates: [],
      tokenUsage: [{
        id: "usage-unavailable",
        occurredAt: "2026-07-17T00:00:01.000Z",
        sourceKind: "provider_completion",
        model: null,
        serviceTier: null,
        categories: {
          input: null, cachedInput: null, output: null, reasoningOutput: null, total: null,
        },
        turnAssociation: { turnId: null, strength: "unavailable", method: "not captured" },
        evidence,
      }],
      context: {
        limits: [], occupancy: [], firstRequestBaseline: null,
        contribution: {
          status: "unavailable", method: "not captured", note: "Unavailable", evidence,
        },
      },
    },
  } as unknown as ExecutionSessionDetail;
}

function activity(): OrganizationActivityResponse {
  return {
    items: [{
      id: "session-unavailable",
      owner: { memberId: "member-1", displayName: "Ada", isExample: false },
      repository: { remoteIdentity: null, branch: null },
      activityState: "idle",
      lastObservedAt: "2026-07-17T00:00:01.000Z",
      annotations: { outcome: "unknown", reviewStatus: "ordinary", tags: [] },
      synthetic: { kind: "real", examplePackVersion: null },
    }],
    page: { total: 1, limit: 50, offset: 0 },
    aggregates: {
      activityStates: { live: 0, idle: 1, resumed: 0 },
      outcomes: { successful: 0, partial: 0, failed: 0, unknown: 1 },
      members: 1,
    },
  } as unknown as OrganizationActivityResponse;
}

function detailForSession(id: string, displayName: string): ExecutionSessionDetail {
  const detail = detailWithUnavailableUsage();
  return {
    ...detail,
    session: {
      ...detail.session,
      id,
      ownerProfile: { ...detail.session.ownerProfile, displayName },
    },
  };
}

test("unavailable Token and Context evidence is never presented as numeric zero", async () => {
  const detail = detailWithUnavailableUsage();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);

  const map = await screen.findByRole("region", { name: "Session investigation" });
  expect(within(map).getAllByText("Unavailable tokens", { exact: true })).not.toHaveLength(0);
  expect(within(map).queryByText("0 tokens", { exact: true })).not.toBeInTheDocument();

  const inspector = screen.getByRole("region", { name: "Evidence inspector" });
  expect(within(inspector).getByLabelText("Context occupancy unavailable")).toBeVisible();
  expect(within(inspector).queryByRole("meter")).not.toBeInTheDocument();
});

test("redaction notice is driven only by an exact relay placeholder", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage("No secret changed; redaction audit completed.");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  await user.click(await screen.findByRole("button", { name: /Tool: shell/i }));

  expect(screen.queryByText(/Redacted content ·/i)).not.toBeInTheDocument();
});

test("redaction notice recognizes the relay's exact placeholder", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage("credential=[REDACTED:openai_api_key]");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  await user.click(await screen.findByRole("button", { name: /Tool: shell/i }));

  expect(screen.getByText(/Redacted content ·/i)).toBeVisible();
});

test("a failed Session open keeps evidence visible and retries the requested Session", async () => {
  const user = userEvent.setup();
  let unavailable = true;
  const organizationActivity = activity();
  organizationActivity.items.push({
    ...organizationActivity.items[0]!,
    id: "session-retry",
    owner: { ...organizationActivity.items[0]!.owner, displayName: "Grace" },
  });
  organizationActivity.page.total = 2;

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/organization/activity")) {
      return new Response(JSON.stringify(organizationActivity), { status: 200 });
    }
    if (url.endsWith("/session-retry") && unavailable) {
      return new Response(JSON.stringify({ error: { message: "Session evidence is temporarily unavailable." } }), {
        status: 503,
      });
    }
    const detail = url.endsWith("/session-retry")
      ? detailForSession("session-retry", "Grace")
      : detailForSession("session-unavailable", "Ada");
    return new Response(JSON.stringify(detail), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  await screen.findByRole("heading", { name: "Ada" });
  await user.click(screen.getByRole("button", { name: /Grace.*session-retry/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Session evidence is temporarily unavailable.");
  expect(screen.getByRole("heading", { name: "Ada" })).toBeVisible();

  unavailable = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Grace" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("agent hierarchy is a semantic list and scanline arrows ignore its controls", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  const hierarchy = await screen.findByRole("list", { name: "Agent run hierarchy" });
  expect(screen.queryByRole("tree")).not.toBeInTheDocument();

  const root = within(hierarchy).getByRole("button", { name: /Root agent run.*codex/i });
  expect(root).toHaveAttribute("aria-pressed", "false");
  root.focus();
  await user.keyboard("{ArrowLeft}");

  expect(screen.getByText("100%", { selector: "output" })).toBeVisible();
});

test("a rejected annotation mutation can retry the same assessment", async () => {
  const user = userEvent.setup();
  let annotationUnavailable = true;
  const detail = detailWithUnavailableUsage();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/annotations")) {
      if (annotationUnavailable) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({}), { status: 200 });
    }
    const body = url.includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  await screen.findByRole("heading", { name: "Session annotations" });
  await user.selectOptions(screen.getByLabelText("Outcome"), "failed");
  await user.click(screen.getByRole("button", { name: "Save annotation" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Saving the Session annotation failed");
  annotationUnavailable = false;
  await user.click(screen.getByRole("button", { name: "Try saving annotation" }));
  expect(screen.queryByRole("button", { name: "Try saving annotation" })).not.toBeInTheDocument();
});
