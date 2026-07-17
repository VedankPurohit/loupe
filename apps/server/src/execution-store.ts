import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  analyzeCodexEvidence,
  type CodexEvidenceInput,
  type CodexSource,
  type VersionedPriceTable,
} from "@workspace/agent-adapter";
import type {
  ActivityEpisode,
  AgentRun,
  ComparisonRequest,
  ComparisonResponse,
  ComparisonSelection,
  ExecutionSession,
  ExecutionSessionDetail,
  ExamplePackImportResponse,
  GitContextObservation,
  OrganizationActivityQuery,
  OrganizationActivityResponse,
  Reconciliation,
  SessionAnnotationRequest,
  Turn,
} from "@workspace/contracts";
import {
  activityEpisodes,
  enrolledDevices,
  examplePackImports,
  executionAgentRuns,
  executionSessions,
  executionTimelineEvents,
  executionTurns,
  organizationMembers,
  sessionAnnotations,
  sourceEvents,
} from "@workspace/database";

type ReconciliationInput = Reconciliation["inputs"][number];

interface ParentObservation extends ReconciliationInput {}

interface AgentState {
  publicId: string;
  kind: "root" | "subagent";
  codexThreadId: string | null;
  agentType: string | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
  identitySourceEventIds: Set<string>;
  parentObservations: ParentObservation[];
}

interface TurnState {
  id: string;
  agentRunId: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  sourceEventIds: Set<string>;
}

interface ActivityState {
  id: string;
  source: ActivityEpisode["source"];
  state: ActivityEpisode["state"];
  startedAt: Date;
  endedAt: Date | null;
  sourceEventId: string;
}

interface TimelineState {
  sourceEventId: string;
  event: string;
  occurredAt: Date;
  turnId: string | null;
  agentRunId: string | null;
}

interface SessionState {
  databaseId: string;
  canonicalId: string;
  ownerMemberId: string;
  ownerDeviceId: string;
  gitContext: GitContextObservation | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
  activityState: ExecutionSession["activityState"];
  rootAgentRunId: string;
  ownershipInputs: ReconciliationInput[];
  activities: ActivityState[];
  turns: Map<string, TurnState>;
  agents: Map<string, AgentState>;
  timeline: TimelineState[];
}

interface SourceRow {
  id: string;
  memberId: string;
  deliveringDeviceId: string;
  source: string;
  producerEvent: string;
  producerVersion: string;
  occurredAt: Date;
  capturedAt: Date;
  receivedAt: Date;
  capturePath: string;
  rawPayload: unknown;
  gitContext: unknown;
}

function stableUuid(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function touchAgent(agent: AgentState, at: Date, sourceEventId: string) {
  if (at < agent.firstObservedAt) agent.firstObservedAt = at;
  if (at > agent.lastObservedAt) agent.lastObservedAt = at;
  agent.identitySourceEventIds.add(sourceEventId);
}

function ensureRoot(session: SessionState, at: Date, sourceEventId: string) {
  let root = session.agents.get(session.rootAgentRunId);
  if (!root) {
    root = {
      publicId: session.rootAgentRunId,
      kind: "root",
      codexThreadId: null,
      agentType: null,
      firstObservedAt: at,
      lastObservedAt: at,
      identitySourceEventIds: new Set([sourceEventId]),
      parentObservations: [],
    };
    session.agents.set(root.publicId, root);
  } else {
    touchAgent(root, at, sourceEventId);
  }
  return root;
}

function ensureSubagent(
  session: SessionState,
  threadId: string,
  agentType: string | undefined,
  at: Date,
  sourceEventId: string,
) {
  let agent = session.agents.get(threadId);
  if (!agent) {
    agent = {
      publicId: threadId,
      kind: "subagent",
      codexThreadId: threadId,
      agentType: agentType ?? null,
      firstObservedAt: at,
      lastObservedAt: at,
      identitySourceEventIds: new Set([sourceEventId]),
      parentObservations: [],
    };
    session.agents.set(threadId, agent);
  } else {
    touchAgent(agent, at, sourceEventId);
    agent.agentType ??= agentType ?? null;
    agent.codexThreadId ??= threadId;
  }
  return agent;
}

function addParentObservation(agent: AgentState, input: ParentObservation) {
  if (
    !agent.parentObservations.some(
      (existing) =>
        existing.sourceEventId === input.sourceEventId &&
        existing.observedValue === input.observedValue &&
        existing.derivation === input.derivation,
    )
  ) {
    agent.parentObservations.push(input);
  }
}

function reconcileParent(agent: AgentState): {
  status: "exact" | "inferred" | "unresolved";
  parentAgentRunId: string | null;
  reconciliation: Reconciliation;
} {
  const exact = [
    ...new Set(
      agent.parentObservations
        .filter((input) => input.derivation === "exact" && input.observedValue)
        .map((input) => input.observedValue!),
    ),
  ];
  if (exact.length === 1) {
    return {
      status: "exact",
      parentAgentRunId: exact[0]!,
      reconciliation: {
        inputs: agent.parentObservations,
        rule: "prefer_exact_parent_observation",
        selectedValue: exact[0]!,
        confidence: "high",
      },
    };
  }
  if (exact.length > 1) {
    return {
      status: "unresolved",
      parentAgentRunId: null,
      reconciliation: {
        inputs: agent.parentObservations,
        rule: "conflicting_exact_parent_observations",
        selectedValue: null,
        confidence: "none",
      },
    };
  }
  const inferred = [
    ...new Set(
      agent.parentObservations
        .filter((input) => input.derivation === "inferred" && input.observedValue)
        .map((input) => input.observedValue!),
    ),
  ];
  if (inferred.length === 1) {
    return {
      status: "inferred",
      parentAgentRunId: inferred[0]!,
      reconciliation: {
        inputs: agent.parentObservations,
        rule: "single_defensible_hook_parent_candidate",
        selectedValue: inferred[0]!,
        confidence: "medium",
      },
    };
  }
  return {
    status: "unresolved",
    parentAgentRunId: null,
    reconciliation: {
      inputs: agent.parentObservations,
      rule:
        inferred.length > 1
          ? "conflicting_inferred_parent_observations"
          : "parent_not_observed",
      selectedValue: null,
      confidence: inferred.length > 1 ? "none" : "low",
    },
  };
}

function reconciliationForOwnership(session: SessionState): Reconciliation {
  return {
    inputs: session.ownershipInputs,
    rule: "first_accepted_device_owns_session",
    selectedValue: session.ownerDeviceId,
    confidence: "high",
  };
}

type AnnotationRow = Pick<
  typeof sessionAnnotations.$inferSelect,
  "outcome" | "reviewStatus" | "tags" | "updatedAt"
> | null;

function toExecutionSession(
  row: typeof executionSessions.$inferSelect,
  owner: { displayName: string; isExample: boolean },
  annotation: AnnotationRow,
): ExecutionSession {
  return {
    id: row.canonicalSessionId,
    owner: { memberId: row.ownerMemberId, deviceId: row.ownerDeviceId },
    ownerProfile: { displayName: owner.displayName, isExample: owner.isExample },
    gitContext: (row.gitContext as GitContextObservation | null) ?? null,
    firstObservedAt: row.firstObservedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    activityState: row.activityState as ExecutionSession["activityState"],
    completion: { status: "not_assumed", evidence: "unavailable" },
    rootAgentRunId: row.rootAgentRunId,
    projectionVersion: "1",
    ownershipReconciliation:
      row.ownershipReconciliation as ExecutionSession["ownershipReconciliation"],
    annotations: {
      outcome: (annotation?.outcome ?? "unknown") as ExecutionSession["annotations"]["outcome"],
      reviewStatus: (annotation?.reviewStatus ?? "ordinary") as ExecutionSession["annotations"]["reviewStatus"],
      tags: (annotation?.tags as string[] | undefined) ?? [],
      updatedAt: annotation?.updatedAt.toISOString() ?? null,
    },
    synthetic: {
      kind: row.isSeeded ? "seeded" : "real",
      examplePackVersion: row.examplePackVersion,
    },
    deepLink: `/?session=${encodeURIComponent(row.canonicalSessionId)}${row.isSeeded ? "&includeSeeded=true" : ""}`,
  };
}

function otelAttributes(payload: unknown): Record<string, string> | undefined {
  const record = asRecord(payload);
  const logRecord = asRecord(record?.log_record ?? record?.logRecord ?? record);
  const attributes = logRecord?.attributes;
  if (!Array.isArray(attributes)) return undefined;
  const result: Record<string, string> = {};
  for (const item of attributes) {
    const attribute = asRecord(item);
    const key = stringField(attribute, "key");
    const value = asRecord(attribute?.value);
    const scalar = value?.stringValue ?? value?.string_value ?? value?.intValue;
    if (key && (typeof scalar === "string" || typeof scalar === "number")) {
      result[key] = String(scalar);
    }
  }
  return result;
}

function sourceIdentityValues(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) sourceIdentityValues(item, found);
    return found;
  }
  const current = asRecord(value);
  if (!current) return found;
  for (const key of [
    "session_id",
    "turn_id",
    "agent_id",
  ]) {
    const identity = stringField(current, key);
    if (identity) found.add(identity);
  }
  const attributeKey = stringField(current, "key");
  if (
    attributeKey &&
    ["session.id", "conversation.id", "turn.id", "thread.id"].includes(
      attributeKey,
    )
  ) {
    const wrapped = asRecord(current.value);
    const scalar = wrapped?.stringValue ?? wrapped?.string_value;
    if (typeof scalar === "string") found.add(scalar);
  }
  for (const nested of Object.values(current)) sourceIdentityValues(nested, found);
  return found;
}

