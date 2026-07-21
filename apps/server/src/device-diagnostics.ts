import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { z } from "zod";

import {
  ApiErrorSchema,
  browserSessionCookieName,
  browserSessionOpenApiSecurity,
  deviceCredentialOpenApiSecurity,
} from "@workspace/contracts";
import { enrolledDevices, sourceEvents } from "@workspace/database";

import type { IdentityStore } from "./identity-store.js";

const DiagnosticObservationStateSchema = z.enum([
  "observed",
  "not_observed",
]);

export const DeviceDiagnosticsParamsSchema = z.object({ id: z.uuid() });
export const DeviceDiagnosticsResponseSchema = z.object({
  deviceId: z.uuid(),
  installationHealth: z.array(
    z.object({
      kind: z.literal("installation_health"),
      verificationId: z.string().min(1),
      sourceEventId: z.uuid(),
      verificationTime: z.iso.datetime(),
      serverEndpoint: z.object({
        state: DiagnosticObservationStateSchema,
        value: z.string().url().nullable(),
      }),
      hookTrust: z.object({
        state: DiagnosticObservationStateSchema,
        value: z.enum(["trusted", "managed", "untrusted", "modified"]).nullable(),
      }),
      relay: z.object({
        state: DiagnosticObservationStateSchema,
        value: z.enum(["running", "stopped"]).nullable(),
      }),
      queue: z.object({
        state: DiagnosticObservationStateSchema,
        pending: z.number().int().nonnegative().nullable(),
        poisoned: z.number().int().nonnegative().nullable(),
      }),
      deliveryAcknowledgement: z.object({
        state: z.literal("acknowledged"),
        acknowledgedAt: z.iso.datetime(),
      }),
      missingPrerequisites: z.array(
        z.object({
          code: z.enum([
            "SERVER_ENDPOINT_NOT_OBSERVED",
            "HOOK_TRUST_NOT_OBSERVED",
            "RELAY_STATE_NOT_OBSERVED",
            "QUEUE_STATE_NOT_OBSERVED",
          ]),
          name: z.string().min(1),
          action: z.string().min(1),
        }),
      ),
      problems: z.array(
        z.object({
          code: z.enum([
            "HOOK_TRUST_UNSAFE",
            "RELAY_NOT_RUNNING",
            "QUEUE_NOT_DRAINED",
          ]),
          name: z.string().min(1),
          action: z.string().min(1),
        }),
      ),
      links: z.object({
        self: z.string().min(1),
        sourceEvent: z.string().min(1),
      }),
      nextAction: z.object({
        kind: z.enum([
          "rerun_setup_verification",
          "repair_hook_trust",
          "restart_relay",
          "drain_delivery_queue",
        ]),
        label: z.string().min(1),
      }),
    }),
  ),
});

export type DeviceDiagnosticsResponse = z.infer<
  typeof DeviceDiagnosticsResponseSchema
>;

const missingPrerequisiteActions = {
  SERVER_ENDPOINT_NOT_OBSERVED:
    "Rerun setup verification with a current installer to record the server endpoint.",
  HOOK_TRUST_NOT_OBSERVED:
    "Verify the installed hooks are trusted, then rerun setup verification.",
  RELAY_STATE_NOT_OBSERVED:
    "Start or restart the relay, then rerun setup verification.",
  QUEUE_STATE_NOT_OBSERVED:
    "Inspect the relay queue and retry delivery before rerunning setup verification.",
} as const;

const observedProblemActions = {
  HOOK_TRUST_UNSAFE:
    "Review the installed hooks and restore a trusted or managed definition before retrying.",
  RELAY_NOT_RUNNING:
    "Start or restart the relay before retrying Device diagnostics.",
  QUEUE_NOT_DRAINED:
    "Inspect pending and poisoned delivery records, repair delivery, and retry.",
} as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function serverEndpointValue(value: unknown): string | undefined {
  const endpoint = stringValue(value);
  if (!endpoint) return undefined;
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? endpoint
      : undefined;
  } catch {
    return undefined;
  }
}

function missingPrerequisites(input: {
  serverEndpoint?: string;
  hookTrust?: string;
  relayState?: string;
  pending?: number;
  poisoned?: number;
}): DeviceDiagnosticsResponse["installationHealth"][number]["missingPrerequisites"] {
  const missing: DeviceDiagnosticsResponse["installationHealth"][number]["missingPrerequisites"] = [];
  if (!input.serverEndpoint) {
    missing.push({
      code: "SERVER_ENDPOINT_NOT_OBSERVED",
      name: "Server endpoint",
      action: missingPrerequisiteActions.SERVER_ENDPOINT_NOT_OBSERVED,
    });
  }
  if (!input.hookTrust) {
    missing.push({
      code: "HOOK_TRUST_NOT_OBSERVED",
      name: "Hook trust",
      action: missingPrerequisiteActions.HOOK_TRUST_NOT_OBSERVED,
    });
  }
  if (!input.relayState) {
    missing.push({
      code: "RELAY_STATE_NOT_OBSERVED",
      name: "Relay state",
      action: missingPrerequisiteActions.RELAY_STATE_NOT_OBSERVED,
    });
  }
  if (input.pending === undefined || input.poisoned === undefined) {
    missing.push({
      code: "QUEUE_STATE_NOT_OBSERVED",
      name: "Delivery queue state",
      action: missingPrerequisiteActions.QUEUE_STATE_NOT_OBSERVED,
    });
  }
  return missing;
}

