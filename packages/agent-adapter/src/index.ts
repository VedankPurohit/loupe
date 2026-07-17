import { createHash } from "node:crypto";

import type {
  ApiRequestEvidence,
  CapabilityEvidence,
  CostEstimate,
  EvidenceSchema,
  RichSessionEvidence,
  SourceEvent,
  TokenUsageSample,
  ToolEvidence,
  TurnAssociation,
} from "@workspace/contracts";

export type CodexSource =
  | "codex_hook"
  | "codex_otel_log"
  | "codex_otel_trace"
  | "codex_rollout";

export interface CodexSourceObservation {
  source: CodexSource;
  producer: { name: "codex"; version: string };
  producerEvent: string;
  occurredAt: string;
  capturedAt: string;
  capturePath: string;
  payload: Record<string, unknown>;
}

export interface CaptureCapability {
  availability:
    | "exact_when_emitted"
    | "inferred"
    | "conditional"
    | "partial"
    | "unavailable";
  stability: "documented" | "observed" | "unstable" | "unavailable";
  note: string;
}

export interface CodexCaptureCapabilities {
  sessions: CaptureCapability;
  turns: CaptureCapability;
  agentRuns: CaptureCapability;
  parentage: CaptureCapability;
  toolLifecycle: CaptureCapability;
  logicalModelRequest: CaptureCapability;
  implicitSkillActivation: CaptureCapability;
  completeCapabilitySnapshot: CaptureCapability;
  providerCost: CaptureCapability;
}

export interface CanonicalObservation {
  kind: "session_observed" | "turn_observed";
  sessionId: string;
  turnId?: string;
  occurredAt: string;
  provenance: {
    source: CodexSource;
    producerVersion: string;
    parser: { name: "codex-agent-adapter"; version: "1.0.0" };
    evidence: {
      stability: Array<"documented" | "observed" | "unstable">;
      derivation: "exact" | "inferred";
      sourcePaths: string[];
    };
  };
}

export interface AdaptedCodexObservation {
  status: "adapted" | "preserved" | "downgraded" | "rejected";
  reason?:
    | "unsupported_producer_version"
    | "unsupported_version_gated_source"
    | "unmapped_event";
  raw: CodexSourceObservation;
  canonical: CanonicalObservation[];
  capabilities: CodexCaptureCapabilities;
  parser: { name: "codex-agent-adapter"; version: "1.0.0" };
}

export interface CodexEvidenceInput {
  sourceEventId: string;
  observation: CodexSourceObservation;
}

export interface VersionedPriceTable {
  version: string;
  currency: string;
  effectiveDate: string;
  modelMappings: Record<string, string>;
  pricesPerMillionTokens: Record<
    string,
    {
      input: number;
      cachedInput: number;
      output: number;
      reasoningOutput: number;
    }
  >;
  billingCaveat: string;
}

export interface AnalyzeCodexEvidenceOptions {
  turns?: Array<{
    id: string;
    firstObservedAt: string;
    lastObservedAt: string;
  }>;
  priceTable?: VersionedPriceTable;
}

const parser = {
  name: "codex-agent-adapter",
  version: "1.0.0",
} as const;

const unavailable = (note: string): CaptureCapability => ({
  availability: "unavailable",
  stability: "unavailable",
  note,
});

