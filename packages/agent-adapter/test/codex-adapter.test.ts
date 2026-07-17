import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { adaptCodexObservation, createCodexSourceEvent } from "../src/index.js";

interface HookFixture {
  events: Array<{ captured_at: string; payload: Record<string, unknown> }>;
}

describe("Codex Agent-adapter contract", () => {
  it("maps documented hook Session and Turn identity while preserving untouched evidence", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("./fixtures/codex/0.144.5/hooks.sanitized.json", import.meta.url),
        "utf8",
      ),
    ) as HookFixture;
    const selected = fixture.events.find(
      (event) => event.payload.hook_event_name === "UserPromptSubmit",
    )!;
    const raw = {
      source: "codex_hook" as const,
      producer: { name: "codex" as const, version: "0.144.5" },
      producerEvent: "UserPromptSubmit",
      occurredAt: selected.captured_at,
      capturedAt: "2026-07-17T10:36:29.400Z",
      capturePath: "hook:UserPromptSubmit",
      payload: {
        ...selected.payload,
        future_additive_field: { nested: [true, 7, "<unknown-string-redacted>"] },
      },
    };
    const independentCopy = structuredClone(raw);

    const result = adaptCodexObservation(raw);

    expect(result.status).toBe("adapted");
    expect(result.raw).toEqual(independentCopy);
    expect(raw).toEqual(independentCopy);
    expect(result.canonical).toEqual([
      {
        kind: "turn_observed",
        sessionId: "session-probe-001",
        turnId: "turn-probe-001",
        occurredAt: "2026-07-17T10:36:29.354093+00:00",
        provenance: {
          source: "codex_hook",
          producerVersion: "0.144.5",
          parser: { name: "codex-agent-adapter", version: "1.0.0" },
          evidence: {
            stability: ["documented", "observed"],
            derivation: "exact",
            sourcePaths: ["$.payload.session_id", "$.payload.turn_id"],
          },
        },
      },
    ]);
    expect(result.capabilities.sessions).toMatchObject({
      availability: "exact_when_emitted",
      stability: "documented",
    });

    const event = createCodexSourceEvent({
      id: "f2ce0f31-cc82-4b94-895e-197d67e671d3",
      adapted: result,
      redaction: { policyVersion: 1, applied: false, evidence: [] },
    });
    expect(event).toMatchObject({
      source: "codex_hook",
      producer: { name: "codex", version: "0.144.5", event: "UserPromptSubmit" },
      parser: { name: "codex-agent-adapter", version: "1.0.0" },
      rawPayload: independentCopy.payload,
      canonicalObservations: result.canonical,
      adapter: { status: "adapted", capabilities: result.capabilities },
      deduplicationKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      payloadHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("downgrades unsupported producers and rejects their unstable fallback parsing", () => {
    const common = {
      producer: { name: "codex" as const, version: "99.0.0" },
      producerEvent: "SessionStart",
      occurredAt: "2026-07-17T10:36:29.304Z",
      capturedAt: "2026-07-17T10:36:29.400Z",
      payload: { session_id: "must-not-look-stable", parent_thread_id: "guess" },
    };

    const stable = adaptCodexObservation({
      ...common,
      source: "codex_hook",
      capturePath: "hook:SessionStart",
    });
    expect(stable).toMatchObject({
      status: "downgraded",
      canonical: [],
      reason: "unsupported_producer_version",
      capabilities: {
        sessions: { availability: "unavailable" },
        turns: { availability: "unavailable" },
      },
    });

    const unstable = adaptCodexObservation({
      ...common,
      source: "codex_rollout",
      capturePath: "rollout:key-only",
    });
    expect(unstable).toMatchObject({
      status: "rejected",
      canonical: [],
      reason: "unsupported_version_gated_source",
    });
    expect(unstable.raw).toEqual(expect.objectContaining(common));
  });
});