function observedProblems(input: {
  hookTrust?: "trusted" | "managed" | "untrusted" | "modified";
  relayState?: "running" | "stopped";
  pending?: number;
  poisoned?: number;
}): DeviceDiagnosticsResponse["installationHealth"][number]["problems"] {
  const problems: DeviceDiagnosticsResponse["installationHealth"][number]["problems"] = [];
  if (input.hookTrust === "untrusted" || input.hookTrust === "modified") {
    problems.push({
      code: "HOOK_TRUST_UNSAFE",
      name: "Hook trust requires repair",
      action: observedProblemActions.HOOK_TRUST_UNSAFE,
    });
  }
  if (input.relayState === "stopped") {
    problems.push({
      code: "RELAY_NOT_RUNNING",
      name: "Relay is stopped",
      action: observedProblemActions.RELAY_NOT_RUNNING,
    });
  }
  if ((input.pending ?? 0) > 0 || (input.poisoned ?? 0) > 0) {
    problems.push({
      code: "QUEUE_NOT_DRAINED",
      name: "Delivery queue requires attention",
      action: observedProblemActions.QUEUE_NOT_DRAINED,
    });
  }
  return problems;
}

function nextAction(
  missing: DeviceDiagnosticsResponse["installationHealth"][number]["missingPrerequisites"],
  problems: DeviceDiagnosticsResponse["installationHealth"][number]["problems"],
): DeviceDiagnosticsResponse["installationHealth"][number]["nextAction"] {
  if (problems.some((problem) => problem.code === "HOOK_TRUST_UNSAFE")) {
    return { kind: "repair_hook_trust", label: "Repair hook trust, then retry" };
  }
  if (problems.some((problem) => problem.code === "RELAY_NOT_RUNNING")) {
    return { kind: "restart_relay", label: "Restart the relay, then retry" };
  }
  if (problems.some((problem) => problem.code === "QUEUE_NOT_DRAINED")) {
    return { kind: "drain_delivery_queue", label: "Repair delivery, then retry" };
  }
  return {
    kind: "rerun_setup_verification",
    label:
      missing.length > 0
        ? "Rerun setup verification after repair"
        : "Rerun setup verification",
  };
}