type Evidence = RichSessionEvidence["context"]["contribution"]["evidence"];

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function textField(value: Record<string, unknown> | undefined, key: string) {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function otelAttributeMap(value: unknown): Record<string, unknown> {
  const source = record(value);
  const attributes = source?.attributes;
  if (!Array.isArray(attributes)) return {};
  return Object.fromEntries(
    attributes.flatMap((item) => {
      const attribute = record(item);
      const key = textField(attribute, "key");
      const wrapped = record(attribute?.value);
      if (!key || !wrapped) return [];
      const scalar =
        wrapped.stringValue ??
        wrapped.string_value ??
        wrapped.intValue ??
        wrapped.int_value ??
        wrapped.doubleValue ??
        wrapped.double_value ??
        wrapped.boolValue ??
        wrapped.bool_value;
      return scalar === undefined ? [] : [[key, scalar]];
    }),
  );
}

function logAttributes(payload: unknown): Record<string, unknown> {
  const source = record(payload);
  return otelAttributeMap(source?.log_record ?? source?.logRecord ?? source);
}

interface TraceSpan {
  name: string;
  spanId: string;
  parentSpanId: string | null;
  attributes: Record<string, unknown>;
}

function traceSpans(payload: unknown): TraceSpan[] {
  const source = record(payload);
  const candidates = Array.isArray(source?.records)
    ? source.records
    : source?.span
      ? [source]
      : [];
  return candidates.flatMap((candidate) => {
    const wrapper = record(candidate);
    const span = record(wrapper?.span ?? wrapper);
    const name = textField(span, "name");
    const spanId = textField(span, "spanId") ?? textField(span, "span_id");
    if (!name || !spanId) return [];
    return [
      {
        name,
        spanId,
        parentSpanId:
          textField(span, "parentSpanId") ?? textField(span, "parent_span_id") ?? null,
        attributes: otelAttributeMap(span),
      },
    ];
  });
}

function evidence(
  sourceEventIds: string[],
  stability: Evidence["stability"],
  derivation: Evidence["derivation"],
): Evidence {
  return { stability, derivation, sourceEventIds: [...new Set(sourceEventIds)] };
}

function inferredTurnAssociation(
  occurredAt: string,
  turns: AnalyzeCodexEvidenceOptions["turns"] = [],
): TurnAssociation {
  const at = new Date(occurredAt).getTime();
  const candidates = turns.filter(
    (turn) =>
      new Date(turn.firstObservedAt).getTime() <= at &&
      at <= new Date(turn.lastObservedAt).getTime(),
  );
  return candidates.length === 1
    ? {
        turnId: candidates[0]!.id,
        strength: "inferred",
        method: "log_time_within_canonical_turn",
      }
    : {
        turnId: null,
        strength: "unavailable",
        method: "no_unique_temporal_turn_candidate",
      };
}

function associationForTurn(
  turnId: string | undefined,
  method: string,
  unstable = false,
): TurnAssociation {
  return turnId
    ? {
        turnId,
        strength: unstable ? "exact_unstable" : "exact",
        method,
      }
    : { turnId: null, strength: "unavailable", method: "turn_id_not_emitted" };
}

function tokenCategories(attributes: Record<string, unknown>, trace = false) {
  const value = (logKey: string, traceKey: string) =>
    numberField(attributes[trace ? traceKey : logKey]);
  return {
    input: value("input_token_count", "gen_ai.usage.input_tokens"),
    cachedInput: value(
      "cached_token_count",
      "gen_ai.usage.cache_read.input_tokens",
    ),
    output: value("output_token_count", "gen_ai.usage.output_tokens"),
    reasoningOutput: value(
      "reasoning_token_count",
      "codex.usage.reasoning_output_tokens",
    ),
    total: value("tool_token_count", "codex.usage.total_tokens"),
  };
}

function estimateCost(
  sample: TokenUsageSample,
  priceTable: VersionedPriceTable | undefined,
): CostEstimate {
  const observedModel = sample.model;
  const pricedModel = observedModel
    ? priceTable?.modelMappings[observedModel] ?? null
    : null;
  const prices = pricedModel
    ? priceTable?.pricesPerMillionTokens[pricedModel]
    : undefined;
  const input = sample.categories.input;
  const cached = sample.categories.cachedInput;
  const output = sample.categories.output;
  const reasoning = sample.categories.reasoningOutput;
  const uncached = input === null ? null : Math.max(0, input - (cached ?? 0));
  const billingCaveat =
    priceTable?.billingCaveat ??
    "No price mapping is configured; provider monetary cost and ChatGPT plan credits are unavailable.";
  if (
    !priceTable ||
    !pricedModel ||
    !prices ||
    uncached === null ||
    cached === null ||
    output === null ||
    reasoning === null
  ) {
    return {
      tokenUsageId: sample.id,
      status: "unavailable",
      amount: null,
      currency: priceTable?.currency ?? null,
      effectiveDate: priceTable?.effectiveDate ?? null,
      priceTableVersion: priceTable?.version ?? null,
      modelMapping: { observedModel, pricedModel },
      inputs: {
        uncachedInputTokens: uncached,
        cachedInputTokens: cached,
        outputTokens: output,
        reasoningOutputTokens: reasoning,
      },
      billingCaveat,
      reason: !priceTable
        ? "No versioned price table is configured."
        : !pricedModel || !prices
          ? "The observed model has no explicit price-table mapping."
          : "One or more required Token categories were not reported.",
    };
  }
  const amount =
    (uncached * prices.input +
      cached * prices.cachedInput +
      output * prices.output +
      reasoning * prices.reasoningOutput) /
    1_000_000;
  return {
    tokenUsageId: sample.id,
    status: "estimated",
    amount: Number(amount.toFixed(9)),
    currency: priceTable.currency,
    effectiveDate: priceTable.effectiveDate,
    priceTableVersion: priceTable.version,
    modelMapping: { observedModel, pricedModel },
    inputs: {
      uncachedInputTokens: uncached,
      cachedInputTokens: cached,
      outputTokens: output,
      reasoningOutputTokens: reasoning,
    },
    billingCaveat,
    reason: null,
  };
}

export const codex01445Capabilities: CodexCaptureCapabilities = {
  sessions: {
    availability: "exact_when_emitted",
    stability: "documented",
    note: "Hook session_id is the exact tree-wide Session identity.",
  },
  turns: {
    availability: "exact_when_emitted",
    stability: "documented",
    note: "Hook turn_id is canonical when present.",
  },
  agentRuns: {
    availability: "exact_when_emitted",
    stability: "observed",
    note: "Per-thread OTel identity and hook child agent_id remain distinct.",
  },
  parentage: {
    availability: "conditional",
    stability: "unstable",
    note: "0.144.5 agent-communication/rollout edges are version-gated.",
  },
  toolLifecycle: {
    availability: "partial",
    stability: "documented",
    note: "Exact when a hook emits; missing hooks do not prove no tool activity.",
  },
  logicalModelRequest: unavailable(
    "Passive sources expose transport attempts, not stable logical request identity.",
  ),
  implicitSkillActivation: unavailable(
    "No passive supported event reports implicit skill activation.",
  ),
  completeCapabilitySnapshot: unavailable(
    "Configured/used capabilities are not a complete callable snapshot.",
  ),
  providerCost: unavailable("No provider-billed currency amount is emitted."),
};

function unsupportedCapabilities(): CodexCaptureCapabilities {
  return Object.fromEntries(
    Object.keys(codex01445Capabilities).map((key) => [
      key,
      unavailable("Producer version has not been validated."),
    ]),
  ) as unknown as CodexCaptureCapabilities;
}

function exactHookProjection(
  raw: CodexSourceObservation,
): CanonicalObservation[] {
  const sessionId = raw.payload.session_id;
  if (typeof sessionId !== "string") return [];
  const turnId = raw.payload.turn_id;
  const sourcePaths = ["$.payload.session_id"];
  if (typeof turnId === "string") sourcePaths.push("$.payload.turn_id");
  return [
    {
      kind: typeof turnId === "string" ? "turn_observed" : "session_observed",
      sessionId,
      ...(typeof turnId === "string" ? { turnId } : {}),
      occurredAt: raw.occurredAt,
      provenance: {
        source: raw.source,
        producerVersion: raw.producer.version,
        parser,
        evidence: {
          stability: ["documented", "observed"],
          derivation: "exact",
          sourcePaths,
        },
      },
    },
  ];
}

/**
 * Pure public adapter seam. It never mutates or normalizes the source payload;
 * retained evidence can therefore be passed through a later parser version.
 */
export function adaptCodexObservation(
  raw: CodexSourceObservation,
): AdaptedCodexObservation {
  if (raw.producer.version !== "0.144.5") {
    return {
      status: raw.source === "codex_rollout" ? "rejected" : "downgraded",
      reason:
        raw.source === "codex_rollout"
          ? "unsupported_version_gated_source"
          : "unsupported_producer_version",
      raw,
      canonical: [],
      capabilities: unsupportedCapabilities(),
      parser,
    };
  }

  const canonical = raw.source === "codex_hook" ? exactHookProjection(raw) : [];
  return {
    status: canonical.length > 0 ? "adapted" : "preserved",
    ...(canonical.length === 0 ? { reason: "unmapped_event" as const } : {}),
    raw,
    canonical,
    capabilities: codex01445Capabilities,
    parser,
  };
}

/**
 * Projects rich evidence from source observations already associated with one
 * Session. Missing signals stay unavailable; this function never treats an
 * absent hook as proof that activity did not occur.
 */
export function analyzeCodexEvidence(
  inputs: CodexEvidenceInput[],
  options: AnalyzeCodexEvidenceOptions = {},
): RichSessionEvidence {
  type MutableTool = Omit<ToolEvidence, "evidence" | "coverageGaps"> & {
    sourceEventIds: string[];
    stability: Evidence["stability"];
    coverageGaps: Set<string>;
  };
  const tools = new Map<string, MutableTool>();
  const lifecycle: RichSessionEvidence["lifecycle"] = [];
  const apiRequests: ApiRequestEvidence[] = [];
  const tokenUsage: TokenUsageSample[] = [];
  const limits: RichSessionEvidence["context"]["limits"] = [];
  const capabilityEvents = new Map<
    CapabilityEvidence["capability"],
    CapabilityEvidence
  >();

  const setCapability = (value: CapabilityEvidence) => {
    const priority = { unavailable: 0, conditional: 1, inferred: 2, observed: 3 };
    const current = capabilityEvents.get(value.capability);
    if (!current || priority[value.state] >= priority[current.state]) {
      capabilityEvents.set(value.capability, value);
    }
  };

  const upsertTool = (
    key: string,
    initial: Omit<MutableTool, "sourceEventIds" | "stability" | "coverageGaps">,
    sourceEventId: string,
    stability: Evidence["stability"],
  ) => {
    let tool = tools.get(key);
    if (!tool) {
      tool = {
        ...initial,
        sourceEventIds: [],
        stability,
        coverageGaps: new Set(),
      };
      tools.set(key, tool);
    }
    if (!tool.sourceEventIds.includes(sourceEventId)) tool.sourceEventIds.push(sourceEventId);
    return tool;
  };

  for (const { sourceEventId, observation } of inputs) {
    const disposition = adaptCodexObservation(observation);
    if (
      disposition.status === "downgraded" ||
      disposition.status === "rejected"
    ) {
      continue;
    }
    const payload = record(observation.payload);
    if (observation.source === "codex_hook") {
      const eventName =
        textField(payload, "hook_event_name") ?? observation.producerEvent;
      const turnId = textField(payload, "turn_id");
      const hookEvidence = evidence(
        [sourceEventId],
        ["documented", "observed"],
        "exact",
      );
      if (eventName === "PreCompact" || eventName === "PostCompact") {
        lifecycle.push({
          id: `lifecycle:${sourceEventId}`,
          kind: "compaction",
          event: eventName,
          occurredAt: observation.occurredAt,
          details: { trigger: textField(payload, "trigger") ?? "unavailable" },
          turnAssociation: associationForTurn(turnId, "hook_turn_id"),
          evidence: hookEvidence,
        });
      }
      if (eventName === "SessionStart" && textField(payload, "source") === "resume") {
        lifecycle.push({
          id: `lifecycle:${sourceEventId}`,
          kind: "resume",
          event: "SessionStart",
          occurredAt: observation.occurredAt,
          details: { source: "resume" },
          turnAssociation: associationForTurn(undefined, "session_lifecycle_has_no_turn_id"),
          evidence: hookEvidence,
        });
      }
      if (
        eventName === "PreToolUse" ||
        eventName === "PostToolUse" ||
        eventName === "PermissionRequest"
      ) {
        const toolName = textField(payload, "tool_name") ?? "unknown_tool";
        const toolUseId = textField(payload, "tool_use_id");
        const key = toolUseId ? `tool:${toolUseId}` : `tool:${sourceEventId}`;
        const tool = upsertTool(
          key,
          {
            id: key,
            toolName,
            occurredAt: observation.occurredAt,
            identifiers: { hookToolUseId: toolUseId ?? null, otelCallId: null },
            input: null,
            result: null,
            durationMs: null,
            outcome: "unknown",
            approval: "unavailable",
            retryCount: null,
            turnAssociation: associationForTurn(turnId, "hook_turn_id"),
          },
          sourceEventId,
          ["documented", "observed"],
        );
        tool.toolName = toolName;
        tool.identifiers.hookToolUseId ??= toolUseId ?? null;
        if (eventName === "PreToolUse") tool.input = payload?.tool_input ?? null;
        if (eventName === "PostToolUse") {
          tool.input ??= payload?.tool_input ?? null;
          tool.result = payload?.tool_response ?? null;
        }
        if (eventName === "PermissionRequest") tool.approval = "requested";
        if (turnId) tool.turnAssociation = associationForTurn(turnId, "hook_turn_id");
        if (JSON.stringify(payload?.tool_input ?? "").includes("SKILL.md")) {
          lifecycle.push({
            id: `lifecycle:${sourceEventId}:skill-access`,
            kind: "skill",
            event: "skill_file_access",
            occurredAt: observation.occurredAt,
            details: { interpretation: "access_only_not_workflow_compliance" },
            turnAssociation: associationForTurn(turnId, "hook_turn_id"),
            evidence: evidence([sourceEventId], ["inferred"], "inferred"),
          });
          setCapability({
            capability: "explicit_skill_mention",
            state: "inferred",
            note: "A SKILL.md access is supporting evidence only, not proof the workflow was followed.",
            evidence: evidence([sourceEventId], ["inferred"], "inferred"),
          });
        }
      }
    }

    if (observation.source === "codex_otel_log") {
      const attributes = logAttributes(observation.payload);
      const eventName = String(attributes["event.name"] ?? observation.producerEvent);
      const threadId =
        typeof attributes["conversation.id"] === "string"
          ? attributes["conversation.id"]
          : undefined;
      const model =
        typeof attributes.model === "string" ? attributes.model : null;
      if (eventName === "codex.api_request") {
        const turnAssociation = inferredTurnAssociation(
          observation.occurredAt,
          options.turns,
        );
        const successValue = attributes.success;
        apiRequests.push({
          id: `api-request:${sourceEventId}`,
          occurredAt: observation.occurredAt,
          attempt: numberField(attributes.attempt),
          statusCode: numberField(attributes["http.response.status_code"]),
          durationMs: numberField(attributes.duration_ms),
          success:
            successValue === true || successValue === "true"
              ? true
              : successValue === false || successValue === "false"
                ? false
                : null,
          error:
            typeof attributes["error.message"] === "string"
              ? attributes["error.message"]
              : typeof attributes.error === "string"
                ? attributes.error
                : null,
          turnAssociation,
          evidence: evidence(
            [sourceEventId],
            [
              "observed",
              "unstable",
              ...(turnAssociation.strength === "inferred"
                ? (["inferred"] as const)
                : []),
            ],
            turnAssociation.strength === "inferred" ? "inferred" : "exact",
          ),
        });
      }
      if (eventName === "codex.conversation_starts") {
        const contextWindow = numberField(attributes.context_window);
        const autoCompactionLimit = numberField(attributes.auto_compact_token_limit);
        if (contextWindow !== null || autoCompactionLimit !== null) {
          limits.push({
            model,
            contextWindow,
            autoCompactionLimit,
            evidence: evidence(
              [sourceEventId],
              ["documented", "observed"],
              "exact",
            ),
          });
        }
        if (typeof attributes.mcp_servers === "string") {
          lifecycle.push({
            id: `lifecycle:${sourceEventId}:mcp-configured`,
            kind: "mcp",
            event: "configured_server_names",
            occurredAt: observation.occurredAt,
            details: {
              serverNames:
                attributes.mcp_servers.startsWith("<")
                  ? "redacted"
                  : attributes.mcp_servers,
              completeness: "server_names_only",
            },
            turnAssociation: associationForTurn(undefined, "conversation_start_has_no_turn_id"),
            evidence: evidence(
              [sourceEventId],
              ["documented", "observed"],
              "exact",
            ),
          });
          setCapability({
            capability: "configured_mcp_servers",
            state: "observed",
            note: "Configured server names were emitted; this is not a complete tool/schema inventory.",
            evidence: evidence(
              [sourceEventId],
              ["documented", "observed"],
              "exact",
            ),
          });
        }
      }
      if (
        eventName === "codex.sse_event" &&
        attributes["event.kind"] === "response.completed"
      ) {
        const categories = tokenCategories(attributes);
        if (Object.values(categories).some((value) => value !== null)) {
          tokenUsage.push({
            id: `tokens:${sourceEventId}`,
            occurredAt: observation.occurredAt,
            sourceKind: "provider_completion",
            model,
            serviceTier:
              typeof attributes.service_tier === "string"
                ? attributes.service_tier
                : null,
            categories,
            turnAssociation: inferredTurnAssociation(
              observation.occurredAt,
              options.turns,
            ),
            evidence: evidence(
              [sourceEventId],
              ["documented", "observed", "inferred"],
              "inferred",
            ),
          });
        }
      }
      if (eventName === "codex.tool_decision" || eventName === "codex.tool_result") {
        const toolName =
          typeof attributes.tool_name === "string" ? attributes.tool_name : "unknown_tool";
        const callId =
          typeof attributes.call_id === "string" ? attributes.call_id : undefined;
        const key = callId ? `tool:${callId}` : `tool:${sourceEventId}`;
        const tool = upsertTool(
          key,
          {
            id: key,
            toolName,
            occurredAt: observation.occurredAt,
            identifiers: { hookToolUseId: null, otelCallId: callId ?? null },
            input: null,
            result: null,
            durationMs: null,
            outcome: "unknown",
            approval: "unavailable",
            retryCount: null,
            turnAssociation: inferredTurnAssociation(
              observation.occurredAt,
              options.turns,
            ),
          },
          sourceEventId,
          ["documented", "observed"],
        );
        if (tool.toolName !== toolName) {
          tool.coverageGaps.add("tool_name_differs_across_sources");
        }
        tool.identifiers.otelCallId ??= callId ?? null;
        // Equality was observed for 0.144.5, but each identifier remains named
        // independently rather than becoming a cross-version invariant.
        if (callId && tool.identifiers.hookToolUseId === callId) {
          tool.identifiers = { hookToolUseId: callId, otelCallId: callId };
        }
        if (eventName === "codex.tool_decision") {
          const decision = String(attributes.decision ?? "").toLowerCase();
          tool.approval = decision === "approved" ? "approved" : decision === "denied" ? "denied" : tool.approval;
        } else {
          tool.input = attributes.arguments ?? tool.input;
          tool.result = attributes.output ?? tool.result;
          tool.durationMs = numberField(attributes.duration_ms);
          const success = attributes.success;
          tool.outcome =
            success === true || success === "true"
              ? "success"
              : success === false || success === "false"
                ? "failure"
                : "unknown";
          if (typeof attributes.mcp_server === "string" && attributes.mcp_server.length > 0) {
            lifecycle.push({
              id: `lifecycle:${sourceEventId}:mcp-use`,
              kind: "mcp",
              event: "tool_used",
              occurredAt: observation.occurredAt,
              details: {
                server: attributes.mcp_server,
                tool: toolName,
                callId: callId ?? null,
              },
              turnAssociation: tool.turnAssociation,
              evidence: evidence(
                [sourceEventId],
                ["documented", "observed"],
                "exact",
              ),
            });
            setCapability({
              capability: "observed_mcp_use",
              state: "observed",
              note: "An MCP tool call was observed; passive inventory completeness remains unavailable.",
              evidence: evidence(
                [sourceEventId],
                ["documented", "observed"],
                "exact",
              ),
            });
          }
        }
        if (threadId) tool.coverageGaps.delete("agent_thread_unavailable");
      }
    }

    if (observation.source === "codex_otel_trace") {
      const spans = traceSpans(observation.payload);
      const byId = new Map(spans.map((span) => [span.spanId, span]));
      const nearestTurn = (span: TraceSpan) => {
        let current: TraceSpan | undefined = span;
        const visited = new Set<string>();
        while (current && !visited.has(current.spanId)) {
          visited.add(current.spanId);
          if (current.name === "session_task.turn") return current;
          current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
        }
        return undefined;
      };
      for (const span of spans) {
        const turnSpan = nearestTurn(span);
        const turnId =
          typeof turnSpan?.attributes["turn.id"] === "string"
            ? turnSpan.attributes["turn.id"]
            : undefined;
        if (span.name === "handle_responses") {
          const categories = tokenCategories(span.attributes, true);
          if (Object.values(categories).some((value) => value !== null)) {
            tokenUsage.push({
              id: `tokens:${sourceEventId}:${span.spanId}`,
              occurredAt: observation.occurredAt,
              sourceKind: "provider_completion",
              model:
                typeof turnSpan?.attributes.model === "string"
                  ? turnSpan.attributes.model
                  : null,
              serviceTier: null,
              categories,
              turnAssociation: associationForTurn(
                turnId,
                "source_defined_trace_ancestor",
                true,
              ),
              evidence: evidence(
                [sourceEventId],
                ["observed", "unstable"],
                turnId ? "exact" : "unavailable",
              ),
            });
          }
        }
        if (span.name === "session_task.turn") {
          const categories = {
            input: numberField(span.attributes["codex.turn.token_usage.input_tokens"]),
            cachedInput: numberField(
              span.attributes["codex.turn.token_usage.cached_input_tokens"],
            ),
            output: numberField(span.attributes["codex.turn.token_usage.output_tokens"]),
            reasoningOutput: numberField(
              span.attributes["codex.turn.token_usage.reasoning_output_tokens"],
            ),
            total: numberField(span.attributes["codex.turn.token_usage.total_tokens"]),
          };
          if (Object.values(categories).some((value) => value !== null)) {
            tokenUsage.push({
              id: `tokens:${sourceEventId}:${span.spanId}:turn-total`,
              occurredAt: observation.occurredAt,
              sourceKind: "turn_total",
              model:
                typeof span.attributes.model === "string" ? span.attributes.model : null,
              serviceTier: null,
              categories,
              turnAssociation: associationForTurn(
                typeof span.attributes["turn.id"] === "string"
                  ? span.attributes["turn.id"]
                  : undefined,
                "source_defined_turn_span",
                true,
              ),
              evidence: evidence(
                [sourceEventId],
                ["observed", "unstable"],
                "exact",
              ),
            });
          }
        }
        if (
          span.name === "build_skill_injections" &&
          (numberField(span.attributes.mentioned_skill_count) ?? 0) > 0
        ) {
          const skillEvidence = evidence(
            [sourceEventId],
            ["observed", "unstable"],
            turnId ? "exact" : "inferred",
          );
          lifecycle.push({
            id: `lifecycle:${sourceEventId}:${span.spanId}:skill`,
            kind: "skill",
            event: "explicit_mention_injection",
            occurredAt: observation.occurredAt,
            details: {
              mentionedCount: numberField(span.attributes.mentioned_skill_count),
              interpretation: "mention_or_injection_not_workflow_compliance",
            },
            turnAssociation: associationForTurn(
              turnId,
              "source_defined_trace_ancestor",
              true,
            ),
            evidence: skillEvidence,
          });
          setCapability({
            capability: "explicit_skill_mention",
            state: "observed",
            note: "Source-defined trace evidence shows explicit mention/injection, not workflow compliance.",
            evidence: skillEvidence,
          });
        }
        if (span.name === "mcp.tools.call") {
          const mcpEvidence = evidence(
            [sourceEventId],
            ["observed", "unstable"],
            "exact",
          );
          lifecycle.push({
            id: `lifecycle:${sourceEventId}:${span.spanId}:mcp`,
            kind: "mcp",
            event: "tool_used",
            occurredAt: observation.occurredAt,
            details: {
              server: span.attributes["mcp.server.name"] ?? null,
              tool: span.attributes["tool.name"] ?? null,
              callId: span.attributes["tool.call_id"] ?? null,
            },
            turnAssociation: associationForTurn(
              typeof span.attributes["turn.id"] === "string"
                ? span.attributes["turn.id"]
                : turnId,
              "source_defined_mcp_span",
              true,
            ),
            evidence: mcpEvidence,
          });
          setCapability({
            capability: "observed_mcp_use",
            state: "observed",
            note: "A version-gated MCP call span was observed; this is not a complete passive inventory.",
            evidence: mcpEvidence,
          });
        }
      }
    }

    if (observation.source === "codex_rollout") {
      const forkedFromId = textField(payload, "forked_from_id");
      const parentThreadId = textField(payload, "parent_thread_id");
      const threadSource = textField(payload, "thread_source");
      if (forkedFromId && !parentThreadId && threadSource === "user") {
        const forkEvidence = evidence(
          [sourceEventId],
          ["observed", "unstable"],
          "exact",
        );
        lifecycle.push({
          id: `lifecycle:${sourceEventId}:fork`,
          kind: "fork",
          event: "user_fork_lineage",
          occurredAt: observation.occurredAt,
          details: { forkedFromId, source: "version_gated_rollout" },
          turnAssociation: associationForTurn(undefined, "fork_rollout_has_no_turn_id"),
          evidence: forkEvidence,
        });
        setCapability({
          capability: "fork",
          state: "observed",
          note: "A user fork lineage was observed in the version-gated rollout fallback.",
          evidence: forkEvidence,
        });
      }
    }
  }

  for (const tool of tools.values()) {
    if (tool.input === null) tool.coverageGaps.add("input_not_captured");
    if (tool.result === null) tool.coverageGaps.add("result_not_captured");
    if (tool.durationMs === null) tool.coverageGaps.add("duration_not_captured");
    if (tool.outcome === "unknown") tool.coverageGaps.add("stable_outcome_unavailable");
    if (tool.approval === "unavailable") tool.coverageGaps.add("approval_not_emitted");
    if (tool.retryCount === null) tool.coverageGaps.add("retry_count_unavailable");
  }

  const sortedUsage = [...tokenUsage].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
  );
  const occupancy = sortedUsage.flatMap((sample) => {
    if (sample.categories.input === null) return [];
    const limit =
      limits.find((candidate) => candidate.model === sample.model) ?? limits[0];
    const contextWindow = limit?.contextWindow ?? null;
    return [
      {
        tokenUsageId: sample.id,
        occupancyTokens: sample.categories.input,
        occupancyPercent:
          contextWindow === null
            ? null
            : Number(((sample.categories.input / contextWindow) * 100).toFixed(3)),
        method: "provider_input_tokens_over_reported_context_window" as const,
        inputs: { inputTokens: sample.categories.input, contextWindow },
        missingAssumptions: [
          "Provider input usage may not equal the exact serialized request context.",
          ...(contextWindow === null
            ? ["No Context-window limit was emitted for this model."]
            : []),
        ],
        evidence: evidence(
          [...sample.evidence.sourceEventIds, ...(limit?.evidence.sourceEventIds ?? [])],
          ["inferred"],
          "inferred",
        ),
      },
    ];
  });
  const firstRequestSample = sortedUsage.find(
    (sample) => sample.sourceKind === "provider_completion",
  );
  const firstRequestBaseline = firstRequestSample
    ? occupancy.find(
        (sample) => sample.tokenUsageId === firstRequestSample.id,
      ) ?? null
    : null;

  const unavailableEvidence = evidence([], ["unavailable"], "unavailable");
  setCapability({
    capability: "explicit_skill_mention",
    state: "unavailable",
    note: "No supported explicit mention or defensible access evidence was captured.",
    evidence: unavailableEvidence,
  });
  setCapability({
    capability: "implicit_skill_activation",
    state: "unavailable",
    note: "Codex exposes no documented passive implicit-skill activation event.",
    evidence: unavailableEvidence,
  });
  setCapability({
    capability: "configured_mcp_servers",
    state: "unavailable",
    note: "Configured MCP server names were not captured for this Session.",
    evidence: unavailableEvidence,
  });
  setCapability({
    capability: "observed_mcp_use",
    state: "unavailable",
    note: "No MCP use evidence was captured; this does not prove no MCP activity occurred.",
    evidence: unavailableEvidence,
  });
  setCapability({
    capability: "complete_passive_capability_snapshot",
    state: "unavailable",
    note: "Ordinary passive capture cannot prove a complete tool, skill, plugin, and MCP inventory.",
    evidence: unavailableEvidence,
  });
  setCapability({
    capability: "fork",
    state: "conditional",
    note: "Fork is available only from a version-gated user-rollout lineage; startup alone is not fork evidence.",
    evidence: unavailableEvidence,
  });

  return {
    tools: [...tools.values()]
      .map(({ sourceEventIds, stability, coverageGaps, ...tool }) => ({
        ...tool,
        evidence: evidence(
          sourceEventIds,
          stability,
          tool.turnAssociation.strength === "inferred" ? "inferred" : "exact",
        ),
        coverageGaps: [...coverageGaps].sort(),
      }))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    lifecycle: lifecycle.sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    ),
    apiRequests: apiRequests.sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
    ),
    tokenUsage: sortedUsage,
    context: {
      limits,
      occupancy,
      firstRequestBaseline,
      contribution: {
        status: "unavailable",
        method: "no_stable_passive_per_item_context_contract",
        note: "Exact serialized Context and per-item contribution are not exposed; no composition chart is populated.",
        evidence: unavailableEvidence,
      },
    },
    costEstimates: sortedUsage.map((sample) =>
      estimateCost(sample, options.priceTable),
    ),
    capabilities: [...capabilityEvents.values()].sort((left, right) =>
      left.capability.localeCompare(right.capability),
    ),
  };
}

