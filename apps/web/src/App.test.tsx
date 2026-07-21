import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { App } from "./App.js";

const switchingPerson = {
  id: "person-switching",
  displayName: "Switching Person",
  email: "switching@example.test",
};

const membershipA = {
  organization: { id: "organization-a", name: "Organization A" },
  member: { id: "member-a", displayName: "Switching Person", role: "member" },
} as const;

const membershipB = {
  organization: { id: "organization-b", name: "Organization B" },
  member: { id: "member-b", displayName: "Switching Person", role: "member" },
} as const;

const emptyOrganizationActivity = {
  items: [],
  page: { total: 0, limit: 25, offset: 0 },
  aggregates: {
    activityStates: { live: 0, idle: 0, resumed: 0 },
    outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
    members: 0,
  },
};

function switchingFetch(initialMembership: typeof membershipA | null) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session") && !init?.method) {
      return new Response(JSON.stringify({
        person: switchingPerson,
        organization: initialMembership?.organization ?? null,
        member: initialMembership?.member ?? null,
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/person/memberships")) {
      return new Response(JSON.stringify({
        person: switchingPerson,
        memberships: [membershipA, membershipB],
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/session/active-membership") && init?.method === "PUT") {
      const requested = JSON.parse(String(init.body)) as { membershipId: string };
      if (requested.membershipId === "not-a-valid-membership") {
        return new Response(JSON.stringify({
          error: {
            code: "REQUEST_VALIDATION_FAILED",
            message: "The request did not match the API contract.",
          },
        }), { status: 400 });
      }
      const membership = [membershipA, membershipB].find(
        ({ member }) => member.id === requested.membershipId,
      );
      if (!membership) {
        return new Response(JSON.stringify({
          error: { code: "MEMBERSHIP_NOT_FOUND", message: "Membership not found." },
        }), { status: 404 });
      }
      return new Response(JSON.stringify({ person: switchingPerson, ...membership }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/v1/devices")) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    if (url.includes("/api/v1/organization/activity")) {
      return new Response(JSON.stringify(emptyOrganizationActivity), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

class TrackingEventSource {
  static instances: TrackingEventSource[] = [];
  static operations: string[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = true;
  readyState = TrackingEventSource.CONNECTING;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    TrackingEventSource.instances.push(this);
    TrackingEventSource.operations.push(`open:${this.url}`);
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  close() {
    this.closed = true;
    this.readyState = TrackingEventSource.CLOSED;
    TrackingEventSource.operations.push(`close:${this.url}`);
  }
}

test("an authenticated Person with no memberships can create and enter their first Organization", async () => {
  const user = userEvent.setup();
  const person = {
    id: "9bcd7058-d089-4f5b-926f-d0c14069e462",
    displayName: "No Membership Person",
    email: "person@example.test",
  };
  const membership = {
    organization: {
      id: "924f7331-bcff-422f-a446-9f9e04917375",
      name: "Created Organization",
    },
    member: {
      id: "741fe04c-1e2d-490d-a31d-63a2633c50ae",
      displayName: "No Membership Person",
      role: "administrator",
    },
  } as const;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session")) {
      return new Response(JSON.stringify({ person, organization: null, member: null }), { status: 200 });
    }
    if (url.endsWith("/api/v1/person/memberships")) {
      return new Response(JSON.stringify({ person, memberships: [] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/organizations") && init?.method === "POST") {
      return new Response(JSON.stringify({ person, ...membership }), { status: 201 });
    }
    if (url.endsWith("/api/v1/devices")) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    if (url.includes("/api/v1/organization/activity")) {
      return new Response(JSON.stringify({
        items: [],
        page: { total: 0, limit: 50, offset: 0 },
        aggregates: {
          activityStates: { live: 0, idle: 0, resumed: 0 },
          outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
          members: 0,
        },
      }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<App />);
  expect(await screen.findByText("No Organization memberships yet.")).toBeVisible();
  expect(screen.getByRole("main")).toHaveAttribute("data-visual-system", "open-memory-ledger");
  expect(screen.getByRole("main")).toHaveAttribute("data-view", "person");
  expect(screen.getByRole("heading", { name: "Welcome, No Membership Person" }).closest("section")).toHaveClass("onboarding-card");
  expect(screen.getByRole("heading", { name: "No Organization memberships yet." }).closest("section")).toHaveClass("organization-access-card");
  await user.type(screen.getByLabelText("New Organization name"), "Created Organization");
  await user.click(screen.getByRole("button", { name: "Create Organization" }));

  expect(await screen.findByRole("heading", { name: "Welcome, No Membership Person" })).toBeVisible();
  expect(window.location.search).toBe(`?membership=${membership.member.id}`);
});

test("a rejected enrollment operation shows an actionable operation-specific alert", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session")) {
      return new Response(JSON.stringify({
        organization: { id: "organization-1", name: "Acme" },
        member: { id: "member-1", displayName: "Ada", role: "member" },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/devices")) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/person/memberships")) {
      return new Response(JSON.stringify({
        person: { id: "person-1", displayName: "Ada", email: null },
        memberships: [],
      }), { status: 200 });
    }
    if (url.includes("/api/v1/organization/activity")) {
      return new Response(JSON.stringify({
        items: [],
        page: { total: 0, limit: 50, offset: 0 },
        aggregates: {
          activityStates: { live: 0, idle: 0, resumed: 0 },
          outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
          members: 0,
        },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/device-enrollment-grants")) {
      throw new TypeError("Failed to fetch");
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<App />);
  await screen.findByRole("heading", { name: "Welcome, Ada" });
  await user.type(screen.getByLabelText("Device name"), "Ada's Mac");
  await user.click(screen.getByRole("button", { name: "Create enrollment grant" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Creating an enrollment grant failed");
  expect(screen.getByRole("button", { name: "Try creating enrollment grant" })).toBeEnabled();
});

test("a rejected logout keeps the session visible and retries only logout", async () => {
  const user = userEvent.setup();
  let logoutAttempts = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session")) {
      return new Response(JSON.stringify({
        organization: { id: "organization-1", name: "Acme" },
        member: { id: "member-1", displayName: "Ada", role: "member" },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/devices")) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/person/memberships")) {
      return new Response(JSON.stringify({
        person: { id: "person-1", displayName: "Ada", email: null },
        memberships: [],
      }), { status: 200 });
    }
    if (url.includes("/api/v1/organization/activity")) {
      return new Response(JSON.stringify({
        items: [],
        page: { total: 0, limit: 50, offset: 0 },
        aggregates: {
          activityStates: { live: 0, idle: 0, resumed: 0 },
          outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
          members: 0,
        },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/session/logout")) {
      logoutAttempts += 1;
      if (logoutAttempts === 1) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await screen.findByRole("heading", { name: "Welcome, Ada" });
  await user.click(screen.getByRole("button", { name: "Log out" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Logging out failed. The server could not be reached. Check the connection and try again.",
  );
  expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Try logging out again" }));

  expect(await screen.findByRole("heading", { name: "Redeem your Invite code" })).toBeVisible();
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/session/logout"))).toHaveLength(2);
});

test("an Administrator can import rich-v1 with exact permanently Seeded receipt counts", async () => {
  const user = userEvent.setup();
  const person = {
    id: "5cf28e4a-5ef2-40f2-a0ba-1980bf8c82ab",
    displayName: "Example Administrator",
    email: null,
  };
  const organization = {
    id: "e3861529-157d-44cb-a064-d2d4f1ac7a62",
    name: "Example Organization",
  };
  const member = {
    id: "853838d6-7f0d-4847-b131-e648e9bc5d4f",
    displayName: "Example Administrator",
    role: "administrator",
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session")) {
      return new Response(JSON.stringify({ person, organization, member }), { status: 200 });
    }
    if (url.endsWith("/api/v1/person/memberships")) {
      return new Response(JSON.stringify({
        person,
        memberships: [{ organization, member }],
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/devices")) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    if (url.includes("/api/v1/organization/activity")) {
      return new Response(JSON.stringify({
        items: [],
        page: { total: 0, limit: 50, offset: 0 },
        aggregates: {
          activityStates: { live: 0, idle: 0, resumed: 0 },
          outcomes: { successful: 0, partial: 0, failed: 0, unknown: 0 },
          members: 0,
        },
      }), { status: 200 });
    }
    if (url.endsWith("/api/v1/administration/example-packs/rich-v1/import")) {
      return new Response(JSON.stringify({
        version: "rich-v1",
        imported: true,
        exampleMemberId: "702ef325-75d8-4444-a339-8b03e3197371",
        sessionIds: [],
        syntheticDesignation: "seeded",
        counts: {
          members: 12,
          sessions: 480,
          turns: 1088,
          agentRuns: 864,
          detailRecords: 3104,
        },
      }), { status: 201 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await user.click(await screen.findByRole("button", {
    name: "Import rich-v1 Example pack — 12 members, 480 Sessions",
  }));

  expect(await screen.findByText(/12 Example members, 480 Seeded Sessions, 1,088 Turns, 864 Agent runs, and 3,104 detail records/)).toHaveTextContent(
    "permanently labelled Seeded/Example",
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/administration/example-packs/rich-v1/import",
    { method: "POST" },
  );
});

test("switching Organizations closes the old live stream before the new membership opens one", async () => {
  const user = userEvent.setup();
  TrackingEventSource.instances = [];
  TrackingEventSource.operations = [];
  vi.stubGlobal("EventSource", TrackingEventSource);
  vi.stubGlobal("fetch", switchingFetch(membershipA));

  render(<App />);
  expect(await screen.findByText("Organization A")).toBeVisible();
  await waitFor(() => expect(TrackingEventSource.instances).toHaveLength(1));

  await user.selectOptions(
    screen.getByRole("combobox", { name: "Active Organization" }),
    membershipB.member.id,
  );

  expect(await screen.findByText("Organization B")).toBeVisible();
  await waitFor(() => expect(TrackingEventSource.instances).toHaveLength(2));
  expect(TrackingEventSource.instances[0]).toMatchObject({
    url: "/api/v1/live",
    closed: true,
    readyState: TrackingEventSource.CLOSED,
  });
  expect(TrackingEventSource.instances[1]).toMatchObject({
    url: "/api/v1/live",
    closed: false,
    readyState: TrackingEventSource.CONNECTING,
  });
  expect(TrackingEventSource.operations).toEqual([
    "open:/api/v1/live",
    "close:/api/v1/live",
    "open:/api/v1/live",
  ]);
  expect(window.location.search).toBe(`?membership=${membershipB.member.id}`);
});

test("Back to the unscoped root canonicalizes to the active Organization", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", switchingFetch(null));

  render(<App />);
  await screen.findByRole("heading", { name: "Welcome, Switching Person" });
  await user.click(screen.getByRole("button", { name: "Organization A — Member" }));
  expect(await screen.findByText("Organization A")).toBeVisible();
  expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);

  act(() => {
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await waitFor(() => {
    expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);
  });
  expect(screen.getByText("Organization A")).toBeVisible();
});

test.each([
  ["foreign", "00000000-0000-4000-8000-000000000099", "Membership not found."],
  ["malformed", "not-a-valid-membership", "The request did not match the API contract."],
])("a %s membership popstate returns URL, UI, and live stream to the active Organization", async (_kind, requestedMembership, expectedError) => {
  TrackingEventSource.instances = [];
  vi.stubGlobal("EventSource", TrackingEventSource);
  vi.stubGlobal("fetch", switchingFetch(membershipA));

  render(<App />);
  expect(await screen.findByText("Organization A")).toBeVisible();
  await waitFor(() => expect(TrackingEventSource.instances).toHaveLength(1));

  act(() => {
    window.history.pushState({}, "", `?membership=${requestedMembership}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    `Selecting the Organization failed. ${expectedError}`,
  );
  await waitFor(() => {
    expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);
  });
  expect(screen.getByText("Organization A")).toBeVisible();
  expect(TrackingEventSource.instances).toHaveLength(1);
  expect(TrackingEventSource.instances[0]?.closed).toBe(false);
});

test("a stale popstate response cannot replace the newer Organization and is corrected on the server", async () => {
  TrackingEventSource.instances = [];
  vi.stubGlobal("EventSource", TrackingEventSource);
  const baseFetch = switchingFetch(membershipA);
  const requestedMemberships: string[] = [];
  let resolveStaleSelection: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session/active-membership") && init?.method === "PUT") {
      const requested = JSON.parse(String(init.body)) as { membershipId: string };
      requestedMemberships.push(requested.membershipId);
      if (requested.membershipId === membershipB.member.id && requestedMemberships.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveStaleSelection = resolve;
        });
      }
    }
    return baseFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  expect(await screen.findByText("Organization A")).toBeVisible();
  await waitFor(() => expect(TrackingEventSource.instances).toHaveLength(1));

  act(() => {
    window.history.pushState({}, "", `?membership=${membershipB.member.id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() => expect(requestedMemberships).toEqual([membershipB.member.id]));
  act(() => {
    window.history.replaceState({}, "", `?membership=${membershipA.member.id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  act(() => {
    resolveStaleSelection?.(new Response(JSON.stringify({
      person: switchingPerson,
      ...membershipB,
    }), { status: 200 }));
  });

  await waitFor(() => {
    expect(requestedMemberships).toEqual([
      membershipB.member.id,
      membershipA.member.id,
    ]);
  });
  expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);
  expect(screen.getByText("Organization A")).toBeVisible();
  expect(screen.queryByText("Organization B")).toBeNull();
  expect(TrackingEventSource.instances).toHaveLength(1);
});

test("Back to root during a returning Person's first selection canonicalizes to the membership the server activated", async () => {
  TrackingEventSource.instances = [];
  vi.stubGlobal("EventSource", TrackingEventSource);
  const baseFetch = switchingFetch(null);
  const requestedMemberships: string[] = [];
  let resolveStaleSelection: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session/active-membership") && init?.method === "PUT") {
      const requested = JSON.parse(String(init.body)) as { membershipId: string };
      requestedMemberships.push(requested.membershipId);
      if (requestedMemberships.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveStaleSelection = resolve;
        });
      }
    }
    return baseFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await screen.findByRole("heading", { name: "Welcome, Switching Person" });
  expect(TrackingEventSource.instances).toHaveLength(0);

  act(() => {
    window.history.pushState({}, "", `?membership=${membershipB.member.id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() => expect(requestedMemberships).toEqual([membershipB.member.id]));
  act(() => {
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    resolveStaleSelection?.(new Response(JSON.stringify({
      person: switchingPerson,
      ...membershipB,
    }), { status: 200 }));
  });

  await waitFor(() => {
    expect(requestedMemberships).toEqual([
      membershipB.member.id,
      membershipB.member.id,
    ]);
  });
  expect(await screen.findByText("Organization B")).toBeVisible();
  expect(window.location.search).toBe(`?membership=${membershipB.member.id}`);
  expect(TrackingEventSource.instances).toHaveLength(1);
});

test("rapid direct Organization selections keep the last choice after responses arrive out of order", async () => {
  TrackingEventSource.instances = [];
  vi.stubGlobal("EventSource", TrackingEventSource);
  const baseFetch = switchingFetch(membershipA);
  const requestedMemberships: string[] = [];
  let resolveStaleSelection: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/session/active-membership") && init?.method === "PUT") {
      const requested = JSON.parse(String(init.body)) as { membershipId: string };
      requestedMemberships.push(requested.membershipId);
      if (requested.membershipId === membershipB.member.id && requestedMemberships.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveStaleSelection = resolve;
        });
      }
    }
    return baseFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  expect(await screen.findByText("Organization A")).toBeVisible();
  const selector = screen.getByRole("combobox", { name: "Active Organization" });
  fireEvent.change(selector, { target: { value: membershipB.member.id } });
  await waitFor(() => expect(requestedMemberships).toEqual([membershipB.member.id]));
  fireEvent.change(selector, { target: { value: membershipA.member.id } });
  await waitFor(() => expect(requestedMemberships).toEqual([
    membershipB.member.id,
    membershipA.member.id,
  ]));
  act(() => {
    resolveStaleSelection?.(new Response(JSON.stringify({
      person: switchingPerson,
      ...membershipB,
    }), { status: 200 }));
  });

  await waitFor(() => expect(requestedMemberships).toEqual([
    membershipB.member.id,
    membershipA.member.id,
    membershipA.member.id,
  ]));
  expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);
  expect(screen.getByText("Organization A")).toBeVisible();
  expect(screen.queryByText("Organization B")).toBeNull();
  expect(TrackingEventSource.instances).toHaveLength(1);
});

test("delayed deep-link hydration cannot overwrite a newer browser membership navigation", async () => {
  window.history.replaceState({}, "", `?membership=${membershipB.member.id}`);
  const baseFetch = switchingFetch(null);
  const requestedMemberships: string[] = [];
  let resolveInitialMemberships: ((response: Response) => void) | undefined;
  let membershipLoads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/person/memberships")) {
      membershipLoads += 1;
      if (membershipLoads === 1) {
        return new Promise<Response>((resolve) => {
          resolveInitialMemberships = resolve;
        });
      }
    }
    if (url.endsWith("/api/v1/session/active-membership") && init?.method === "PUT") {
      const requested = JSON.parse(String(init.body)) as { membershipId: string };
      requestedMemberships.push(requested.membershipId);
    }
    return baseFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await waitFor(() => expect(resolveInitialMemberships).toBeTypeOf("function"));
  act(() => {
    window.history.replaceState({}, "", `?membership=${membershipA.member.id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(await screen.findByText("Organization A")).toBeVisible();
  expect(requestedMemberships).toEqual([membershipA.member.id]);

  await act(async () => {
    resolveInitialMemberships?.(new Response(JSON.stringify({
      person: switchingPerson,
      memberships: [membershipA, membershipB],
    }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(requestedMemberships).toEqual([membershipA.member.id]);
  expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);
  expect(screen.getByText("Organization A")).toBeVisible();
  expect(screen.queryByText("Organization B")).toBeNull();
});

test("Back to root during delayed hydration commits the server-active Organization instead of remaining loading", async () => {
  window.history.replaceState({}, "", `?membership=${membershipB.member.id}`);
  const baseFetch = switchingFetch(membershipA);
  const requestedMemberships: string[] = [];
  let resolveInitialMemberships: ((response: Response) => void) | undefined;
  let membershipLoads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/person/memberships")) {
      membershipLoads += 1;
      if (membershipLoads === 1) {
        return new Promise<Response>((resolve) => {
          resolveInitialMemberships = resolve;
        });
      }
    }
    if (url.endsWith("/api/v1/session/active-membership") && init?.method === "PUT") {
      const requested = JSON.parse(String(init.body)) as { membershipId: string };
      requestedMemberships.push(requested.membershipId);
    }
    return baseFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await waitFor(() => expect(resolveInitialMemberships).toBeTypeOf("function"));
  act(() => {
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  expect(await screen.findByText("Organization A")).toBeVisible();
  expect(requestedMemberships).toEqual([membershipA.member.id]);
  expect(window.location.search).toBe(`?membership=${membershipA.member.id}`);

  await act(async () => {
    resolveInitialMemberships?.(new Response(JSON.stringify({
      person: switchingPerson,
      memberships: [membershipA, membershipB],
    }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByText("Organization A")).toBeVisible();
  expect(screen.queryByText("Connecting to the server…")).toBeNull();
});

test("Back to root during memberless Google hydration reaches returning-Person onboarding", async () => {
  window.history.replaceState({}, "", `?membership=${membershipB.member.id}`);
  const baseFetch = switchingFetch(null);
  let resolveInitialMemberships: ((response: Response) => void) | undefined;
  let membershipLoads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/person/memberships")) {
      membershipLoads += 1;
      if (membershipLoads === 1) {
        return new Promise<Response>((resolve) => {
          resolveInitialMemberships = resolve;
        });
      }
    }
    return baseFetch(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  await waitFor(() => expect(resolveInitialMemberships).toBeTypeOf("function"));
  act(() => {
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await act(async () => {
    resolveInitialMemberships?.(new Response(JSON.stringify({
      person: switchingPerson,
      memberships: [membershipA, membershipB],
    }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(await screen.findByRole("heading", {
    name: "Welcome, Switching Person",
  })).toBeVisible();
  expect(window.location.search).toBe("");
  expect(screen.queryByText("Connecting to the server…")).toBeNull();
});