function buildProjection(rows: SourceRow[]): SessionState[] {
  const sessions = new Map<string, SessionState>();
  const ownership = new Map<
    string,
    { memberId: string; deviceId: string; sourceEventId: string }
  >();
  for (const row of [...rows].sort((left, right) =>
    left.receivedAt.getTime() - right.receivedAt.getTime(),
  )) {
    const payload = asRecord(row.rawPayload);
    const sessionId = stringField(payload, "session_id");
    if (sessionId && !ownership.has(sessionId)) {
      ownership.set(sessionId, {
        memberId: row.memberId,
        deviceId: row.deliveringDeviceId,
        sourceEventId: row.id,
      });
    }
  }

  const chronological = [...rows].sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.receivedAt.getTime() - right.receivedAt.getTime(),
  );
  for (const row of chronological) {
    const payload = asRecord(row.rawPayload);
    const sessionId = stringField(payload, "session_id");
    if (row.source === "codex_hook" && sessionId) {
      const owner = ownership.get(sessionId)!;
      let session = sessions.get(sessionId);
      if (!session) {
        session = {
          databaseId: stableUuid("session", sessionId),
          canonicalId: sessionId,
          ownerMemberId: owner.memberId,
          ownerDeviceId: owner.deviceId,
          gitContext: (row.gitContext as GitContextObservation | null) ?? null,
          firstObservedAt: row.occurredAt,
          lastObservedAt: row.occurredAt,
          activityState: "live",
          rootAgentRunId: `root:${sessionId}`,
          ownershipInputs: [],
          activities: [],
          turns: new Map(),
          agents: new Map(),
          timeline: [],
        };
        sessions.set(sessionId, session);
      }
      const observedGitContext = row.gitContext as GitContextObservation | null;
      if (
        observedGitContext &&
        (!session.gitContext ||
          observedGitContext.sampledAt >= session.gitContext.sampledAt)
      ) {
        session.gitContext = observedGitContext;
      }
      if (row.occurredAt < session.firstObservedAt) session.firstObservedAt = row.occurredAt;
      if (row.occurredAt > session.lastObservedAt) session.lastObservedAt = row.occurredAt;
      if (
        !session.ownershipInputs.some(
          (input) => input.observedValue === row.deliveringDeviceId,
        )
      ) {
        session.ownershipInputs.push({
          sourceEventId: row.id,
          source: "delivery_device",
          observedValue: row.deliveringDeviceId,
          stability: "documented",
          derivation: "exact",
          confidence: "high",
        });
      }

      const eventName = stringField(payload, "hook_event_name") ?? row.producerEvent;
      const turnId = stringField(payload, "turn_id");
      const threadId = stringField(payload, "agent_id");
      const root = ensureRoot(session, row.occurredAt, row.id);
      const agent = threadId
        ? ensureSubagent(
            session,
            threadId,
            stringField(payload, "agent_type"),
            row.occurredAt,
            row.id,
          )
        : root;

      if (eventName === "SubagentStart" && threadId) {
        const otherSubagents = [...session.agents.values()].filter(
          (candidate) => candidate.kind === "subagent" && candidate.publicId !== threadId,
        );
        addParentObservation(agent, {
          sourceEventId: row.id,
          source: "hook:SubagentStart",
          observedValue: otherSubagents.length === 0 ? root.publicId : null,
          stability: "documented",
          derivation: "inferred",
          confidence: otherSubagents.length === 0 ? "medium" : "low",
        });
      }

      if (eventName === "SessionStart") {
        const source = stringField(payload, "source");
        const activitySource: ActivityEpisode["source"] =
          source === "startup" || source === "resume" || source === "clear" || source === "compact"
            ? source
            : "observed";
        session.activities.push({
          id: `activity:${row.id}`,
          source: activitySource,
          state: activitySource === "resume" ? "resumed" : "live",
          startedAt: row.occurredAt,
          endedAt: null,
          sourceEventId: row.id,
        });
        session.activityState = activitySource === "resume" ? "resumed" : "live";
      } else if (session.activities.length === 0) {
        session.activities.push({
          id: `activity:${row.id}`,
          source: "observed",
          state: "live",
          startedAt: row.occurredAt,
          endedAt: null,
          sourceEventId: row.id,
        });
      }
      if (eventName === "Stop" && !threadId) {
        const current = session.activities.at(-1);
        if (current && current.endedAt === null) {
          current.endedAt = row.occurredAt;
          current.state = "idle";
        }
        session.activityState = "idle";
      }

      if (turnId) {
        const current = session.turns.get(turnId);
        if (!current) {
          session.turns.set(turnId, {
            id: turnId,
            agentRunId: agent.publicId,
            firstObservedAt: row.occurredAt,
            lastObservedAt: row.occurredAt,
            sourceEventIds: new Set([row.id]),
          });
        } else {
          if (row.occurredAt < current.firstObservedAt) current.firstObservedAt = row.occurredAt;
          if (row.occurredAt > current.lastObservedAt) current.lastObservedAt = row.occurredAt;
          current.sourceEventIds.add(row.id);
          if (threadId) current.agentRunId = agent.publicId;
        }
      }
      session.timeline.push({
        sourceEventId: row.id,
        event: eventName,
        occurredAt: row.occurredAt,
        turnId: turnId ?? null,
        agentRunId: agent.publicId,
      });
      continue;
    }

    if (row.source === "codex_otel_log") {
      const attributes = otelAttributes(row.rawPayload);
      if (
        attributes?.["event.name"] !== "codex.agent_communication" ||
        attributes.kind !== "spawn" ||
        attributes.state !== "send" ||
        !attributes.sender_thread_id ||
        !attributes.receiver_thread_id
      ) {
        continue;
      }
      const senderThreadId = attributes.sender_thread_id;
      const receiverThreadId = attributes.receiver_thread_id;
      const session = [...sessions.values()].find((candidate) =>
        [...candidate.agents.values()].some(
          (agent) =>
            agent.codexThreadId === senderThreadId ||
            agent.codexThreadId === receiverThreadId ||
            agent.publicId === senderThreadId ||
            agent.publicId === receiverThreadId,
        ),
      );
      if (!session) continue;
      let parent = [...session.agents.values()].find(
        (agent) => agent.codexThreadId === senderThreadId || agent.publicId === senderThreadId,
      );
      const child = ensureSubagent(session, receiverThreadId, undefined, row.occurredAt, row.id);
      if (!parent) {
        const root = session.agents.get(session.rootAgentRunId)!;
        const currentChildEdge = reconcileParent(child);
        if (currentChildEdge.parentAgentRunId === root.publicId) {
          root.codexThreadId = senderThreadId;
          touchAgent(root, row.occurredAt, row.id);
          parent = root;
        } else {
          parent = ensureSubagent(session, senderThreadId, undefined, row.occurredAt, row.id);
        }
      }
      addParentObservation(child, {
        sourceEventId: row.id,
        source: "otel:codex.agent_communication",
        observedValue: parent.publicId,
        stability: "unstable",
        derivation: "exact",
        confidence: "high",
      });
      if (row.occurredAt > session.lastObservedAt) session.lastObservedAt = row.occurredAt;
    }
  }
  return [...sessions.values()];
}