/** Creates the immutable transport envelope after local redaction. */
export function createCodexSourceEvent(options: {
  id: string;
  adapted: AdaptedCodexObservation;
  redaction: SourceEvent["redaction"];
}): SourceEvent {
  const { raw } = options.adapted;
  const payloadHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(raw.payload))
    .digest("hex")}`;
  const deduplicationKey = `sha256:${createHash("sha256")
    .update(
      [
        raw.source,
        raw.producer.version,
        raw.producerEvent,
        raw.occurredAt,
        raw.capturePath,
        payloadHash,
      ].join("\n"),
    )
    .digest("hex")}`;
  return {
    schemaVersion: "1",
    id: options.id,
    deduplicationKey,
    payloadHash,
    source: raw.source,
    producer: { ...raw.producer, event: raw.producerEvent },
    parser: options.adapted.parser,
    occurredAt: raw.occurredAt,
    capturedAt: raw.capturedAt,
    capturePath: raw.capturePath,
    rawPayload: raw.payload,
    canonicalObservations: options.adapted.canonical,
    adapter: {
      status: options.adapted.status,
      ...(options.adapted.reason ? { reason: options.adapted.reason } : {}),
      capabilities: { ...options.adapted.capabilities },
    },
    redaction: options.redaction,
  };
}
