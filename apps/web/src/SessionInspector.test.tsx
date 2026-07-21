import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type {
  Evidence,
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

import { SessionInspector } from "./SessionInspector.js";

const evidence: Evidence = {
  stability: ["unavailable"],
  derivation: "unavailable",
  sourceEventIds: [],
};

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
      }], lifecycle: [], apiRequests: [], capabilities: [], costEstimates: [],
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

test("an individual Token sample names every category and its model-source limitation", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  await user.click(await screen.findByRole("button", { name: /Token: Unavailable tokens/i }));
  const inspector = screen.getByRole("region", { name: "Evidence inspector" });
  const categories = within(inspector).getByRole("group", { name: "Token categories" });
  for (const label of ["Input", "Cached input", "Output", "Reasoning output", "Total"]) {
    expect(within(categories).getByText(label, { exact: true })).toBeVisible();
  }
  expect(within(categories).getAllByText("Source unavailable", { exact: true })).toHaveLength(5);
  expect(within(inspector).getByText("Provider completion", { exact: true })).toBeVisible();
  expect(within(inspector).getByText(/A provider Token sample can name a model, but does not prove one stable logical model request/)).toBeVisible();
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

test("agent hierarchy is a semantic list and keyboard navigation ignores its controls", async () => {
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

  expect(root).toHaveFocus();
  expect(screen.getByRole("region", { name: "Linear execution timeline" })).toBeVisible();
});

test("a long timeline remains a labelled semantic route to its final evidence node", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  detail.evidence.lifecycle = Array.from({ length: 120 }, (_, index) => ({
    id: `lifecycle-${index}`,
    kind: index % 2 === 0 ? "compaction" as const : "resume" as const,
    event: `lifecycle_event_${index}`,
    occurredAt: new Date(Date.parse("2026-07-17T00:00:00.000Z") + index * 1_000).toISOString(),
    details: { sequence: index },
    turnAssociation: { turnId: null, strength: "unavailable" as const, method: "not captured" },
    evidence,
  }));
  detail.session = { ...detail.session, lastObservedAt: "2026-07-17T00:02:00.000Z" };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  const timeline = await screen.findByRole("region", { name: "Linear execution timeline" });
  const route = within(timeline).getByRole("list", { name: "121 chronological evidence nodes" });
  const finalNode = within(route).getByRole("button", { name: /Lifecycle lifecycle_event_119/i });
  finalNode.focus();
  expect(finalNode).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(finalNode).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("heading", { name: "Lifecycle event 119" })).toBeVisible();
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

test("a real Session summary leads with owner, repository, folder, model, Turns, and compact coverage", async () => {
  const detail = detailWithUnavailableUsage();
  detail.session = {
    ...detail.session,
    gitContext: {
      status: "available",
      repositoryRoot: "/Users/ada/loupe",
      remoteIdentity: "github.com/acme/loupe",
      branch: "feature/evidence-ledger",
      detached: false,
      worktree: "/Users/ada/loupe",
      commit: "a".repeat(40),
      sampledAt: "2026-07-17T00:00:01.000Z",
      provenance: { source: "relay_local_git", evidence: "local_observation", stability: "observed", derivation: "exact", cwd: "/Users/ada/loupe" },
      reason: null,
    },
  };
  detail.turns = [{
    id: "turn-1",
    agentRunId: "agent-root",
    firstObservedAt: "2026-07-17T00:00:00.100Z",
    lastObservedAt: "2026-07-17T00:00:00.900Z",
    evidence: { stability: ["observed"], derivation: "exact", sourceEventIds: [] },
  }];
  detail.evidence.tokenUsage[0] = {
    ...detail.evidence.tokenUsage[0]!,
    model: "gpt-5-codex",
    categories: { input: 100, cachedInput: 20, output: 50, reasoningOutput: null, total: 150 },
  };

  const item = activity().items[0]!;
  item.repository = {
    repositoryRoot: "/Users/ada/loupe",
    remoteIdentity: "github.com/acme/loupe",
    branch: "feature/evidence-ledger",
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);

  const summary = await screen.findByRole("region", { name: "Session summary" });
  expect(within(summary).getByText("Real captured", { exact: true })).toBeVisible();
  expect(within(summary).getByText("Owner · Ada", { exact: true })).toBeVisible();
  expect(within(summary).getByText("github.com/acme/loupe", { exact: true })).toBeVisible();
  expect(within(summary).getByText("/Users/ada/loupe", { exact: true })).toBeVisible();
  expect(within(summary).getByText("gpt-5-codex", { exact: true })).toBeVisible();
  expect(within(summary).getByText("1 Turn", { exact: true })).toBeVisible();
  expect(within(summary).getByText("Coverage", { exact: true })).toBeVisible();
  expect(within(summary).getByText(/unstable/i)).toBeVisible();
  expect(within(summary).queryByText("Unavailable from captured evidence", { exact: true })).not.toBeInTheDocument();
});

test("activity filters and pagination stay on the /api/v1 public seam", async () => {
  const user = userEvent.setup();
  const requests: string[] = [];
  const first = activity() as OrganizationActivityResponse & { members: NonNullable<OrganizationActivityResponse["members"]>; repositories: NonNullable<OrganizationActivityResponse["repositories"]> };
  first.members = [{ id: "member-1", displayName: "Ada", isExample: false, sessionCount: 2 }];
  first.repositories = [{ identity: "github.com/acme/loupe", sessionCount: 2 }];
  first.page = { ...first.page, page: 1, pageSize: 1, total: 2, hasMore: true, nextPage: 2 };
  const second = { ...first, page: { ...first.page, page: 2, hasMore: false, nextPage: null } };
  const detail = detailWithUnavailableUsage();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/organization/activity")) {
      return new Response(JSON.stringify(url.includes("page=2") ? second : first), { status: 200 });
    }
    return new Response(JSON.stringify(detail), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  await screen.findByRole("heading", { name: "Ada" });
  await user.selectOptions(screen.getByLabelText("Filter by repository"), "github.com/acme/loupe");
  await user.selectOptions(screen.getByLabelText("Filter by member"), "member-1");
  await user.click(screen.getByRole("button", { name: "Apply activity filters" }));
  expect(requests.some((url) => url.includes("repository=github.com%2Facme%2Floupe") && url.includes("memberId=member-1"))).toBe(true);
  await user.click(screen.getByRole("button", { name: "Next activity page" }));
  expect(requests.some((url) => url.includes("page=2"))).toBe(true);
});

test("a Turn selection exposes model, context, capability, and provenance caveats", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  const turnEvidence = { stability: ["unavailable"] as ("unavailable")[], derivation: "unavailable" as const, sourceEventIds: [] as string[] };
  detail.evidence = { ...detail.evidence, apiRequests: [], capabilities: [{ capability: "configured_mcp_servers", state: "conditional", note: "Configured servers are not proof of use.", evidence: turnEvidence }] } as typeof detail.evidence;
  detail.turns = [{
    id: "turn-caveat",
    agentRunId: "agent-root",
    firstObservedAt: "2026-07-17T00:00:00.100Z",
    lastObservedAt: "2026-07-17T00:00:00.900Z",
    evidence: turnEvidence,
  }];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  const timeline = await screen.findByRole("region", { name: "Linear execution timeline" });
  await user.click(within(timeline).getByRole("button", { name: /Turn turn-caveat/i }));
  const inspector = screen.getByRole("region", { name: "Evidence inspector" });
  expect(within(inspector).getByRole("heading", { name: /Turn turn-caveat/i })).toBeVisible();
  expect(within(inspector).getByText("Model not yet observed", { exact: true })).toBeVisible();
  expect(within(inspector).getByText(/Context caveat ·/i)).toBeVisible();
  expect(within(inspector).getByText(/MCP configured · not proof of use/i)).toBeVisible();
  expect(within(inspector).getByText("Turn provenance · unavailable", { exact: true })).toBeVisible();
});