export class DeviceDiagnosticsStore {
  private readonly client;
  private readonly database;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.database = drizzle(this.client);
  }

  async close() {
    await this.client.end();
  }

  async get(
    organizationId: string,
    memberId: string,
    deviceId: string,
    selfPath = `/api/v1/devices/${encodeURIComponent(deviceId)}/diagnostics`,
  ): Promise<DeviceDiagnosticsResponse | undefined> {
    const [device] = await this.database
      .select({ id: enrolledDevices.id })
      .from(enrolledDevices)
      .where(
        and(
          eq(enrolledDevices.id, deviceId),
          eq(enrolledDevices.organizationId, organizationId),
          eq(enrolledDevices.memberId, memberId),
        ),
      )
      .limit(1);
    if (!device) return undefined;

    const rows = await this.database
      .select({
        id: sourceEvents.id,
        occurredAt: sourceEvents.occurredAt,
        receivedAt: sourceEvents.receivedAt,
        rawPayload: sourceEvents.rawPayload,
      })
      .from(sourceEvents)
      .where(
        and(
          eq(sourceEvents.organizationId, organizationId),
          eq(sourceEvents.deliveringDeviceId, deviceId),
          eq(sourceEvents.source, "codex_hook"),
          eq(sourceEvents.producerEvent, "Stop"),
          sql`${sourceEvents.rawPayload} ->> 'hook_event_name' = 'Stop'`,
          sql`${sourceEvents.rawPayload} ->> 'source' = 'setup_verification_complete'`,
          sql`(
            ${sourceEvents.rawPayload} ->> 'canonical_kind' = 'installation_health'
            or ${sourceEvents.rawPayload} ->> 'session_id' like 'setup-verification-%'
          )`,
          sql`coalesce(${sourceEvents.rawPayload} ->> 'turn_id', '') = ''`,
          sql`coalesce(${sourceEvents.rawPayload} ->> 'agent_id', '') = ''`,
        ),
      )
      .orderBy(desc(sourceEvents.occurredAt), desc(sourceEvents.id));

    return {
      deviceId,
      installationHealth: rows.flatMap((row) => {
        const payload = record(row.rawPayload);
        const verificationId = stringValue(payload?.session_id);
        if (!verificationId) return [];
        const diagnostics = record(payload?.diagnostics);
        const serverEndpoint = serverEndpointValue(diagnostics?.server_endpoint);
        const observedHookTrust = stringValue(diagnostics?.hook_trust);
        const hookTrust =
          observedHookTrust === "trusted" ||
          observedHookTrust === "managed" ||
          observedHookTrust === "untrusted" ||
          observedHookTrust === "modified"
            ? observedHookTrust
            : undefined;
        const observedRelayState = stringValue(diagnostics?.relay_state);
        const relayState =
          observedRelayState === "running" || observedRelayState === "stopped"
            ? observedRelayState
            : undefined;
        const queue = record(diagnostics?.queue);
        const pending = nonnegativeInteger(queue?.pending);
        const poisoned = nonnegativeInteger(queue?.poisoned);
        const prerequisites = missingPrerequisites({
          serverEndpoint,
          hookTrust,
          relayState,
          pending,
          poisoned,
        });
        const problems = observedProblems({
          hookTrust,
          relayState,
          pending,
          poisoned,
        });
        return [
          {
            kind: "installation_health" as const,
            verificationId,
            sourceEventId: row.id,
            verificationTime: row.occurredAt.toISOString(),
            serverEndpoint: {
              state: serverEndpoint ? ("observed" as const) : ("not_observed" as const),
              value: serverEndpoint ?? null,
            },
            hookTrust: {
              state: hookTrust ? ("observed" as const) : ("not_observed" as const),
              value: hookTrust ?? null,
            },
            relay: {
              state: relayState ? ("observed" as const) : ("not_observed" as const),
              value: relayState ?? null,
            },
            queue: {
              state:
                pending !== undefined && poisoned !== undefined
                  ? ("observed" as const)
                  : ("not_observed" as const),
              pending: pending ?? null,
              poisoned: poisoned ?? null,
            },
            deliveryAcknowledgement: {
              state: "acknowledged" as const,
              acknowledgedAt: row.receivedAt.toISOString(),
            },
            missingPrerequisites: prerequisites,
            problems,
            links: {
              self: selfPath,
              sourceEvent: `/api/v1/source-events/${encodeURIComponent(row.id)}`,
            },
            nextAction: nextAction(prerequisites, problems),
          },
        ];
      }),
    };
  }
}

export function registerDeviceDiagnosticsRoutes(
  app: FastifyInstance,
  dependencies: {
    identityStore: IdentityStore | undefined;
    diagnosticsStore: DeviceDiagnosticsStore | undefined;
  },
) {
  app.get(
    "/api/v1/devices/:id/diagnostics",
    {
      schema: {
        operationId: "getDeviceDiagnostics",
        security: browserSessionOpenApiSecurity,
        params: DeviceDiagnosticsParamsSchema,
        response: {
          200: DeviceDiagnosticsResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!dependencies.identityStore || !dependencies.diagnosticsStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Device diagnostics are unavailable. Check PostgreSQL and retry.",
          },
        });
      }
      const params = DeviceDiagnosticsParamsSchema.parse(request.params);
      const token = request.cookies[browserSessionCookieName];
      const session = token
        ? await dependencies.identityStore.getSession(token)
        : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "Sign in again, then retry Device diagnostics.",
          },
        });
      }
      const diagnostics = await dependencies.diagnosticsStore.get(
        session.organization.id,
        session.member.id,
        params.id,
      );
      if (!diagnostics) {
        return reply.status(404).send({
          error: {
            code: "DEVICE_DIAGNOSTICS_NOT_FOUND",
            message: "This Device was not found. Re-enroll it before retrying setup verification.",
          },
        });
      }
      return diagnostics;
    },
  );

  app.get(
    "/api/v1/device/diagnostics",
    {
      schema: {
        operationId: "getOwnDeviceDiagnostics",
        security: deviceCredentialOpenApiSecurity,
        response: {
          200: DeviceDiagnosticsResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!dependencies.identityStore || !dependencies.diagnosticsStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Device diagnostics are unavailable. Check PostgreSQL and retry.",
          },
        });
      }
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      const device = token
        ? await dependencies.identityStore.authenticateDevice(token)
        : undefined;
      const organizationId = device
        ? await dependencies.identityStore.deviceOrganizationId(device.id)
        : undefined;
      if (!device || !organizationId) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "Reconnect this Device, then retry its diagnostics.",
          },
        });
      }
      return dependencies.diagnosticsStore.get(
        organizationId,
        device.memberId,
        device.id,
        "/api/v1/device/diagnostics",
      );
    },
  );
}