function assessComparisonClaim(
  request: ComparisonRequest,
  distinctRealTurns: number,
  hasHumanOutcome: boolean,
): ComparisonResponse["claim"] {
  const common = {
    kind: request.claim.kind,
    statement: request.claim.statement,
    signals: request.claim.signals,
  };
  const metricCaveat =
    "Token use, estimated cost, duration, tool count, model choice, and correlation are descriptive signals only; they do not establish productivity, outcome, or causation.";
  if (request.claim.kind === "causal") {
    return {
      ...common,
      classification: "unsupported",
      status: "refused",
      refusal: {
        code: "INSUFFICIENT_CAUSAL_EVIDENCE",
        message:
          "Loupe cannot make this causal claim: the selected captured activity shows association, not evidence that one factor caused an outcome.",
      },
      caveats: [metricCaveat],
    };
  }
  if (request.claim.kind === "productivity") {
    return {
      ...common,
      classification: "unsupported",
      status: "refused",
      refusal: {
        code: "INSUFFICIENT_PRODUCTIVITY_EVIDENCE",
        message:
          "Loupe cannot make this productivity claim: the selected evidence contains no validated measure of developer productivity.",
      },
      caveats: [metricCaveat],
    };
  }
  if (request.claim.kind === "outcome") {
    if (!hasHumanOutcome) {
      return {
        ...common,
        classification: "unsupported",
        status: "refused",
        refusal: {
          code: "INSUFFICIENT_OUTCOME_EVIDENCE",
          message:
            "Loupe cannot make this outcome claim: none of the selected real Sessions has a human-assigned outcome.",
        },
        caveats: [metricCaveat],
      };
    }
    return {
      ...common,
      classification: "descriptive_comparison",
      status: "supported",
      refusal: null,
      caveats: [
        "Session outcome is a human annotation and does not establish productivity or causation.",
        metricCaveat,
      ],
    };
  }
  if (distinctRealTurns === 0) {
    return {
      ...common,
      classification: "unsupported",
      status: "refused",
      refusal: {
        code: "INSUFFICIENT_REAL_TURN_EVIDENCE",
        message:
          "Loupe cannot support this pattern claim without evidence from at least one real captured Turn; Seeded examples are illustrative only.",
      },
      caveats: [metricCaveat],
    };
  }
  return {
    ...common,
    classification:
      distinctRealTurns >= 2
        ? "repeated_pattern"
        : "single_case_hypothesis",
    status: "supported",
    refusal: null,
    caveats: [
      distinctRealTurns >= 2
        ? "A Repeated pattern describes evidence across distinct real Turns; it does not establish causation."
        : "A single real Turn is a hypothesis for further investigation, not a Repeated pattern.",
      metricCaveat,
    ],
  };
}