test("lifecycle evidence and provider API attempts are navigable into exact details", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  detail.turns = [{
    id: "turn-route",
    agentRunId: "agent-root",
    firstObservedAt: "2026-07-17T00:00:00.100Z",
    lastObservedAt: "2026-07-17T00:00:00.900Z",
    evidence: { stability: ["observed"], derivation: "exact", sourceEventIds: ["source-turn"] },
  }];
  detail.evidence.lifecycle = [{
    id: "lifecycle-resume",
    kind: "resume",
    event: "session_resumed",
    occurredAt: "2026-07-17T00:00:00.300Z",
    details: { source: "codex_hook" },
    turnAssociation: { turnId: "turn-route", strength: "exact", method: "source_event_turn_id" },
    evidence: { stability: ["observed"], derivation: "exact", sourceEventIds: ["source-lifecycle"] },
  }];
  detail.evidence.apiRequests = [{
    id: "request-retry",
    occurredAt: "2026-07-17T00:00:00.500Z",
    attempt: 2,
    statusCode: 429,
    durationMs: 41,
    success: false,
    error: "rate limited",
    turnAssociation: { turnId: "turn-route", strength: "exact", method: "provider_request_turn_id" },
    evidence: { stability: ["observed"], derivation: "exact", sourceEventIds: ["source-request"] },
  }];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  const timeline = await screen.findByRole("region", { name: "Linear execution timeline" });
  await user.click(within(timeline).getByRole("button", { name: /Lifecycle session_resumed/i }));
  const inspector = screen.getByRole("region", { name: "Evidence inspector" });
  expect(within(inspector).getByRole("heading", { name: "Session resumed" })).toBeVisible();
  expect(within(inspector).getByText("Resume", { exact: true })).toBeVisible();
  expect(within(inspector).getByText(/codex_hook/)).toBeVisible();

  await user.click(within(timeline).getByRole("button", { name: /API request API attempt 2/i }));
  expect(within(inspector).getByRole("heading", { name: "Provider API attempt 2" })).toBeVisible();
  expect(within(inspector).getByText("429", { exact: true })).toBeVisible();
  expect(within(inspector).getByText("41 ms", { exact: true })).toBeVisible();
  expect(within(inspector).getByText(/rate limited/)).toBeVisible();
  await user.click(within(inspector).getByText("Evidence provenance · exact", { exact: true }));
  expect(within(inspector).getByText("source-request", { exact: true })).toBeVisible();
});

