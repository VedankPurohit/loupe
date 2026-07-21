import { and, asc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type {
  SourceEvent,
  SourceEventBatchResult,
  StructuralCaptureLedgerQuery,
  StructuralCaptureLedgerResponse,
} from "@workspace/contracts";
import {
  activityEpisodes,
  executionAgentRuns,
  executionSessions,
  executionTimelineEvents,
  executionTurns,
  sourceEventIngestionAttempts,
} from "@workspace/database";

type AttemptFields = typeof sourceEventIngestionAttempts.$inferInsert;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string");
}

function firstNonEmptyString(...values: unknown[]) {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

const structuralLabelPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/+@-]{0,159}$/;
const hookEventNames = new Set([
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
]);
const adapterReasons = new Set([
  "unmapped_event",
  "unsupported_producer_version",
  "unsupported_version_gated_source",
]);

function safeStructuralLabel(...values: unknown[]) {
  const value = firstNonEmptyString(...values);
  return value && structuralLabelPattern.test(value) ? value : undefined;
}

function safeProducerVersion(value: unknown) {
  const version = safeStructuralLabel(value);
  return version && /^(?:unknown|\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.test(version)
    ? version
    : undefined;
}

function safeProducerEvent(source: unknown, value: unknown) {
  const event = safeStructuralLabel(value);
  if (!event) return undefined;
  if (source === "codex_hook") return hookEventNames.has(event) ? event : undefined;
  if (source === "codex_otel_log") {
    return /^(?:codex|otlp)\.[A-Za-z0-9_.-]+$/.test(event) ? event : undefined;
  }
  if (source === "codex_otel_trace") {
    return event === "turn" ||
      event === "mcp.tools.call" ||
      /^(?:codex|otlp)\.[A-Za-z0-9_.-]+$/.test(event)
      ? event
      : undefined;
  }
  return undefined;
}

function otlpAttribute(container: unknown, wanted: string): string | undefined {
  const attributes = asRecord(container)?.attributes;
  if (!Array.isArray(attributes)) return undefined;
  for (const item of attributes) {
    const attribute = asRecord(item);
    if (attribute?.key !== wanted) continue;
    const value = asRecord(attribute.value);
    const scalar = value?.stringValue ?? value?.intValue;
    if (typeof scalar === "string" || typeof scalar === "number") {
      return String(scalar);
    }
  }
  return undefined;
}

function structuralIdentity(candidate: unknown) {
  const record = asRecord(candidate);
  const rawPayload = asRecord(record?.rawPayload);
  const attributes = asRecord(rawPayload?.attributes);
  const logRecord = rawPayload?.log_record;
  const span = asRecord(rawPayload?.span);
  return {
    sessionId: safeStructuralLabel(
      rawPayload?.session_id,
      rawPayload?.thread_id,
      rawPayload?.["conversation.id"],
      attributes?.["conversation.id"],
      attributes?.["thread.id"],
      otlpAttribute(logRecord, "conversation.id"),
      otlpAttribute(logRecord, "thread.id"),
      otlpAttribute(span, "conversation.id"),
      otlpAttribute(span, "thread.id"),
    ),
    turnId: safeStructuralLabel(
      rawPayload?.turn_id,
      rawPayload?.["turn.id"],
      attributes?.["turn.id"],
      otlpAttribute(logRecord, "turn.id"),
      otlpAttribute(span, "turn.id"),
    ),
    traceId: safeStructuralLabel(
      rawPayload?.trace_id,
      rawPayload?.traceId,
      attributes?.trace_id,
      span?.traceId,
      span?.trace_id,
    ),
  };
}

export function structuralAttemptFields(options: {
  organizationId: string;
  deviceId: string;
  batchId: string;
  batchOrdinal: number;
  candidate: unknown;
  result: SourceEventBatchResult;
  acceptedSourceEventId?: string;
}): AttemptFields {
  const candidate = asRecord(options.candidate);
  const producer = asRecord(candidate?.producer);
  const adapter = asRecord(candidate?.adapter);
  const identity = structuralIdentity(options.candidate);
  const occurredAt = firstString(candidate?.occurredAt);
  return {
    organizationId: options.organizationId,
    deliveringDeviceId: options.deviceId,
    batchId: options.batchId,
    batchOrdinal: options.batchOrdinal,
    eventId: options.result.eventId,
    canonicalSessionId: identity.sessionId ?? null,
    source: safeStructuralLabel(candidate?.source) ?? null,
    producerVersion: safeProducerVersion(producer?.version) ?? null,
    producerEvent:
      safeProducerEvent(candidate?.source, producer?.event) ?? null,
    deduplicationKey:
      typeof candidate?.deduplicationKey === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(candidate.deduplicationKey)
        ? candidate.deduplicationKey
        : null,
    payloadHash:
      typeof candidate?.payloadHash === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(candidate.payloadHash)
        ? candidate.payloadHash
        : null,
    occurredAt: occurredAt && !Number.isNaN(Date.parse(occurredAt))
      ? new Date(occurredAt)
      : null,
    acceptanceDisposition: options.result.status,
    acceptanceCode: options.result.code ?? null,
    acceptedSourceEventId: options.acceptedSourceEventId ?? null,
    adapterDisposition: ["adapted", "preserved", "downgraded", "rejected"].includes(
      firstString(adapter?.status) ?? "",
    )
      ? (adapter!.status as string)
      : "unavailable",
    adapterReason:
      typeof adapter?.reason === "string" && adapterReasons.has(adapter.reason)
        ? adapter.reason
        : null,
    fieldPresence: {
      sessionIdentity: identity.sessionId !== undefined,
      turnIdentity: identity.turnId !== undefined,
      traceIdentity: identity.traceId !== undefined,
      gitContext: asRecord(candidate?.gitContext) !== undefined,
      canonicalObservations:
        Array.isArray(candidate?.canonicalObservations) &&
        candidate.canonicalObservations.length > 0,
    },
  };
}

function sourceIds(value: unknown): string[] {
  const evidence = asRecord(value);
  const ids = evidence?.sourceEventIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

export class StructuralCaptureLedgerStore {
  private readonly client;
  private readonly database;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.database = drizzle(this.client);
  }

  async close() {
    await this.client.end();
  }

  async list(
    organizationId: string,
    query: StructuralCaptureLedgerQuery,
  ): Promise<StructuralCaptureLedgerResponse> {
    // Cursors are opaque and tenant-bound.  A cursor copied from another
    // Organization is treated as a fresh page rather than allowing it to
    // influence this tenant's result set. Legacy unscoped cursors are also
    // rejected by falling back to the first page.
    let offset = 0;
    if (query.cursor) {
      try {
        const decoded = Buffer.from(query.cursor, "base64url").toString("utf8");
        const parsed = JSON.parse(decoded) as unknown;
        if (typeof parsed === "object" && parsed !== null) {
          const cursor = parsed as { organizationId?: unknown; offset?: unknown };
          if (
            cursor.organizationId === organizationId &&
            typeof cursor.offset === "number" &&
            Number.isSafeInteger(cursor.offset) &&
            cursor.offset >= 0
          ) {
            offset = cursor.offset;
          }
        }
      } catch {
        // Invalid or foreign cursors fail closed at the first page.
      }
    }
    const scopeCondition = query.sessionId
      ? eq(sourceEventIngestionAttempts.canonicalSessionId, query.sessionId)
      : and(
          gte(
            sourceEventIngestionAttempts.receivedAt,
            new Date(query.receivedFrom!),
          ),
          lte(
            sourceEventIngestionAttempts.receivedAt,
            new Date(query.receivedTo!),
          ),
        );
    const attemptsPage = await this.database
      .select()
      .from(sourceEventIngestionAttempts)
      .where(
        and(
          eq(sourceEventIngestionAttempts.organizationId, organizationId),
          scopeCondition,
        ),
      )
      .orderBy(
        asc(sourceEventIngestionAttempts.receivedAt),
        asc(sourceEventIngestionAttempts.id),
      )
      .limit(query.limit + 1)
      .offset(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
    const hasMore = attemptsPage.length > query.limit;
    const attempts = attemptsPage.slice(0, query.limit);

    const [sessions, turns, agentRuns, activityEpisodesRows, timeline] =
      await Promise.all([
      this.database
        .select({
          databaseId: executionSessions.id,
          publicId: executionSessions.canonicalSessionId,
          ownership: executionSessions.ownershipReconciliation,
        })
        .from(executionSessions)
        .where(eq(executionSessions.organizationId, organizationId)),
      this.database
        .select({
          sessionId: executionSessions.canonicalSessionId,
          publicId: executionTurns.canonicalTurnId,
          evidence: executionTurns.evidence,
        })
        .from(executionTurns)
        .innerJoin(executionSessions, eq(executionTurns.sessionId, executionSessions.id))
        .where(eq(executionSessions.organizationId, organizationId)),
      this.database
        .select({
          sessionId: executionSessions.canonicalSessionId,
          publicId: executionAgentRuns.publicId,
          evidence: executionAgentRuns.identityEvidence,
        })
        .from(executionAgentRuns)
        .innerJoin(
          executionSessions,
          eq(executionAgentRuns.sessionId, executionSessions.id),
        )
        .where(eq(executionSessions.organizationId, organizationId)),
      this.database
        .select({
          sessionId: executionSessions.canonicalSessionId,
          publicId: activityEpisodes.publicId,
          sourceEventId: activityEpisodes.sourceEventId,
        })
        .from(activityEpisodes)
        .innerJoin(executionSessions, eq(activityEpisodes.sessionId, executionSessions.id))
        .where(eq(executionSessions.organizationId, organizationId)),
      this.database
        .select({
          sessionId: executionSessions.canonicalSessionId,
          sourceEventId: executionTimelineEvents.sourceEventId,
        })
        .from(executionTimelineEvents)
        .innerJoin(
          executionSessions,
          eq(executionTimelineEvents.sessionId, executionSessions.id),
        )
        .where(eq(executionSessions.organizationId, organizationId)),
    ]);

    return {
      scope: query.sessionId
        ? { kind: "session", sessionId: query.sessionId }
        : {
            kind: "receipt_window",
            receivedFrom: query.receivedFrom!,
            receivedTo: query.receivedTo!,
          },
      observations: attempts.map((attempt) => {
        const sourceEventId = attempt.acceptedSourceEventId;
        const matchingTurns = sourceEventId
          ? turns.filter((turn) => sourceIds(turn.evidence).includes(sourceEventId))
          : [];
        const matchingAgentRuns = sourceEventId
          ? agentRuns.filter((agentRun) =>
              sourceIds(agentRun.evidence).includes(sourceEventId),
            )
          : [];
        const matchingActivityEpisodes = sourceEventId
          ? activityEpisodesRows.filter(
              (activityEpisode) =>
                activityEpisode.sourceEventId === sourceEventId,
            )
          : [];
        const matchingTimeline = sourceEventId
          ? timeline.filter((event) => event.sourceEventId === sourceEventId)
          : [];
        const matchingSessions = sourceEventId
          ? sessions.filter((session) => {
              const ownership = asRecord(session.ownership);
              const inputs = Array.isArray(ownership?.inputs) ? ownership.inputs : [];
              return (
                inputs.some(
                  (input) => asRecord(input)?.sourceEventId === sourceEventId,
                ) ||
                matchingTurns.some((turn) => turn.sessionId === session.publicId) ||
                matchingAgentRuns.some(
                  (agentRun) => agentRun.sessionId === session.publicId,
                ) ||
                matchingActivityEpisodes.some(
                  (activityEpisode) =>
                    activityEpisode.sessionId === session.publicId,
                ) ||
                matchingTimeline.some((event) => event.sessionId === session.publicId)
              );
            })
          : [];
        return {
          observationId: attempt.id,
          sourceEventId,
          sourceFamily: attempt.source,
          producerVersion: attempt.producerVersion,
          eventName: attempt.producerEvent,
          sourceIdentity: attempt.deduplicationKey,
          payloadHash: attempt.payloadHash,
          occurredAt: attempt.occurredAt?.toISOString() ?? null,
          receivedAt: attempt.receivedAt.toISOString(),
          acceptance: {
            disposition: attempt.acceptanceDisposition as
              | "accepted"
              | "duplicate"
              | "rejected",
            code: attempt.acceptanceCode,
          },
          adapter: {
            disposition: attempt.adapterDisposition as
              | "adapted"
              | "preserved"
              | "downgraded"
              | "rejected"
              | "unavailable",
            reason: attempt.adapterReason,
          },
          fieldPresence: attempt.fieldPresence as StructuralCaptureLedgerResponse["observations"][number]["fieldPresence"],
          projectionReferences: {
            sessions: matchingSessions.map((session) => session.publicId),
            turns: matchingTurns.map((turn) => turn.publicId),
            agentRuns: matchingAgentRuns.map((agentRun) => agentRun.publicId),
            activityEpisodes: matchingActivityEpisodes.map(
              (activityEpisode) => activityEpisode.publicId,
            ),
            timeline: matchingTimeline.map((event) => event.sourceEventId),
          },
        };
      }),
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({
              organizationId,
              offset: offset + query.limit,
            }),
            "utf8",
          ).toString("base64url")
        : null,
    };
  }
}
