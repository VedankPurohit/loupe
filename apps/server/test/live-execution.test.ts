import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adaptCodexObservation,
  createCodexSourceEvent,
  type CodexSourceObservation,
} from "@workspace/agent-adapter";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

interface HookFixture {
  events: Array<{ captured_at: string; payload: Record<string, unknown> }>;
}

interface OtelFixture {
  records: Array<{
    scope: { name: string };
    log_record: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
  }>;
}

function toSourceEvent(event: HookFixture["events"][number]) {
  const raw: CodexSourceObservation = {
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5" },
    producerEvent: String(event.payload.hook_event_name),
    occurredAt: new Date(event.captured_at).toISOString(),
    capturedAt: new Date(event.captured_at).toISOString(),
    capturePath: `hook:${String(event.payload.hook_event_name)}`,
    payload: event.payload,
  };
  return createCodexSourceEvent({
    id: randomUUID(),
    adapted: adaptCodexObservation(raw),
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  });
}

function toOtelSourceEvent(record: OtelFixture["records"][number]) {
  const raw: CodexSourceObservation = {
    source: "codex_otel_log",
    producer: { name: "codex", version: "0.144.5" },
    producerEvent: "codex.agent_communication",
    occurredAt: "2026-07-17T10:48:00.000Z",
    capturedAt: "2026-07-17T10:48:00.100Z",
    capturePath: "otel:logs",
    payload: record as unknown as Record<string, unknown>,
  };
  return createCodexSourceEvent({
    id: randomUUID(),
    adapted: adaptCodexObservation(raw),
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  });
}

function attributeMap(record: OtelFixture["records"][number]) {
  return Object.fromEntries(
    record.log_record.attributes.map(({ key, value }) => [
      key,
      value.stringValue ?? value.intValue ?? value.boolValue,
    ]),
  );
}

async function deliver(
  baseUrl: string,
  deviceCredential: string,
  events: unknown[],
) {
  return fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deviceCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ batchId: randomUUID(), events }),
  });
}