test("a Turn citation deep link opens that Turn even without a timeline activity", async () => {
  const detail = detailWithUnavailableUsage();
  detail.turns = [{
    id: "turn-cited",
    agentRunId: "agent-root",
    firstObservedAt: "2026-07-17T00:00:00.100Z",
    lastObservedAt: "2026-07-17T00:00:00.900Z",
    evidence,
  }];
  window.history.replaceState({}, "", "/?session=session-unavailable&turn=turn-cited");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  expect(await screen.findByRole("heading", { name: "Turn turn-cited" })).toBeVisible();
});

test("unstable fidelity, Tool MCP origin, and execution failures remain honest", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  const unstable: Evidence = { stability: ["observed", "unstable"], derivation: "exact", sourceEventIds: ["source-unstable"] };
  detail.agentRuns[0] = { ...detail.agentRuns[0]!, identityEvidence: unstable };
  detail.evidence.tools = [{
    id: "tool-mcp",
    toolName: "mcp_call",
    occurredAt: "2026-07-17T00:00:00.500Z",
    identifiers: { hookToolUseId: null, otelCallId: "otel-mcp-call" },
    input: null,
    result: null,
    durationMs: null,
    outcome: "failure",
    approval: "unavailable",
    retryCount: null,
    turnAssociation: { turnId: null, strength: "unavailable", method: "not captured" },
    evidence: unstable,
    coverageGaps: ["mcp_server_identity_not_captured"],
  }];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  const summary = await screen.findByRole("region", { name: "Session summary" });
  expect(within(summary).getByText("1 execution or provider failure retained", { exact: true })).toBeVisible();
  const unstableMark = screen.getAllByTitle("Observed, unstable · exact")[0];
  expect(unstableMark).toHaveClass("fidelity-unstable");
  await user.click(screen.getByRole("button", { name: /Tool: mcp_call/i }));
  const inspector = screen.getByRole("region", { name: "Evidence inspector" });
  expect(within(inspector).getByText("MCP-style Tool name observed; server identity source unavailable.", { exact: true })).toBeVisible();
  expect(within(inspector).getByText(/Next safe action · Check Device diagnostics and the adapter capture boundary before drawing conclusions/)).toBeVisible();
});

