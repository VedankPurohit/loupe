import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SourceEvent } from "@workspace/contracts";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function turnEvent(sessionId: string, turnId: string, occurredAt: string): SourceEvent {
  const id = randomUUID();
  const rawPayload = {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    turn_id: turnId,
    source: "startup",
    model: "gpt-comparison-fixture",
    tool_name: "shell",
  };
  return {
    schemaVersion: "1",
    id,
    deduplicationKey: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "SessionStart" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt,
    capturedAt: occurredAt,
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
}

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  return String(serialized).split(";", 1)[0]!;
}

describe.sequential("Session and Turn comparisons through /api/v1", () => {
  const testDatabase = createTestDatabase("session_comparison");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let browserCookie: string;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    let bootstrapCode: string | undefined;
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Comparison Lab" },
        administrator: { displayName: "Coach" },
      },
    });
    browserCookie = cookie(bootstrap);
    const grant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Comparison Mac" },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: grant.json().grant },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/device/source-event-batches",
      headers: { authorization: `Bearer ${enrollment.json().credential}` },
      payload: {
        batchId: randomUUID(),
        events: [
          turnEvent("session-compare-a", "turn-compare-a", "2026-07-17T13:00:00.000Z"),
          turnEvent("session-compare-b", "turn-compare-b", "2026-07-17T13:05:00.000Z"),
        ],
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("labels two selected real Turns as a Repeated pattern with navigable authorized citations, but one as a single-case hypothesis", async () => {
    const selections = [
      { scope: "turn", sessionId: "session-compare-a", turnId: "turn-compare-a" },
      { scope: "turn", sessionId: "session-compare-b", turnId: "turn-compare-b" },
    ];
    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { cookie: browserCookie },
      payload: {
        selections,
        filters: { repository: "manually-selected" },
        includeSeeded: false,
        claim: { kind: "pattern", statement: "The selected Turns used the same workflow." },
      },
    });

    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({
      population: {
        selected: selections,
        selectedSessions: 2,
        selectedTurns: 2,
        distinctRealTurns: 2,
        seededTurns: 0,
      },
      filters: { repository: "manually-selected" },
      syntheticInclusion: "excluded",
      completeness: { status: "complete", selected: 2, resolved: 2, missing: [] },
      claim: {
        classification: "repeated_pattern",
        status: "supported",
        refusal: null,
      },
    });
    expect(repeated.json().citations).toHaveLength(2);
    expect(repeated.json().citations[0]).toMatchObject({
      synthetic: "real",
      links: {
        session: expect.stringMatching(/^\/api\/v1\/sessions\//),
        turn: expect.stringMatching(/^\/api\/v1\/sessions\/[^/]+\/turns\//),
        activity: expect.stringMatching(/^\/api\/v1\/sessions\/[^/]+\/activity\//),
        browser: expect.stringContaining("turn="),
      },
    });

    for (const key of ["session", "turn", "activity"] as const) {
      const path = repeated.json().citations[0].links[key] as string;
      const unauthorized = await app.inject({ method: "GET", url: path });
      expect(unauthorized.statusCode).toBe(401);
      const authorized = await app.inject({
        method: "GET",
        url: path,
        headers: { cookie: browserCookie },
      });
      expect(authorized.statusCode).toBe(200);
    }

    const single = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { cookie: browserCookie },
      payload: {
        selections: selections.slice(0, 1),
        includeSeeded: false,
        claim: { kind: "pattern", statement: "This workflow may recur." },
      },
    });
    expect(single.statusCode).toBe(200);
    expect(single.json()).toMatchObject({
      population: { distinctRealTurns: 1 },
      claim: {
        classification: "single_case_hypothesis",
        status: "supported",
        refusal: null,
      },
    });
  });

  it("keeps an explicitly included Seeded Turn illustrative and refuses unsupported outcome, causal, and productivity claims with stable reasons", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/administration/example-packs/starter-v1/import",
      headers: { cookie: browserCookie },
    });
    expect(imported.statusCode).toBe(200);

    const withSeeded = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { cookie: browserCookie },
      payload: {
        selections: [
          { scope: "turn", sessionId: "session-compare-a", turnId: "turn-compare-a" },
          {
            scope: "turn",
            sessionId: "seeded-starter-compilation",
            turnId: "seeded-turn-compilation",
          },
        ],
        includeSeeded: true,
        claim: { kind: "pattern", statement: "The workflow appears in both examples." },
      },
    });
    expect(withSeeded.statusCode).toBe(200);
    expect(withSeeded.json()).toMatchObject({
      population: { selectedTurns: 2, distinctRealTurns: 1, seededTurns: 1 },
      syntheticInclusion: "included_for_illustration",
      claim: {
        classification: "single_case_hypothesis",
        status: "supported",
        refusal: null,
      },
    });
    expect(withSeeded.json().subjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selection: expect.objectContaining({
            sessionId: "seeded-starter-compilation",
          }),
          synthetic: "seeded",
        }),
      ]),
    );

    const metricSignals = [
      "token_usage",
      "cost",
      "duration",
      "tool_count",
      "model_choice",
      "correlation",
    ];
    const expectedRefusals = {
      outcome: "INSUFFICIENT_OUTCOME_EVIDENCE",
      causal: "INSUFFICIENT_CAUSAL_EVIDENCE",
      productivity: "INSUFFICIENT_PRODUCTIVITY_EVIDENCE",
    } as const;
    for (const [kind, code] of Object.entries(expectedRefusals)) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/comparisons",
        headers: { cookie: browserCookie },
        payload: {
          selections: [
            { scope: "turn", sessionId: "session-compare-a", turnId: "turn-compare-a" },
            { scope: "turn", sessionId: "session-compare-b", turnId: "turn-compare-b" },
          ],
          claim: {
            kind,
            statement: `The metric signals prove ${kind}.`,
            signals: metricSignals,
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        claim: {
          classification: "unsupported",
          status: "refused",
          refusal: { code },
          caveats: [expect.stringContaining("descriptive signals only")],
        },
      });
    }
  });
});
