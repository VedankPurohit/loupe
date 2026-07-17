import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
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
  ExecutionSession,
  ExecutionSessionDetail,
  GitContextObservation,
  Reconciliation,
  Turn,
} from "@workspace/contracts";
import {
  activityEpisodes,
  enrolledDevices,
  executionAgentRuns,
  executionSessions,
  executionTimelineEvents,
  executionTurns,
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

function toExecutionSession(row: typeof executionSessions.$inferSelect): ExecutionSession {
  return {
    id: row.canonicalSessionId,
    owner: { memberId: row.ownerMemberId, deviceId: row.ownerDeviceId },
    gitContext: (row.gitContext as GitContextObservation | null) ?? null,
    firstObservedAt: row.firstObservedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    activityState: row.activityState as ExecutionSession["activityState"],
    completion: { status: "not_assumed", evidence: "unavailable" },
    rootAgentRunId: row.rootAgentRunId,
    projectionVersion: "1",
    ownershipReconciliation:
      row.ownershipReconciliation as ExecutionSession["ownershipReconciliation"],
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
        .where(eq(executionSessions.organizationId, device.organizationId));
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
      .select()
      .from(executionSessions)
      .where(eq(executionSessions.organizationId, organizationId))
      .orderBy(asc(executionSessions.firstObservedAt));
    return rows.map(toExecutionSession);
  }

  async getSession(
    organizationId: string,
    canonicalSessionId: string,
  ): Promise<ExecutionSessionDetail | undefined> {
    const [row] = await this.database
      .select()
      .from(executionSessions)
      .where(
        and(
          eq(executionSessions.organizationId, organizationId),
          eq(executionSessions.canonicalSessionId, canonicalSessionId),
        ),
      )
      .limit(1);
    if (!row) return undefined;
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
      session: toExecutionSession(row),
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