test("a Turn keeps model transport, Token, Context, MCP, Skill, and unsupported states distinct", async () => {
  const user = userEvent.setup();
  const detail = detailWithUnavailableUsage();
  const observed: Evidence = { stability: ["observed"], derivation: "exact", sourceEventIds: ["source-observed"] };
  const inferred: Evidence = { stability: ["inferred"], derivation: "inferred", sourceEventIds: ["source-inferred"] };
  const unavailable: Evidence = { stability: ["unavailable"], derivation: "unavailable", sourceEventIds: [] };
  detail.turns = [{
    id: "turn-evidence",
    agentRunId: "agent-root",
    firstObservedAt: "2026-07-17T00:00:00.100Z",
    lastObservedAt: "2026-07-17T00:00:00.900Z",
    evidence: observed,
  }];
  detail.evidence.tokenUsage = [{
    id: "usage-partial",
    occurredAt: "2026-07-17T00:00:00.500Z",
    sourceKind: "provider_completion",
    model: "gpt-5.6-codex",
    serviceTier: "fast",
    categories: { input: 100, cachedInput: null, output: 20, reasoningOutput: null, total: null },
    turnAssociation: { turnId: "turn-evidence", strength: "exact", method: "provider_turn_id" },
    evidence: observed,
  }];
  detail.evidence.apiRequests = [{
    id: "request-transport",
    occurredAt: "2026-07-17T00:00:00.400Z",
    attempt: 3,
    statusCode: 429,
    durationMs: 32,
    success: false,
    error: "rate limited",
    turnAssociation: { turnId: "turn-evidence", strength: "exact", method: "provider_turn_id" },
    evidence: observed,
  }];
  detail.evidence.context = {
    limits: [{ model: "gpt-5.6-codex", contextWindow: 200, autoCompactionLimit: 180, evidence: observed }],
    occupancy: [{
      tokenUsageId: "usage-partial",
      occupancyTokens: 100,
      occupancyPercent: 50,
      method: "provider_input_tokens_over_reported_context_window",
      inputs: { inputTokens: 100, contextWindow: 200 },
      missingAssumptions: ["cached input reuse is not included"],
      evidence: inferred,
    }],
    firstRequestBaseline: null,
    contribution: { status: "unavailable", method: "no_exact_item_contract", note: "Per-item contribution was not captured.", evidence: unavailable },
  };
  detail.evidence.capabilities = [
    { capability: "configured_mcp_servers", state: "conditional", note: "Configuration is not proof of use.", evidence: inferred },
    { capability: "observed_mcp_use", state: "observed", note: "One MCP invocation was observed.", evidence: observed },
    { capability: "explicit_skill_mention", state: "observed", note: "The Skill was named explicitly.", evidence: observed },
    { capability: "implicit_skill_activation", state: "inferred", note: "Activation was inferred, not explicitly named.", evidence: inferred },
    { capability: "complete_passive_capability_snapshot", state: "unavailable", note: "The producer does not provide this snapshot.", evidence: unavailable },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);
  const timeline = await screen.findByRole("region", { name: "Linear execution timeline" });
  await user.click(within(timeline).getByRole("button", { name: /Turn turn-evidence/i }));
  const inspector = screen.getByRole("region", { name: "Evidence inspector" });

  expect(within(inspector).getByText("gpt-5.6-codex", { exact: true })).toBeVisible();
  expect(within(inspector).getByText(/Provider transport attempts are not stable logical model requests/)).toBeVisible();
  expect(within(inspector).getByText("Attempt 3 · HTTP 429 · Failure", { exact: true })).toBeVisible();
  const categories = within(inspector).getByRole("group", { name: "Token categories" });
  expect(categories).toHaveTextContent("Input100");
  expect(categories).toHaveTextContent("Cached inputSource unavailable");
  expect(categories).toHaveTextContent("Output20");
  expect(categories).toHaveTextContent("Reasoning outputSource unavailable");
  expect(categories).toHaveTextContent("TotalSource unavailable");
  const context = within(inspector).getByRole("group", { name: "Context occupancy calculation" });
  expect(context).toHaveTextContent("Provider input Tokens ÷ reported Context window");
  expect(context).toHaveTextContent("100 input Tokens ÷ 200 Token window = 50.0%");
  expect(context).toHaveTextContent("cached input reuse is not included");
  expect(context).toHaveTextContent("no_exact_item_contract");
  const capabilities = within(inspector).getByRole("group", { name: "Capability distinctions" });
  expect(capabilities).toHaveTextContent("MCP configured · not proof of use");
  expect(capabilities).toHaveTextContent("MCP observed use · invocation evidence");
  expect(capabilities).toHaveTextContent("Skill explicit mention");
  expect(capabilities).toHaveTextContent("Skill implicit activation · inferred");
  expect(capabilities).toHaveTextContent("Unsupported capture · source unavailable");
  expect(capabilities).toHaveTextContent("The producer does not provide this snapshot.");
  expect(capabilities).toHaveTextContent("Next safe action · Check the adapter capture boundary; do not infer this capability.");
});

test("authenticated Organization activity uses the approved evidence-ledger visual contract", async () => {
  const detail = detailWithUnavailableUsage();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/organization/activity") ? activity() : detail;
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  render(<SessionInspector member={{ id: "member-1", displayName: "Ada", role: "member" }} />);

  const investigation = await screen.findByRole("region", { name: "Session investigation" });
  expect(investigation).toHaveAttribute("data-visual-system", "open-memory-ledger");
  expect(within(investigation).getByRole("heading", { name: "Organization activity" })).toBeVisible();
  expect(within(investigation).getByRole("heading", { name: "Session ledger" })).toBeVisible();
  expect(within(investigation).queryByRole("heading", { name: "Execution topology" })).not.toBeInTheDocument();
  expect(within(investigation).queryByRole("heading", { name: "Activity field" })).not.toBeInTheDocument();
  expect(within(investigation).queryByLabelText(/Execution topology/i)).not.toBeInTheDocument();
});