export class ExecutionStore {
  private readonly client;
  private readonly database;

  constructor(
    databaseUrl: string,
    private readonly priceTable?: VersionedPriceTable,
  ) {
    this.client = postgres(databaseUrl);
    this.database = drizzle(this.client);
  }

  async close() {
    await this.client.end();
  }

  async projectForDevice(deviceId: string): Promise<string[]> {
    const [device] = await this.database
      .select({ organizationId: enrolledDevices.organizationId })
      .from(enrolledDevices)
      .where(eq(enrolledDevices.id, deviceId))
      .limit(1);
    if (!device) return [];
    const rows = await this.database
      .select({
        id: sourceEvents.id,
        memberId: sourceEvents.memberId,
        deliveringDeviceId: sourceEvents.deliveringDeviceId,
        source: sourceEvents.source,
        producerEvent: sourceEvents.producerEvent,
        producerVersion: sourceEvents.producerVersion,
        occurredAt: sourceEvents.occurredAt,
        capturedAt: sourceEvents.capturedAt,
        receivedAt: sourceEvents.receivedAt,
        capturePath: sourceEvents.capturePath,
        rawPayload: sourceEvents.rawPayload,
        gitContext: sourceEvents.gitContext,
      })
      .from(sourceEvents)
      .where(eq(sourceEvents.organizationId, device.organizationId))
      .orderBy(asc(sourceEvents.receivedAt), asc(sourceEvents.id));
    const sessions = buildProjection(rows);

    await this.database.transaction(async (transaction) => {
      await transaction
        .delete(executionSessions)
        .where(
          and(
            eq(executionSessions.organizationId, device.organizationId),
            eq(executionSessions.isSeeded, false),
          ),
        );
      for (const session of sessions) {
        await transaction.insert(executionSessions).values({
          id: session.databaseId,
          organizationId: device.organizationId,
          canonicalSessionId: session.canonicalId,
          ownerMemberId: session.ownerMemberId,
          ownerDeviceId: session.ownerDeviceId,
          gitContext: session.gitContext,
          firstObservedAt: session.firstObservedAt,
          lastObservedAt: session.lastObservedAt,
          activityState: session.activityState,
          rootAgentRunId: session.rootAgentRunId,
          projectionVersion: "1",
          ownershipReconciliation: reconciliationForOwnership(session),
        });
        if (session.activities.length > 0) {
          await transaction.insert(activityEpisodes).values(
            session.activities.map((activity) => ({
              id: stableUuid("activity", activity.sourceEventId),
              sessionId: session.databaseId,
              publicId: activity.id,
              source: activity.source,
              state: activity.state,
              startedAt: activity.startedAt,
              endedAt: activity.endedAt,
              sourceEventId: activity.sourceEventId,
            })),
          );
        }
        if (session.turns.size > 0) {
          await transaction.insert(executionTurns).values(
            [...session.turns.values()].map((turn) => ({
              id: stableUuid("turn", session.canonicalId, turn.id),
              sessionId: session.databaseId,
              canonicalTurnId: turn.id,
              agentRunId: turn.agentRunId,
              firstObservedAt: turn.firstObservedAt,
              lastObservedAt: turn.lastObservedAt,
              evidence: {
                stability: ["documented", "observed"],
                derivation: "exact",
                sourceEventIds: [...turn.sourceEventIds],
              },
            })),
          );
        }
        await transaction.insert(executionAgentRuns).values(
          [...session.agents.values()].map((agent) => {
            const parent = agent.kind === "subagent" ? reconcileParent(agent) : null;
            return {
              id: stableUuid("agent", session.canonicalId, agent.publicId),
              sessionId: session.databaseId,
              publicId: agent.publicId,
              kind: agent.kind,
              codexThreadId: agent.codexThreadId,
              agentType: agent.agentType,
              firstObservedAt: agent.firstObservedAt,
              lastObservedAt: agent.lastObservedAt,
              identityEvidence: {
                stability:
                  agent.codexThreadId === null
                    ? ["unavailable"]
                    : agent.kind === "root"
                      ? ["observed", "unstable"]
                      : ["documented", "observed"],
                derivation: agent.codexThreadId === null ? "unavailable" : "exact",
                sourceEventIds: [...agent.identitySourceEventIds],
              },
              parentStatus: parent?.status ?? null,
              parentAgentRunId: parent?.parentAgentRunId ?? null,
              parentReconciliation: parent?.reconciliation ?? null,
            };
          }),
        );
        if (session.timeline.length > 0) {
          await transaction.insert(executionTimelineEvents).values(
            session.timeline.map((event) => ({
              id: stableUuid("timeline", event.sourceEventId),
              sessionId: session.databaseId,
              sourceEventId: event.sourceEventId,
              event: event.event,
              occurredAt: event.occurredAt,
              turnId: event.turnId,
              agentRunId: event.agentRunId,
              evidence: {
                stability: ["documented", "observed"],
                derivation: "exact",
                sourceEventIds: [event.sourceEventId],
              },
            })),
          );
        }
      }
    });
    return sessions.map((session) => session.canonicalId);
  }

  async listSessions(organizationId: string): Promise<ExecutionSession[]> {
    const rows = await this.database
      .select({
        session: executionSessions,
        ownerDisplayName: organizationMembers.displayName,
        ownerIsExample: organizationMembers.isExample,
        annotation: {
          outcome: sessionAnnotations.outcome,
          reviewStatus: sessionAnnotations.reviewStatus,
          tags: sessionAnnotations.tags,
          updatedAt: sessionAnnotations.updatedAt,
        },
      })
      .from(executionSessions)
      .innerJoin(
        organizationMembers,
        eq(executionSessions.ownerMemberId, organizationMembers.id),
      )
      .leftJoin(
        sessionAnnotations,
        and(
          eq(sessionAnnotations.organizationId, organizationId),
          eq(
            sessionAnnotations.canonicalSessionId,
            executionSessions.canonicalSessionId,
          ),
        ),
      )
      .where(
        and(
          eq(executionSessions.organizationId, organizationId),
          eq(executionSessions.isSeeded, false),
        ),
      )
      .orderBy(asc(executionSessions.firstObservedAt));
    return rows.map((row) =>
      toExecutionSession(
        row.session,
        { displayName: row.ownerDisplayName, isExample: row.ownerIsExample },
        row.annotation,
      ),
    );
  }

