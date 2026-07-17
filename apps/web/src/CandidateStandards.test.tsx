import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type {
  CandidateSubmissionResponse,
  OrganizationStandardDistribution,
} from "@workspace/contracts";

import { CandidateStandards } from "./CandidateStandards.js";

const pendingCandidate = {
  candidate: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "evidence-first",
    status: "pending_review",
    createdAt: "2026-07-17T00:00:00.000Z",
    deepLink: "/candidates/evidence-first",
  },
  version: {
    id: "22222222-2222-4222-8222-222222222222",
    version: "1.0.0",
    immutable: true,
    artifactHash: `sha256:${"a".repeat(64)}`,
    package: { files: [{ path: "SKILL.md", content: "Evidence first." }] },
    reviewerContext: "Review the captured evidence.",
    uncertainty: { level: "low", statement: "Observed directly." },
    claims: [],
    citations: [],
    submittedAt: "2026-07-17T00:00:00.000Z",
    submittedBy: {
      memberId: "33333333-3333-4333-8333-333333333333",
      analysisCredentialId: null,
    },
    review: {
      state: "pending_review",
      note: null,
      decidedAt: null,
      decidedByMemberId: null,
    },
  },
} satisfies CandidateSubmissionResponse;

const activeStandard = {
  standardId: "44444444-4444-4444-8444-444444444444",
  name: "evidence-first",
  state: "active",
  sequence: 1,
  target: null,
  previousReleaseId: null,
  releases: [],
  installations: [],
} satisfies OrganizationStandardDistribution;

test("a rejected Candidate Standards load shows an actionable retry for that load", async () => {
  const user = userEvent.setup();
  let loadAttempt = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/candidates")) {
      loadAttempt += 1;
      if (loadAttempt === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/organization-standards")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CandidateStandards />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Loading Candidate approvals and distribution status failed because the server could not be reached.",
  );

  await user.click(
    screen.getByRole("button", { name: "Try loading Candidate Standards again" }),
  );

  expect(await screen.findByText("No Candidate versions are awaiting review.")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/candidates"))).toHaveLength(2);
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/organization-standards"))).toHaveLength(2);
});

test("a rejected approval shows a retry that resubmits the exact approval", async () => {
  const user = userEvent.setup();
  let approvalAttempts = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/candidates")) {
      return new Response(JSON.stringify({ items: [pendingCandidate] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/organization-standards")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.endsWith("/approve")) {
      approvalAttempts += 1;
      if (approvalAttempts === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({}), { status: 201 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CandidateStandards />);
  await user.click(await screen.findByRole("button", { name: "Approve exact artifact" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Approving the exact Candidate artifact failed because the server could not be reached.",
  );

  await user.click(
    screen.getByRole("button", { name: "Try approving exact artifact again" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Approved the exact artifact as a mandatory Organization standard release.",
  );
  expect(approvalAttempts).toBe(2);
});

test("a rejected Candidate rejection retries the same review note", async () => {
  const user = userEvent.setup();
  const rejectionBodies: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/candidates")) {
      return new Response(JSON.stringify({ items: [pendingCandidate] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/organization-standards")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.endsWith("/reject")) {
      rejectionBodies.push(String(init?.body));
      if (rejectionBodies.length === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CandidateStandards />);
  await user.type(await screen.findByLabelText("Rejection reason"), "Evidence is incomplete.");
  await user.click(screen.getByRole("button", { name: "Reject version" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Rejecting the Candidate version failed because the server could not be reached.",
  );
  await user.click(
    screen.getByRole("button", { name: "Try rejecting Candidate version again" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Rejected this immutable Candidate version.",
  );
  expect(rejectionBodies).toEqual([
    JSON.stringify({ note: "Evidence is incomplete." }),
    JSON.stringify({ note: "Evidence is incomplete." }),
  ]);
});

test("a rejected Candidate edit retries the same immutable version payload", async () => {
  const user = userEvent.setup();
  const editBodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/candidates")) {
      return new Response(JSON.stringify({ items: [pendingCandidate] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/organization-standards")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.endsWith("/edit")) {
      editBodies.push(String(init?.body));
      if (editBodies.length === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({}), { status: 201 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<CandidateStandards />);
  await user.click(await screen.findByRole("button", { name: "Edit as new version" }));
  await user.type(screen.getByLabelText("New version"), "1.1.0");
  await user.click(screen.getByRole("button", { name: "Save unapproved version" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Creating a new immutable Candidate version failed because the server could not be reached.",
  );
  await user.click(
    screen.getByRole("button", { name: "Try saving unapproved version again" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Created a new immutable version. It is unapproved and requires fresh review.",
  );
  expect(editBodies).toHaveLength(2);
  expect(editBodies[1]).toBe(editBodies[0]);
});

test("a rejected distribution mutation retries only the same distribution action", async () => {
  const user = userEvent.setup();
  let pauseAttempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/candidates")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.endsWith("/api/v1/organization-standards")) {
      return new Response(JSON.stringify({ items: [activeStandard] }), { status: 200 });
    }
    if (url.endsWith("/pause")) {
      pauseAttempts += 1;
      if (pauseAttempts === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<CandidateStandards />);
  await user.click(await screen.findByRole("button", { name: "Pause distribution" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Pausing distribution failed because the server could not be reached.",
  );
  await user.click(
    screen.getByRole("button", { name: "Try pausing distribution again" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Distribution pause completed.",
  );
  expect(pauseAttempts).toBe(2);
});
