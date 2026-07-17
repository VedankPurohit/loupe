import { createHash } from "node:crypto";

import type { SourceEvent } from "@workspace/contracts";

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

const parser = {
  name: "codex-agent-adapter",
  version: "1.0.0",
} as const;

const unavailable = (note: string): CaptureCapability => ({
  availability: "unavailable",
  stability: "unavailable",
  note,
});

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