describe.sequential("live execution projection through /api/v1", () => {
  const testDatabase = createTestDatabase("live_execution");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let browserCookie: string;
  let deviceCredential: string;
  let hooks: HookFixture;
  let otel: OtelFixture;

  beforeAll(async () => {
    hooks = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/agent-adapter/test/fixtures/codex/0.144.5/hooks.sanitized.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as HookFixture;
    otel = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/agent-adapter/test/fixtures/codex/0.144.5/otel-logs.sanitized.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as OtelFixture;
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    let bootstrapCode: string | undefined;
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const bootstrap = await fetch(`${baseUrl}/api/v1/bootstrap/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: bootstrapCode,
        organization: { name: "Projection Lab" },
        administrator: { displayName: "Grace Hopper" },
      }),
    });
    browserCookie = bootstrap.headers.getSetCookie()[0]!.split(";", 1)[0]!;
    const grantResponse = await fetch(
      `${baseUrl}/api/v1/device-enrollment-grants`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: browserCookie },
        body: JSON.stringify({ deviceName: "Fixture Mac" }),
      },
    );
    const grant = (await grantResponse.json()) as { grant: string };
    const enrollment = await fetch(
      `${baseUrl}/api/v1/device-enrollments/redeem`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: grant.grant }),
      },
    );
    deviceCredential = (
      (await enrollment.json()) as { credential: string }
    ).credential;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("projects real hook evidence into one resumable Session, canonical Turns, and one Root", async () => {
    const fixtureEvents = hooks.events.filter(
      ({ payload }) => payload.session_id === "session-probe-001",
    );
    const delivered = await deliver(
      baseUrl,
      deviceCredential,
      fixtureEvents.map(toSourceEvent),
    );
    expect(delivered.status).toBe(200);

    const inspected = await fetch(
      `${baseUrl}/api/v1/sessions/session-probe-001`,
      { headers: { cookie: browserCookie } },
    );
    expect(inspected.status).toBe(200);
    const detail = (await inspected.json()) as {
      session: {
        id: string;
        activityState: string;
        completion: { status: string; evidence: string };
        rootAgentRunId: string;
      };
      activities: Array<{ source: string }>;
      turns: Array<{ id: string; evidence: { derivation: string } }>;
      agentRuns: Array<{ id: string; kind: string }>;
    };
    expect(detail.session).toMatchObject({
      id: "session-probe-001",
      activityState: "idle",
      completion: { status: "not_assumed", evidence: "unavailable" },
    });
    expect(detail.activities.filter(({ source }) => source === "resume")).toHaveLength(5);
    expect(detail.turns.map(({ id }) => id)).toEqual([
      "turn-probe-001",
      "turn-probe-002",
      "turn-probe-003",
      "turn-probe-004",
      "turn-probe-005",
      "turn-probe-006",
      "turn-probe-007",
      "turn-probe-008",
    ]);
    expect(detail.turns.every(({ evidence }) => evidence.derivation === "exact")).toBe(true);
    expect(detail.agentRuns.filter(({ kind }) => kind === "root")).toEqual([
      expect.objectContaining({ id: detail.session.rootAgentRunId }),
    ]);
  });

  it("keeps tree identity separate from thread identity and reconciles supported parent edges explicitly", async () => {
    const before = await fetch(`${baseUrl}/api/v1/sessions/session-probe-001`, {
      headers: { cookie: browserCookie },
    });
    const beforeDetail = (await before.json()) as {
      agentRuns: Array<{
        id: string;
        parentEdge: { status: string; parentAgentRunId: string | null } | null;
      }>;
    };
    expect(
      beforeDetail.agentRuns.find(({ id }) => id === "agent-run-probe-001")
        ?.parentEdge,
    ).toMatchObject({ status: "inferred", parentAgentRunId: "root:session-probe-001" });
    expect(
      beforeDetail.agentRuns.find(({ id }) => id === "agent-run-probe-002")
        ?.parentEdge,
    ).toMatchObject({ status: "unresolved", parentAgentRunId: null });

    const spawnRecords = otel.records.filter((record) => {
      const attributes = attributeMap(record);
      return (
        record.scope.name === "codex_otel.agent_communication" &&
        attributes.kind === "spawn" &&
        attributes.state === "send"
      );
    });
    expect(spawnRecords).toHaveLength(2);
    const events = spawnRecords.map(toOtelSourceEvent);
    expect((await deliver(baseUrl, deviceCredential, events)).status).toBe(200);

    const inspected = await fetch(`${baseUrl}/api/v1/sessions/session-probe-001`, {
      headers: { cookie: browserCookie },
    });
    const detail = (await inspected.json()) as {
      session: { id: string; rootAgentRunId: string };
      agentRuns: Array<{
        id: string;
        kind: string;
        codexThreadId: string | null;
        parentEdge: {
          status: string;
          parentAgentRunId: string | null;
          reconciliation: {
            inputs: Array<{ derivation: string; source: string }>;
            rule: string;
            selectedValue: string | null;
            confidence: string;
          };
        } | null;
      }>;
    };
    const root = detail.agentRuns.find(({ kind }) => kind === "root")!;
    expect(root.codexThreadId).toBe("agent-run-probe-003");
    expect(root.codexThreadId).not.toBe(detail.session.id);
    const child = detail.agentRuns.find(({ id }) => id === "agent-run-probe-001")!;
    expect(child.parentEdge).toMatchObject({
      status: "exact",
      parentAgentRunId: detail.session.rootAgentRunId,
      reconciliation: {
        rule: "prefer_exact_parent_observation",
        selectedValue: detail.session.rootAgentRunId,
        confidence: "high",
      },
    });
    expect(child.parentEdge!.reconciliation.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ derivation: "inferred", source: "hook:SubagentStart" }),
        expect.objectContaining({ derivation: "exact", source: "otel:codex.agent_communication" }),
      ]),
    );
    expect(
      detail.agentRuns.find(({ id }) => id === "agent-run-probe-002")
        ?.parentEdge,
    ).toMatchObject({
      status: "exact",
      parentAgentRunId: "agent-run-probe-001",
      reconciliation: {
        rule: "prefer_exact_parent_observation",
        selectedValue: "agent-run-probe-001",
        confidence: "high",
      },
    });

    const replay = await deliver(baseUrl, deviceCredential, events);
    expect(await replay.json()).toMatchObject({
      results: events.map((event) => ({ eventId: event.id, status: "duplicate" })),
    });
    const afterReplay = await fetch(
      `${baseUrl}/api/v1/sessions/session-probe-001`,
      { headers: { cookie: browserCookie } },
    );
    expect(await afterReplay.json()).toEqual(detail);
  });

  it("streams ordered authenticated invalidations and recovers through an ordinary query", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/live`);
    expect(unauthenticated.status).toBe(401);

    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/v1/live`, {
      headers: { cookie: browserCookie },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();

    const sessionTwoStart = hooks.events.find(
      ({ payload }) =>
        payload.session_id === "session-probe-002" &&
        payload.hook_event_name === "SessionStart",
    )!;
    expect(
      (await deliver(baseUrl, deviceCredential, [toSourceEvent(sessionTwoStart)])).status,
    ).toBe(200);

    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 5_000;
    while ((text.match(/event: session\.updated/g) ?? []).length < 2) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for SSE updates.");
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    const events = [...text.matchAll(/data: (\{[^\n]+\})/g)].map((match) =>
      JSON.parse(match[1]!) as { sequence: number; sessionId: string },
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      [...events.map(({ sequence }) => sequence)].sort((left, right) => left - right),
    );
    expect(events.some(({ sessionId }) => sessionId === "session-probe-002")).toBe(true);
    controller.abort();

    const recovered = await fetch(`${baseUrl}/api/v1/sessions/session-probe-002`, {
      headers: { cookie: browserCookie },
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({
      session: {
        id: "session-probe-002",
        activityState: "live",
        completion: { status: "not_assumed", evidence: "unavailable" },
      },
    });
  });
});
