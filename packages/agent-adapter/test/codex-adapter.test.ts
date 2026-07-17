import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  adaptCodexObservation,
  analyzeCodexEvidence,
  createCodexSourceEvent,
} from "../src/index.js";

interface HookFixture {
  events: Array<{ captured_at: string; payload: Record<string, unknown> }>;
}

describe("Codex Agent-adapter contract", () => {
  it("keeps provider completion Token categories separate from inferred Context occupancy and estimated cost", () => {
    const observedAt = "2026-07-17T10:36:30.000Z";
    const evidence = analyzeCodexEvidence(
      [
        {
          sourceEventId: "a205fbda-865e-41a9-8d95-1e1e26a5b4ee",
          observation: {
            source: "codex_otel_log",
            producer: { name: "codex", version: "0.144.5" },
            producerEvent: "codex.conversation_starts",
            occurredAt: "2026-07-17T10:36:20.000Z",
            capturedAt: "2026-07-17T10:36:20.100Z",
            capturePath: "otel:logs",
            payload: {
              log_record: {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.conversation_starts" } },
                  { key: "conversation.id", value: { stringValue: "thread-1" } },
                  { key: "model", value: { stringValue: "fixture-model" } },
                  { key: "context_window", value: { intValue: "100000" } },
                  { key: "auto_compact_token_limit", value: { intValue: "80000" } },
                ],
              },
            },
          },
        },
        {
          sourceEventId: "442b3482-c8fb-49e5-b810-56dad430ab7a",
          observation: {
            source: "codex_otel_log",
            producer: { name: "codex", version: "0.144.5" },
            producerEvent: "codex.sse_event",
            occurredAt: observedAt,
            capturedAt: "2026-07-17T10:36:30.100Z",
            capturePath: "otel:logs",
            payload: {
              log_record: {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.sse_event" } },
                  { key: "event.kind", value: { stringValue: "response.completed" } },
                  { key: "conversation.id", value: { stringValue: "thread-1" } },
                  { key: "model", value: { stringValue: "fixture-model" } },
                  { key: "input_token_count", value: { intValue: "25000" } },
                  { key: "cached_token_count", value: { intValue: "10000" } },
                  { key: "output_token_count", value: { intValue: "2000" } },
                  { key: "reasoning_token_count", value: { intValue: "500" } },
                  { key: "tool_token_count", value: { intValue: "27000" } },
                ],
              },
            },
          },
        },
      ],
      {
        turns: [
          {
            id: "turn-1",
            firstObservedAt: "2026-07-17T10:36:25.000Z",
            lastObservedAt: "2026-07-17T10:36:35.000Z",
          },
        ],
        priceTable: {
          version: "fixture-prices-v1",
          currency: "USD",
          effectiveDate: "2026-07-01",
          modelMappings: { "fixture-model": "fixture-priced-model" },
          pricesPerMillionTokens: {
            "fixture-priced-model": {
              input: 2,
              cachedInput: 0.5,
              output: 8,
              reasoningOutput: 12,
            },
          },
          billingCaveat:
            "API-equivalent estimate only; it is not a provider bill or ChatGPT plan-credit balance.",
        },
      },
    );

    expect(evidence.tokenUsage).toEqual([
      expect.objectContaining({
        occurredAt: observedAt,
        sourceKind: "provider_completion",
        model: "fixture-model",
        categories: {
          input: 25000,
          cachedInput: 10000,
          output: 2000,
          reasoningOutput: 500,
          total: 27000,
        },
        turnAssociation: {
          turnId: "turn-1",
          strength: "inferred",
          method: "log_time_within_canonical_turn",
        },
      }),
    ]);
    expect(evidence.context.occupancy).toEqual([
      expect.objectContaining({
        occupancyTokens: 25000,
        occupancyPercent: 25,
        method: "provider_input_tokens_over_reported_context_window",
        inputs: { inputTokens: 25000, contextWindow: 100000 },
        missingAssumptions: [
          "Provider input usage may not equal the exact serialized request context.",
        ],
      }),
    ]);
    expect(evidence.context.firstRequestBaseline?.tokenUsageId).toBe(
      evidence.tokenUsage[0]?.id,
    );
    expect(evidence.context.contribution).toMatchObject({
      status: "unavailable",
      method: "no_stable_passive_per_item_context_contract",
    });
    expect(evidence.costEstimates).toEqual([
      expect.objectContaining({
        status: "estimated",
        amount: 0.057,
        currency: "USD",
        effectiveDate: "2026-07-01",
        priceTableVersion: "fixture-prices-v1",
        modelMapping: {
          observedModel: "fixture-model",
          pricedModel: "fixture-priced-model",
        },
        inputs: {
          uncachedInputTokens: 15000,
          cachedInputTokens: 10000,
          outputTokens: 2000,
          reasoningOutputTokens: 500,
        },
        billingCaveat:
          "API-equivalent estimate only; it is not a provider bill or ChatGPT plan-credit balance.",
      }),
    ]);
  });

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