  async searchActivity(
    organizationId: string,
    query: OrganizationActivityQuery,
  ): Promise<OrganizationActivityResponse> {
    const conditions = [eq(executionSessions.organizationId, organizationId)];
    if (!query.includeSeeded) conditions.push(eq(executionSessions.isSeeded, false));
    if (query.memberId) conditions.push(eq(executionSessions.ownerMemberId, query.memberId));
    if (query.activityState) {
      conditions.push(eq(executionSessions.activityState, query.activityState));
    }
    if (query.from) conditions.push(gte(executionSessions.lastObservedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(executionSessions.firstObservedAt, new Date(query.to)));
    if (query.repository) {
      const repositoryPattern = `%${query.repository}%`;
      conditions.push(
        or(
          ilike(sql`${executionSessions.gitContext} ->> 'repositoryRoot'`, repositoryPattern),
          ilike(sql`${executionSessions.gitContext} ->> 'remoteIdentity'`, repositoryPattern),
          ilike(sql`${executionSessions.gitContext} ->> 'branch'`, repositoryPattern),
        )!,
      );
    }
    if (query.outcome) {
      conditions.push(
        query.outcome === "unknown"
          ? or(eq(sessionAnnotations.outcome, "unknown"), sql`${sessionAnnotations.outcome} is null` )!
          : eq(sessionAnnotations.outcome, query.outcome),
      );
    }
    if (query.reviewStatus) {
      conditions.push(
        query.reviewStatus === "ordinary"
          ? or(eq(sessionAnnotations.reviewStatus, "ordinary"), sql`${sessionAnnotations.reviewStatus} is null`)!
          : eq(sessionAnnotations.reviewStatus, query.reviewStatus),
      );
    }
    if (query.tag) {
      conditions.push(sql`${sessionAnnotations.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
    }
    const capturedEvidence = (value: string) => sql<boolean>`exists (
      select 1 from source_events evidence_event
      where evidence_event.organization_id = ${organizationId}
        and evidence_event.raw_payload ->> 'session_id' = ${executionSessions.canonicalSessionId}
        and evidence_event.raw_payload::text ilike ${`%${value}%`}
    )`;
    if (query.model) conditions.push(capturedEvidence(query.model));
    if (query.tool) conditions.push(capturedEvidence(query.tool));
    if (query.capability) conditions.push(capturedEvidence(query.capability));
    if (query.error) conditions.push(capturedEvidence(query.error));
    if (query.q) {
      conditions.push(sql<boolean>`to_tsvector('english', concat_ws(' ',
        ${executionSessions.canonicalSessionId},
        ${organizationMembers.displayName},
        ${executionSessions.searchText},
        coalesce(${executionSessions.gitContext} ->> 'repositoryRoot', ''),
        coalesce(${executionSessions.gitContext} ->> 'remoteIdentity', ''),
        coalesce(${sessionAnnotations.outcome}, 'unknown'),
        coalesce(${sessionAnnotations.reviewStatus}, 'ordinary'),
        coalesce(${sessionAnnotations.tags}::text, ''),
        coalesce((
          select string_agg(search_event.raw_payload::text, ' ')
          from source_events search_event
          where search_event.organization_id = ${organizationId}
            and search_event.raw_payload ->> 'session_id' = ${executionSessions.canonicalSessionId}
        ), '')
      )) @@ websearch_to_tsquery('english', ${query.q})`);
    }

    const rows = await this.database
      .select({
        session: executionSessions,
        ownerDisplayName: organizationMembers.displayName,
        ownerIsExample: organizationMembers.isExample,
        annotation: {
          outcome: sessionAnnotations.outcome,
          reviewStatus: sessionAnnotations.reviewStatus,
          tags: sessionAnnotations.tags,
          updatedAt: sessionAnnotations.updatedAt,
        },
      })
      .from(executionSessions)
      .innerJoin(
        organizationMembers,
        eq(executionSessions.ownerMemberId, organizationMembers.id),
      )
      .leftJoin(
        sessionAnnotations,
        and(
          eq(sessionAnnotations.organizationId, organizationId),
          eq(
            sessionAnnotations.canonicalSessionId,
            executionSessions.canonicalSessionId,
          ),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(executionSessions.lastObservedAt), asc(executionSessions.canonicalSessionId));

    const activityStates = { live: 0, idle: 0, resumed: 0 };
    const outcomes = { successful: 0, partial: 0, failed: 0, unknown: 0 };
    const memberCounts = new Map<string, { displayName: string; isExample: boolean; count: number }>();
    const repositoryCounts = new Map<string, number>();
    for (const row of rows) {
      activityStates[row.session.activityState as keyof typeof activityStates] += 1;
      const outcome = (row.annotation?.outcome ?? "unknown") as keyof typeof outcomes;
      outcomes[outcome] += 1;
      const member = memberCounts.get(row.session.ownerMemberId);
      memberCounts.set(row.session.ownerMemberId, {
        displayName: row.ownerDisplayName,
        isExample: row.ownerIsExample,
        count: (member?.count ?? 0) + 1,
      });
      const context = row.session.gitContext as GitContextObservation | null;
      const repository = context?.remoteIdentity ?? context?.repositoryRoot;
      if (repository) repositoryCounts.set(repository, (repositoryCounts.get(repository) ?? 0) + 1);
    }
    const start = (query.page - 1) * query.pageSize;
    const pageRows = rows.slice(start, start + query.pageSize);
    return {
      items: pageRows.map((row) => {
        const session = toExecutionSession(
          row.session,
          { displayName: row.ownerDisplayName, isExample: row.ownerIsExample },
          row.annotation,
        );
        const context = session.gitContext;
        return {
          ...session,
          owner: {
            ...session.owner,
            displayName: session.ownerProfile.displayName,
            isExample: session.ownerProfile.isExample,
          },
          repository: {
            repositoryRoot: context?.repositoryRoot ?? null,
            remoteIdentity: context?.remoteIdentity ?? null,
            branch: context?.branch ?? null,
          },
        };
      }),
      syntheticInclusion: query.includeSeeded ? "included" : "excluded",
      filters: query,
      page: {
        page: query.page,
        pageSize: query.pageSize,
        total: rows.length,
        hasMore: start + query.pageSize < rows.length,
        nextPage: start + query.pageSize < rows.length ? query.page + 1 : null,
      },
      aggregates: {
        sessions: rows.length,
        members: memberCounts.size,
        repositories: repositoryCounts.size,
        activityStates,
        outcomes,
      },
      members: [...memberCounts.entries()]
        .map(([id, member]) => ({
          id,
          displayName: member.displayName,
          isExample: member.isExample,
          sessionCount: member.count,
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      repositories: [...repositoryCounts.entries()]
        .map(([identity, sessionCount]) => ({ identity, sessionCount }))
        .sort((left, right) => left.identity.localeCompare(right.identity)),
    };
  }

  async compare(
    organizationId: string,
    request: ComparisonRequest,
  ): Promise<ComparisonResponse> {
    const details = new Map<string, ExecutionSessionDetail | undefined>();
    for (const selection of request.selections) {
      if (!details.has(selection.sessionId)) {
        details.set(
          selection.sessionId,
          await this.getSession(organizationId, selection.sessionId),
        );
      }
    }

    const missing: ComparisonResponse["completeness"]["missing"] = [];
    const subjects: ComparisonResponse["subjects"] = [];
    const citationsById = new Map<string, ComparisonResponse["citations"][number]>();
    const selectedTurnKeys = new Set<string>();
    const realTurnKeys = new Set<string>();
    const seededTurnKeys = new Set<string>();
    const evidenceGaps = new Set<string>();

    const addCitation = (
      detail: ExecutionSessionDetail,
      turn: Turn,
    ) => {
      const activity = detail.timeline.find((event) => event.turnId === turn.id);
      if (!activity) {
        evidenceGaps.add(
          `No captured timeline activity resolves the Turn ${turn.id} citation.`,
        );
        return;
      }
      const sessionId = detail.session.id;
      const encodedSessionId = encodeURIComponent(sessionId);
      const encodedTurnId = encodeURIComponent(turn.id);
      const encodedActivityId = encodeURIComponent(activity.sourceEventId);
      const id = `citation_${createHash("sha256")
        .update(`${organizationId}\n${sessionId}\n${turn.id}\n${activity.sourceEventId}`)
        .digest("hex")
        .slice(0, 24)}`;
      citationsById.set(id, {
        id,
        sessionId,
        turnId: turn.id,
        activityId: activity.sourceEventId,
        synthetic: detail.session.synthetic.kind,
        evidence: activity.evidence,
        links: {
          session: `/api/v1/sessions/${encodedSessionId}`,
          turn: `/api/v1/sessions/${encodedSessionId}/turns/${encodedTurnId}`,
          activity: `/api/v1/sessions/${encodedSessionId}/activity/${encodedActivityId}`,
          browser: `/?session=${encodedSessionId}&turn=${encodedTurnId}&activity=${encodedActivityId}${detail.session.synthetic.kind === "seeded" ? "&includeSeeded=true" : ""}`,
        },
      });
    };

    for (const selection of request.selections) {
      const detail = details.get(selection.sessionId);
      if (!detail) {
        missing.push({ selection, reason: "SESSION_NOT_FOUND" });
        continue;
      }
      if (detail.session.synthetic.kind === "seeded" && !request.includeSeeded) {
        missing.push({ selection, reason: "SEEDED_EXCLUDED" });
        continue;
      }
      const selectedTurns =
        selection.scope === "turn"
          ? detail.turns.filter((turn) => turn.id === selection.turnId)
          : detail.turns;
      if (selection.scope === "turn" && selectedTurns.length === 0) {
        missing.push({ selection, reason: "TURN_NOT_FOUND" });
        continue;
      }

      for (const turn of selectedTurns) {
        const key = `${detail.session.id}\n${turn.id}`;
        selectedTurnKeys.add(key);
        if (detail.session.synthetic.kind === "real") realTurnKeys.add(key);
        else seededTurnKeys.add(key);
        addCitation(detail, turn);
      }

      const start =
        selection.scope === "turn"
          ? selectedTurns[0]?.firstObservedAt
          : detail.session.firstObservedAt;
      const end =
        selection.scope === "turn"
          ? selectedTurns[0]?.lastObservedAt
          : detail.session.lastObservedAt;
      const turnIds = new Set(selectedTurns.map((turn) => turn.id));
      const tools = detail.evidence.tools.filter(
        (tool) =>
          selection.scope === "session" ||
          (tool.turnAssociation.turnId !== null && turnIds.has(tool.turnAssociation.turnId)),
      );
      const tokenUsage = detail.evidence.tokenUsage.filter(
        (sample) =>
          selection.scope === "session" ||
          (sample.turnAssociation.turnId !== null && turnIds.has(sample.turnAssociation.turnId)),
      );
      const tokenTotals = tokenUsage
        .map((sample) => sample.categories.total)
        .filter((total): total is number => total !== null);
      subjects.push({
        selection,
        synthetic: detail.session.synthetic.kind,
        ownerDisplayName: detail.session.ownerProfile.displayName,
        outcome: detail.session.annotations.outcome,
        reviewStatus: detail.session.annotations.reviewStatus,
        durationMs:
          start && end
            ? Math.max(0, new Date(end).getTime() - new Date(start).getTime())
            : null,
        toolCount: tools.length,
        tokenTotal: tokenTotals.length ? Math.max(...tokenTotals) : null,
        modelChoices: [
          ...new Set(
            tokenUsage
              .map((sample) => sample.model)
              .filter((model): model is string => model !== null),
          ),
        ].sort(),
        completeness: {
          tokenUsage: tokenUsage.length ? "available" : "unavailable",
          toolEvidence: tools.length ? "available" : "unavailable",
          humanOutcome:
            detail.session.annotations.outcome === "unknown"
              ? "unavailable"
              : "available",
        },
      });
    }

    const claim = assessComparisonClaim(
      request,
      realTurnKeys.size,
      subjects.some(
        (subject) =>
          subject.synthetic === "real" && subject.outcome !== "unknown",
      ),
    );
    const selectedSessions = new Set(
      request.selections.map((selection) => selection.sessionId),
    ).size;
    return {
      population: {
        selected: request.selections,
        selectedSessions,
        selectedTurns: selectedTurnKeys.size,
        distinctRealTurns: realTurnKeys.size,
        seededTurns: seededTurnKeys.size,
      },
      filters: request.filters,
      syntheticInclusion: request.includeSeeded
        ? "included_for_illustration"
        : "excluded",
      completeness: {
        status:
          subjects.length === 0
            ? "unavailable"
            : missing.length || evidenceGaps.size
              ? "partial"
              : "complete",
        selected: request.selections.length,
        resolved: subjects.length,
        missing,
        evidenceGaps: [...evidenceGaps],
      },
      subjects,
      citations: [...citationsById.values()],
      claim,
    };
  }

  async getCitationTurn(
    organizationId: string,
    canonicalSessionId: string,
    turnId: string,
  ): Promise<{ session: ExecutionSession; turn: Turn } | undefined> {
    const detail = await this.getSession(organizationId, canonicalSessionId);
    const turn = detail?.turns.find((candidate) => candidate.id === turnId);
    return detail && turn ? { session: detail.session, turn } : undefined;
  }

  async getCitationActivity(
    organizationId: string,
    canonicalSessionId: string,
    activityId: string,
  ):
    Promise<
      | {
          sessionId: string;
          turnId: string | null;
          activity: ExecutionSessionDetail["timeline"][number];
        }
      | undefined
    > {
    const detail = await this.getSession(organizationId, canonicalSessionId);
    const activity = detail?.timeline.find(
      (candidate) => candidate.sourceEventId === activityId,
    );
    return detail && activity
      ? { sessionId: detail.session.id, turnId: activity.turnId, activity }
      : undefined;
  }

  async annotateSession(
    organizationId: string,
    canonicalSessionId: string,
    actor: { id: string; role: "member" | "administrator" },
    input: SessionAnnotationRequest,
  ): Promise<ExecutionSession["annotations"] | "forbidden" | undefined> {
    const [session] = await this.database
      .select({ ownerMemberId: executionSessions.ownerMemberId })
      .from(executionSessions)
      .where(
        and(
          eq(executionSessions.organizationId, organizationId),
          eq(executionSessions.canonicalSessionId, canonicalSessionId),
        ),
      )
      .limit(1);
    if (!session) return undefined;
    if (actor.role !== "administrator" && session.ownerMemberId !== actor.id) {
      return "forbidden";
    }
    const [existing] = await this.database
      .select()
      .from(sessionAnnotations)
      .where(
        and(
          eq(sessionAnnotations.organizationId, organizationId),
          eq(sessionAnnotations.canonicalSessionId, canonicalSessionId),
        ),
      )
      .limit(1);
    const tags = input.tags
      ? [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]
      : ((existing?.tags as string[] | undefined) ?? []);
    const [annotation] = await this.database
      .insert(sessionAnnotations)
      .values({
        organizationId,
        canonicalSessionId,
        outcome: input.outcome ?? existing?.outcome ?? "unknown",
        reviewStatus: input.reviewStatus ?? existing?.reviewStatus ?? "ordinary",
        tags,
        updatedByMemberId: actor.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sessionAnnotations.organizationId, sessionAnnotations.canonicalSessionId],
        set: {
          outcome: input.outcome ?? existing?.outcome ?? "unknown",
          reviewStatus: input.reviewStatus ?? existing?.reviewStatus ?? "ordinary",
          tags,
          updatedByMemberId: actor.id,
          updatedAt: new Date(),
        },
      })
      .returning();
    return {
      outcome: annotation!.outcome as ExecutionSession["annotations"]["outcome"],
      reviewStatus: annotation!.reviewStatus as ExecutionSession["annotations"]["reviewStatus"],
      tags: annotation!.tags as string[],
      updatedAt: annotation!.updatedAt.toISOString(),
    };
  }

  async importExamplePack(
    organizationId: string,
    importedByMemberId: string,
    version: "starter-v1",
  ): Promise<ExamplePackImportResponse> {
    return this.database.transaction(async (transaction) => {
      const [existingImport] = await transaction
        .select()
        .from(examplePackImports)
        .where(
          and(
            eq(examplePackImports.organizationId, organizationId),
            eq(examplePackImports.version, version),
          ),
        )
        .limit(1);
      const [existingMember] = await transaction
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.isExample, true),
            eq(organizationMembers.examplePackVersion, version),
          ),
        )
        .limit(1);
      let exampleMemberId = existingMember?.id;
      if (!exampleMemberId) {
        const [member] = await transaction
          .insert(organizationMembers)
          .values({
            organizationId,
            displayName: "Example Member · Starter pack",
            role: "member",
            isExample: true,
            examplePackVersion: version,
          })
          .returning({ id: organizationMembers.id });
        exampleMemberId = member!.id;
      }
      const sessionIds = ["seeded-starter-compilation"];
      const observedAt = new Date("2026-07-01T09:00:00.000Z");
      const sessionDatabaseId = stableUuid(
        "example-pack",
        organizationId,
        version,
        sessionIds[0]!,
      );
      if (!existingImport) {
        await transaction.insert(executionSessions).values({
          id: sessionDatabaseId,
          organizationId,
          canonicalSessionId: sessionIds[0]!,
          ownerMemberId: exampleMemberId,
          ownerDeviceId: null,
          gitContext: {
            status: "available",
            repositoryRoot: "/examples/searchable-repository",
            remoteIdentity: "https://example.com/acme/searchable-repository.git",
            branch: "example",
            detached: false,
            worktree: "/examples/searchable-repository",
            commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            sampledAt: observedAt.toISOString(),
            provenance: {
              source: "relay_local_git",
              evidence: "local_observation",
              stability: "observed",
              derivation: "exact",
              cwd: "/examples/searchable-repository",
            },
            reason: null,
          },
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          activityState: "idle",
          rootAgentRunId: `root:${sessionIds[0]}`,
          projectionVersion: "1",
          ownershipReconciliation: {
            inputs: [],
            rule: "example_pack_server_controlled",
            selectedValue: null,
            confidence: "high",
          },
          isSeeded: true,
          examplePackVersion: version,
          searchText: "compilation error shell example searchable repository",
        });
        await transaction.insert(examplePackImports).values({
          organizationId,
          version,
          importedByMemberId,
        });
      }
      await transaction
        .insert(executionTurns)
        .values({
          id: stableUuid(
            "example-pack-turn",
            organizationId,
            version,
            "seeded-turn-compilation",
          ),
          sessionId: sessionDatabaseId,
          canonicalTurnId: "seeded-turn-compilation",
          agentRunId: `root:${sessionIds[0]}`,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          evidence: {
            stability: ["unavailable"],
            derivation: "unavailable",
            sourceEventIds: [],
          },
        })
        .onConflictDoNothing();
      return {
        version,
        imported: !existingImport,
        exampleMemberId,
        sessionIds,
        syntheticDesignation: "seeded",
      };
    });
  }

  async getSession(
    organizationId: string,
    canonicalSessionId: string,
  ): Promise<ExecutionSessionDetail | undefined> {
    const [selected] = await this.database
      .select({
        session: executionSessions,
        ownerDisplayName: organizationMembers.displayName,
        ownerIsExample: organizationMembers.isExample,
        annotation: {
          outcome: sessionAnnotations.outcome,
          reviewStatus: sessionAnnotations.reviewStatus,
          tags: sessionAnnotations.tags,
          updatedAt: sessionAnnotations.updatedAt,
        },
      })
      .from(executionSessions)
      .innerJoin(
        organizationMembers,
        eq(executionSessions.ownerMemberId, organizationMembers.id),
      )
      .leftJoin(
        sessionAnnotations,
        and(
          eq(sessionAnnotations.organizationId, organizationId),
          eq(
            sessionAnnotations.canonicalSessionId,
            executionSessions.canonicalSessionId,
          ),
        ),
      )
      .where(
        and(
          eq(executionSessions.organizationId, organizationId),
          eq(executionSessions.canonicalSessionId, canonicalSessionId),
        ),
      )
      .limit(1);
    if (!selected) return undefined;
    const row = selected.session;
    const [activities, turns, agents, timeline, retainedEvidence] = await Promise.all([
      this.database
        .select()
        .from(activityEpisodes)
        .where(eq(activityEpisodes.sessionId, row.id))
        .orderBy(asc(activityEpisodes.startedAt)),
      this.database
        .select()
        .from(executionTurns)
        .where(eq(executionTurns.sessionId, row.id))
        .orderBy(asc(executionTurns.firstObservedAt)),
      this.database
        .select()
        .from(executionAgentRuns)
        .where(eq(executionAgentRuns.sessionId, row.id))
        .orderBy(asc(executionAgentRuns.firstObservedAt)),
      this.database
        .select()
        .from(executionTimelineEvents)
        .where(eq(executionTimelineEvents.sessionId, row.id))
        .orderBy(asc(executionTimelineEvents.occurredAt)),
      this.database
        .select({
          id: sourceEvents.id,
          source: sourceEvents.source,
          producerEvent: sourceEvents.producerEvent,
          producerVersion: sourceEvents.producerVersion,
          occurredAt: sourceEvents.occurredAt,
          capturedAt: sourceEvents.capturedAt,
          capturePath: sourceEvents.capturePath,
          rawPayload: sourceEvents.rawPayload,
        })
        .from(sourceEvents)
        .where(eq(sourceEvents.organizationId, organizationId))
        .orderBy(asc(sourceEvents.occurredAt)),
    ]);
    const sessionIdentity = new Set<string>([
      row.canonicalSessionId,
      ...turns.map((turn) => turn.canonicalTurnId),
      ...agents.flatMap((agent) => [agent.publicId, agent.codexThreadId].filter(Boolean) as string[]),
    ]);
    const evidenceInputs: CodexEvidenceInput[] = retainedEvidence.flatMap((source) => {
      const identities = sourceIdentityValues(source.rawPayload);
      if (![...identities].some((identity) => sessionIdentity.has(identity))) return [];
      return [
        {
          sourceEventId: source.id,
          observation: {
            source: source.source as CodexSource,
            producer: { name: "codex" as const, version: source.producerVersion },
            producerEvent: source.producerEvent,
            occurredAt: source.occurredAt.toISOString(),
            capturedAt: source.capturedAt.toISOString(),
            capturePath: source.capturePath,
            payload: source.rawPayload as Record<string, unknown>,
          },
        },
      ];
    });
    const richEvidence = analyzeCodexEvidence(evidenceInputs, {
      turns: turns.map((turn) => ({
        id: turn.canonicalTurnId,
        firstObservedAt: turn.firstObservedAt.toISOString(),
        lastObservedAt: turn.lastObservedAt.toISOString(),
      })),
      priceTable: this.priceTable,
    });
    return {
      session: toExecutionSession(
        row,
        { displayName: selected.ownerDisplayName, isExample: selected.ownerIsExample },
        selected.annotation,
      ),
      activities: activities.map((activity) => ({
        id: activity.publicId,
        source: activity.source as ActivityEpisode["source"],
        state: activity.state as ActivityEpisode["state"],
        startedAt: activity.startedAt.toISOString(),
        endedAt: activity.endedAt?.toISOString() ?? null,
        sourceEventId: activity.sourceEventId,
      })),
      turns: turns.map((turn) => ({
        id: turn.canonicalTurnId,
        agentRunId: turn.agentRunId,
        firstObservedAt: turn.firstObservedAt.toISOString(),
        lastObservedAt: turn.lastObservedAt.toISOString(),
        evidence: turn.evidence as Turn["evidence"],
      })),
      agentRuns: agents.map((agent) => ({
        id: agent.publicId,
        kind: agent.kind as AgentRun["kind"],
        codexThreadId: agent.codexThreadId,
        agentType: agent.agentType,
        firstObservedAt: agent.firstObservedAt.toISOString(),
        lastObservedAt: agent.lastObservedAt.toISOString(),
        identityEvidence: agent.identityEvidence as AgentRun["identityEvidence"],
        parentEdge:
          agent.kind === "subagent"
            ? {
                status: agent.parentStatus as NonNullable<AgentRun["parentEdge"]>["status"],
                parentAgentRunId: agent.parentAgentRunId,
                reconciliation:
                  agent.parentReconciliation as NonNullable<
                    AgentRun["parentEdge"]
                  >["reconciliation"],
              }
            : null,
      })),
      timeline: timeline.map((event) => ({
        sourceEventId: event.sourceEventId,
        event: event.event,
        occurredAt: event.occurredAt.toISOString(),
        turnId: event.turnId,
        agentRunId: event.agentRunId,
        evidence: event.evidence as ExecutionSessionDetail["timeline"][number]["evidence"],
      })),
      evidence: richEvidence,
    };
  }
}
