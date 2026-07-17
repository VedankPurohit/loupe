import swagger from "@fastify/swagger";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import {
  AnalysisCredentialCreateRequestSchema,
  AnalysisCredentialCreateResponseSchema,
  AnalysisCredentialIdParamsSchema,
  AnalysisCredentialsResponseSchema,
  ApiErrorSchema,
  AuthenticatedSessionResponseSchema,
  BootstrapRedeemRequestSchema,
  BootstrapStatusResponseSchema,
  CaptureRecordAcceptedResponseSchema,
  CaptureRecordIdParamsSchema,
  CaptureRecordSchema,
  CandidateHistoryResponseSchema,
  CandidateSubmissionRequestSchema,
  CandidateSubmissionResponseSchema,
  CitationActivityTargetResponseSchema,
  CitationTurnTargetResponseSchema,
  ComparisonActivityParamsSchema,
  ComparisonRequestSchema,
  ComparisonResponseSchema,
  ComparisonTurnParamsSchema,
  DeviceCapturePolicyResponseSchema,
  DeviceEnrollmentGrantRequestSchema,
  DeviceEnrollmentGrantResponseSchema,
  DeviceEnrollmentRedeemRequestSchema,
  DeviceEnrollmentResponseSchema,
  DeviceIdParamsSchema,
  DeviceHealthResponseSchema,
  EnrolledDevicesResponseSchema,
  ExecutionSessionDetailResponseSchema,
  ExecutionSessionIdParamsSchema,
  ExecutionSessionsResponseSchema,
  ExamplePackImportResponseSchema,
  ExamplePackParamsSchema,
  HealthResponseSchema,
  InviteCodeRedeemRequestSchema,
  InviteCodeRequestSchema,
  InviteCodeResponseSchema,
  OrganizationActivityQuerySchema,
  OrganizationActivityResponseSchema,
  RetainedSourceEventSchema,
  SourceEventBatchRequestSchema,
  SourceEventBatchResponseSchema,
  SourceEventIdParamsSchema,
  SessionAnnotationRequestSchema,
  SessionAnnotationResponseSchema,
  UpdateDeviceCapturePolicyRequestSchema,
  analysisCredentialOpenApiSecurity,
  analysisCredentialOpenApiSecurityScheme,
  analysisCredentialSecuritySchemeName,
  browserSessionCookieName,
  browserSessionOpenApiSecurity,
  browserSessionOpenApiSecurityScheme,
  browserSessionSecuritySchemeName,
  browserOrAnalysisOpenApiSecurity,
  deviceCredentialOpenApiSecurity,
  deviceCredentialOpenApiSecurityScheme,
  deviceCredentialSecuritySchemeName,
} from "@workspace/contracts";
import type { VersionedPriceTable } from "@workspace/agent-adapter";

import { ExecutionStore } from "./execution-store.js";
import { CandidateError, CandidateStore } from "./candidate-store.js";
import { IdentityError, IdentityStore } from "./identity-store.js";

export interface BuildAppOptions {
  bootstrapCode?: string;
  databaseUrl?: string;
  onBootstrapCode?: (code: string) => void;
  priceTable?: VersionedPriceTable;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const identityStore = databaseUrl ? new IdentityStore(databaseUrl) : undefined;
  const executionStore = databaseUrl
    ? new ExecutionStore(databaseUrl, options.priceTable)
    : undefined;
  const candidateStore = databaseUrl ? new CandidateStore(databaseUrl) : undefined;
  let liveSequence = 0;
  const liveClients = new Set<NodeJS.WritableStream>();

  const publishSessionUpdates = (sessionIds: string[]) => {
    const occurredAt = new Date().toISOString();
    for (const sessionId of sessionIds) {
      const event = {
        sequence: ++liveSequence,
        type: "session.updated" as const,
        sessionId,
        occurredAt,
      };
      const encoded = `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of liveClients) client.write(encoded);
    }
  };

  const bearerToken = (request: FastifyRequest) => {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
  };

  const authenticateEvidenceReader = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!identityStore) {
      reply.status(503).send({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database-backed Organization evidence is unavailable.",
        },
      });
      return undefined;
    }
    const bearer = bearerToken(request);
    if (bearer) {
      const analysis = await identityStore.authenticateAnalysis(bearer);
      if (analysis) return { kind: "analysis" as const, ...analysis };
      const device = await identityStore.authenticateDevice(bearer);
      if (device) {
        reply.status(403).send({
          error: {
            code: "DEVICE_CREDENTIAL_SCOPE_FORBIDDEN",
            message: "A Device credential cannot access this Organization capability.",
          },
        });
        return undefined;
      }
      reply.status(401).send({
        error: {
          code: "ANALYSIS_CREDENTIAL_REQUIRED",
          message: "A valid, active Analysis credential is required.",
        },
      });
      return undefined;
    }
    const browserToken = request.cookies[browserSessionCookieName];
    const browserSession = browserToken
      ? await identityStore.getSession(browserToken)
      : undefined;
    if (!browserSession) {
      reply.status(401).send({
        error: {
          code: "BROWSER_SESSION_REQUIRED",
          message: "An authenticated browser session is required.",
        },
      });
      return undefined;
    }
    return { kind: "browser" as const, ...browserSession };
  };

  const rejectAnalysisScope = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const bearer = bearerToken(request);
    if (!bearer || !identityStore) return false;
    const analysis = await identityStore.authenticateAnalysis(bearer);
    if (!analysis) return false;
    reply.status(403).send({
      error: {
        code: "ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN",
        message:
          "An Analysis credential can read Organization evidence and submit Candidates only.",
      },
    });
    return true;
  };

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Coding-agent observability API",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          [analysisCredentialSecuritySchemeName]:
            analysisCredentialOpenApiSecurityScheme,
          [browserSessionSecuritySchemeName]: browserSessionOpenApiSecurityScheme,
          [deviceCredentialSecuritySchemeName]: deviceCredentialOpenApiSecurityScheme,
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.get(
    "/api/v1/health",
    {
      schema: {
        operationId: "getHealth",
        response: { 200: HealthResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (_request, reply) => {
      if (!identityStore || !(await identityStore.isHealthy())) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      return { status: "ok" as const, apiVersion: "v1" as const };
    },
  );

  app.post(
    "/api/v1/analysis-credentials",
    {
      schema: {
        operationId: "createAnalysisCredential",
        security: browserSessionOpenApiSecurity,
        body: AnalysisCredentialCreateRequestSchema,
        response: {
          201: AnalysisCredentialCreateResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const created = await identityStore.createAnalysisCredential(
        session.member.id,
        request.body,
      );
      if (!created) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return reply.status(201).send(created);
    },
  );

  app.get(
    "/api/v1/analysis-credentials",
    {
      schema: {
        operationId: "listAnalysisCredentials",
        security: browserSessionOpenApiSecurity,
        response: {
          200: AnalysisCredentialsResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return {
        analysisCredentials: await identityStore.listAnalysisCredentials(
          session.member.id,
        ),
      };
    },
  );

  app.post(
    "/api/v1/analysis-credentials/:id/revoke",
    {
      schema: {
        operationId: "revokeAnalysisCredential",
        security: browserSessionOpenApiSecurity,
        params: AnalysisCredentialIdParamsSchema,
        response: {
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      if (
        !(await identityStore.revokeAnalysisCredential(
          session.member.id,
          request.params.id,
        ))
      ) {
        return reply.status(404).send({
          error: {
            code: "ANALYSIS_CREDENTIAL_NOT_FOUND",
            message: "The active Analysis credential was not found.",
          },
        });
      }
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/v1/invites",
    {
      schema: {
        operationId: "createInviteCode",
        security: browserSessionOpenApiSecurity,
        body: InviteCodeRequestSchema,
        response: {
          201: InviteCodeResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return reply
        .status(201)
        .send(await identityStore.createInviteCode(session.member.id, request.body));
    },
  );

  app.post(
    "/api/v1/invites/redeem",
    {
      schema: {
        operationId: "redeemInviteCode",
        body: InviteCodeRedeemRequestSchema,
        response: {
          201: AuthenticatedSessionResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const { sessionToken, ...session } = await identityStore.redeemInviteCode(
        request.body,
      );
      return reply
        .setCookie(browserSessionCookieName, sessionToken, {
          httpOnly: true,
          maxAge: 7 * 24 * 60 * 60,
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        })
        .status(201)
        .send(session);
    },
  );

  app.post(
    "/api/v1/device-enrollment-grants",
    {
      schema: {
        operationId: "createDeviceEnrollmentGrant",
        security: browserSessionOpenApiSecurity,
        body: DeviceEnrollmentGrantRequestSchema,
        response: {
          201: DeviceEnrollmentGrantResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return reply
        .status(201)
        .send(
          await identityStore.createDeviceEnrollmentGrant(
            session.member.id,
            request.body,
          ),
        );
    },
  );

  app.post(
    "/api/v1/device-enrollments/redeem",
    {
      schema: {
        operationId: "redeemDeviceEnrollmentGrant",
        body: DeviceEnrollmentRedeemRequestSchema,
        response: {
          201: DeviceEnrollmentResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      return reply
        .status(201)
        .send(await identityStore.redeemDeviceEnrollmentGrant(request.body.grant));
    },
  );

  app.get(
    "/api/v1/devices",
    {
      schema: {
        operationId: "listEnrolledDevices",
        security: browserSessionOpenApiSecurity,
        response: {
          200: EnrolledDevicesResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return { devices: await identityStore.listDevices(session.member.id) };
    },
  );

  app.patch(
    "/api/v1/devices/:id/capture-policy",
    {
      schema: {
        operationId: "updateDeviceCapturePolicy",
        security: browserSessionOpenApiSecurity,
        params: DeviceIdParamsSchema,
        body: UpdateDeviceCapturePolicyRequestSchema,
        response: {
          200: DeviceCapturePolicyResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const policy = await identityStore.updateDeviceCapturePolicy(
        session.member.id,
        request.params.id,
        request.body,
      );
      if (!policy) {
        return reply.status(404).send({
          error: {
            code: "ENROLLED_DEVICE_NOT_FOUND",
            message: "The Enrolled device was not found.",
          },
        });
      }
      return policy;
    },
  );

  app.post(
    "/api/v1/devices/:id/revoke",
    {
      schema: {
        operationId: "revokeDeviceCredential",
        security: browserSessionOpenApiSecurity,
        params: DeviceIdParamsSchema,
        response: {
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const revoked = await identityStore.revokeDevice(
        session.member.id,
        request.params.id,
      );
      if (!revoked) {
        return reply.status(404).send({
          error: {
            code: "ENROLLED_DEVICE_NOT_FOUND",
            message: "The Enrolled device was not found.",
          },
        });
      }
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/device/capture-policy",
    {
      schema: {
        operationId: "getOwnDeviceCapturePolicy",
        security: deviceCredentialOpenApiSecurity,
        response: {
          200: DeviceCapturePolicyResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      if (await rejectAnalysisScope(request, reply)) return;
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      const device = token
        ? await identityStore.authenticateDevice(token)
        : undefined;
      if (!device) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      return device.capturePolicy;
    },
  );

  app.post(
    "/api/v1/device/capture-records",
    {
      schema: {
        operationId: "deliverCaptureRecord",
        security: deviceCredentialOpenApiSecurity,
        body: CaptureRecordSchema,
        response: {
          202: CaptureRecordAcceptedResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      if (await rejectAnalysisScope(request, reply)) return;
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      const device = token
        ? await identityStore.authenticateDevice(token)
        : undefined;
      if (!device) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      const persisted = await identityStore.persistCaptureRecord(
        device.id,
        request.body,
      );
      if (!persisted) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      return reply.status(202).send({ id: request.body.id, accepted: true });
    },
  );

  app.post(
    "/api/v1/device/source-event-batches",
    {
      schema: {
        operationId: "deliverSourceEventBatch",
        security: deviceCredentialOpenApiSecurity,
        body: SourceEventBatchRequestSchema,
        response: {
          200: SourceEventBatchResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      if (await rejectAnalysisScope(request, reply)) return;
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      const device = token
        ? await identityStore.authenticateDevice(token)
        : undefined;
      if (!device) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      const results = await identityStore.persistSourceEventBatch(
        device.id,
        request.body.batchId,
        request.body.events,
      );
      if (!results) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      if (results.some(({ status }) => status === "accepted" || status === "duplicate")) {
        const sessionIds = await executionStore!.projectForDevice(device.id);
        publishSessionUpdates(sessionIds);
      }
      return { batchId: request.body.batchId, results };
    },
  );

  app.get(
    "/api/v1/device/health",
    {
      schema: {
        operationId: "getOwnDeviceHealth",
        security: deviceCredentialOpenApiSecurity,
        response: {
          200: DeviceHealthResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      const device = token
        ? await identityStore.authenticateDevice(token)
        : undefined;
      if (!device) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      return {
        deviceId: device.id,
        status: "healthy" as const,
        lastSeenAt: device.lastSeenAt!,
        policyVersion: device.capturePolicy.version,
      };
    },
  );

  app.get(
    "/api/v1/capture-records/:id",
    {
      schema: {
        operationId: "getCaptureRecord",
        security: browserOrAnalysisOpenApiSecurity,
        params: CaptureRecordIdParamsSchema,
        response: {
          200: CaptureRecordSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      const capture = await identityStore.getCaptureRecord(
        reader.organization.id,
        request.params.id,
      );
      if (!capture) {
        return reply.status(404).send({
          error: {
            code: "CAPTURE_RECORD_NOT_FOUND",
            message: "The capture record was not found.",
          },
        });
      }
      return capture;
    },
  );

  app.get(
    "/api/v1/source-events/:id",
    {
      schema: {
        operationId: "getSourceEvent",
        security: browserOrAnalysisOpenApiSecurity,
        params: SourceEventIdParamsSchema,
        response: {
          200: RetainedSourceEventSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      const event = await identityStore.getSourceEvent(
        reader.organization.id,
        request.params.id,
      );
      if (!event) {
        return reply.status(404).send({
          error: {
            code: "SOURCE_EVENT_NOT_FOUND",
            message: "The source event was not found.",
          },
        });
      }
      return event;
    },
  );

  const forbiddenDeviceCapability = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!identityStore) {
      return reply.status(503).send({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database-backed identity is unavailable.",
        },
      });
    }
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    const analysis = token
      ? await identityStore.authenticateAnalysis(token)
      : undefined;
    if (analysis) {
      return reply.status(403).send({
        error: {
          code: "ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN",
          message:
            "An Analysis credential can read Organization evidence and submit Candidates only.",
        },
      });
    }
    const device = token ? await identityStore.authenticateDevice(token) : undefined;
    if (!device) {
      return reply.status(401).send({
        error: {
          code: "DEVICE_CREDENTIAL_REQUIRED",
          message: "A valid Device credential is required.",
        },
      });
    }
    return reply.status(403).send({
      error: {
        code: "DEVICE_CREDENTIAL_SCOPE_FORBIDDEN",
        message: "A Device credential cannot access this Organization capability.",
      },
    });
  };

  app.get(
    "/api/v1/organization/activity",
    {
      schema: {
        operationId: "searchOrganizationActivity",
        security: browserOrAnalysisOpenApiSecurity,
        querystring: OrganizationActivityQuerySchema,
        response: {
          200: OrganizationActivityResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Organization activity is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      return executionStore.searchActivity(
        reader.organization.id,
        request.query,
      );
    },
  );

  app.post(
    "/api/v1/comparisons",
    {
      schema: {
        operationId: "compareExecutionEvidence",
        security: browserOrAnalysisOpenApiSecurity,
        body: ComparisonRequestSchema,
        response: {
          200: ComparisonResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed comparisons are unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      return executionStore.compare(reader.organization.id, request.body);
    },
  );

  app.get(
    "/api/v1/sessions/:id/turns/:turnId",
    {
      schema: {
        operationId: "resolveTurnEvidenceCitation",
        security: browserOrAnalysisOpenApiSecurity,
        params: ComparisonTurnParamsSchema,
        response: {
          200: CitationTurnTargetResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed evidence citations are unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      const target = await executionStore.getCitationTurn(
        reader.organization.id,
        request.params.id,
        request.params.turnId,
      );
      if (!target) {
        return reply.status(404).send({
          error: {
            code: "TURN_EVIDENCE_NOT_FOUND",
            message: "The cited Turn was not found in the authorized Organization.",
          },
        });
      }
      return target;
    },
  );

  app.get(
    "/api/v1/sessions/:id/activity/:activityId",
    {
      schema: {
        operationId: "resolveActivityEvidenceCitation",
        security: browserOrAnalysisOpenApiSecurity,
        params: ComparisonActivityParamsSchema,
        response: {
          200: CitationActivityTargetResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed evidence citations are unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      const target = await executionStore.getCitationActivity(
        reader.organization.id,
        request.params.id,
        request.params.activityId,
      );
      if (!target) {
        return reply.status(404).send({
          error: {
            code: "ACTIVITY_EVIDENCE_NOT_FOUND",
            message: "The cited activity was not found in the authorized Organization.",
          },
        });
      }
      return target;
    },
  );

  app.patch(
    "/api/v1/sessions/:id/annotations",
    {
      schema: {
        operationId: "annotateExecutionSession",
        security: browserSessionOpenApiSecurity,
        params: ExecutionSessionIdParamsSchema,
        body: SessionAnnotationRequestSchema,
        response: {
          200: SessionAnnotationResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Session annotations are unavailable.",
          },
        });
      }
      if (await rejectAnalysisScope(request, reply)) return;
      const token = request.cookies[browserSessionCookieName];
      const browserSession = token ? await identityStore.getSession(token) : undefined;
      if (!browserSession) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const annotation = await executionStore.annotateSession(
        browserSession.organization.id,
        request.params.id,
        browserSession.member,
        request.body,
      );
      if (annotation === "forbidden") {
        return reply.status(403).send({
          error: {
            code: "SESSION_ANNOTATION_FORBIDDEN",
            message: "Only the Session owner or an Administrator can annotate this Session.",
          },
        });
      }
      if (!annotation) {
        return reply.status(404).send({
          error: {
            code: "EXECUTION_SESSION_NOT_FOUND",
            message: "The Session was not found.",
          },
        });
      }
      return annotation;
    },
  );

  app.post(
    "/api/v1/administration/example-packs/:version/import",
    {
      schema: {
        operationId: "importExamplePack",
        security: browserSessionOpenApiSecurity,
        params: ExamplePackParamsSchema,
        response: {
          200: ExamplePackImportResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Example data is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const browserSession = token ? await identityStore.getSession(token) : undefined;
      if (!browserSession) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      if (browserSession.member.role !== "administrator") {
        return reply.status(403).send({
          error: {
            code: "ADMINISTRATOR_REQUIRED",
            message: "Administrator authority is required.",
          },
        });
      }
      return executionStore.importExamplePack(
        browserSession.organization.id,
        browserSession.member.id,
        request.params.version,
      );
    },
  );

  app.get(
    "/api/v1/sessions",
    {
      schema: {
        operationId: "listExecutionSessions",
        security: browserOrAnalysisOpenApiSecurity,
        response: {
          200: ExecutionSessionsResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed execution history is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      return { sessions: await executionStore.listSessions(reader.organization.id) };
    },
  );
  app.get(
    "/api/v1/sessions/:id",
    {
      schema: {
        operationId: "getExecutionSession",
        security: browserOrAnalysisOpenApiSecurity,
        params: ExecutionSessionIdParamsSchema,
        response: {
          200: ExecutionSessionDetailResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !executionStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed execution history is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      const detail = await executionStore.getSession(
        reader.organization.id,
        request.params.id,
      );
      if (!detail) {
        return reply.status(404).send({
          error: {
            code: "EXECUTION_SESSION_NOT_FOUND",
            message: "The Session was not found.",
          },
        });
      }
      return detail;
    },
  );
  app.get(
    "/api/v1/live",
    {
      schema: {
        operationId: "watchExecutionSessions",
        security: browserOrAnalysisOpenApiSecurity,
        response: { 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed execution history is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write("retry: 1000\n\n");
      liveClients.add(reply.raw);
      request.raw.once("close", () => liveClients.delete(reply.raw));
    },
  );
  app.post(
    "/api/v1/candidates",
    {
      schema: {
        operationId: "submitCandidateSkill",
        security: analysisCredentialOpenApiSecurity,
        body: CandidateSubmissionRequestSchema,
        response: {
          201: CandidateSubmissionResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          422: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Candidate submission is unavailable.",
          },
        });
      }
      const token = bearerToken(request);
      const analysis = token
        ? await identityStore.authenticateAnalysis(token)
        : undefined;
      if (!analysis) {
        const device = token
          ? await identityStore.authenticateDevice(token)
          : undefined;
        if (device) {
          return reply.status(403).send({
            error: {
              code: "DEVICE_CREDENTIAL_SCOPE_FORBIDDEN",
              message: "A Device credential cannot submit a Candidate.",
            },
          });
        }
        return reply.status(401).send({
          error: {
            code: "ANALYSIS_CREDENTIAL_REQUIRED",
            message: "A valid, active Analysis credential is required.",
          },
        });
      }
      return reply.status(201).send(
        await candidateStore.submit(
          analysis.organization.id,
          analysis.member.id,
          analysis.analysisCredential.id,
          request.body,
        ),
      );
    },
  );
  app.get(
    "/api/v1/candidates",
    {
      schema: {
        operationId: "listCandidateSkillHistory",
        security: browserOrAnalysisOpenApiSecurity,
        response: {
          200: CandidateHistoryResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Candidate history is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      return { items: await candidateStore.list(reader.organization.id) };
    },
  );
  app.post(
    "/api/v1/administration/actions",
    {
      schema: {
        operationId: "denyDeviceAdministration",
        security: deviceCredentialOpenApiSecurity,
        response: { 401: ApiErrorSchema, 403: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    forbiddenDeviceCapability,
  );

  app.get(
    "/api/v1/bootstrap/status",
    {
      schema: {
        operationId: "getBootstrapStatus",
        response: {
          200: BootstrapStatusResponseSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      return { required: await identityStore.bootstrapRequired() };
    },
  );

  app.post(
    "/api/v1/bootstrap/redeem",
    {
      schema: {
        operationId: "redeemBootstrapCode",
        body: BootstrapRedeemRequestSchema,
        response: {
          201: AuthenticatedSessionResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const { sessionToken, ...session } = await identityStore.redeemBootstrap(
        request.body,
      );
      return reply
        .setCookie(browserSessionCookieName, sessionToken, {
          httpOnly: true,
          maxAge: 7 * 24 * 60 * 60,
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        })
        .status(201)
        .send(session);
    },
  );

  app.get(
    "/api/v1/session",
    {
      schema: {
        operationId: "getBrowserSession",
        security: browserSessionOpenApiSecurity,
        response: {
          200: AuthenticatedSessionResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed identity is unavailable.",
          },
        });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return session;
    },
  );

  app.get(
    "/api/v1/openapi.json",
    { schema: { hide: true } },
    async (_request, reply) => reply.send(app.swagger()),
  );

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "The requested API route does not exist.",
      },
    }),
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CandidateError) {
      return reply
        .status(error.code === "CANDIDATE_VERSION_EXISTS" ? 409 : 422)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof IdentityError) {
      const status =
        error.code === "BOOTSTRAP_CODE_ALREADY_REDEEMED"
          ? 409
          : error.code === "ADMINISTRATOR_REQUIRED"
            ? 403
            : 401;
      return reply.status(status).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (
      error.validation ||
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      error.statusCode === 400
    ) {
      return reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_FAILED",
          message: "The request did not match the API contract.",
        },
      });
    }
    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "The server could not complete the request.",
      },
    });
  });

  if (identityStore && executionStore) {
    app.addHook("onClose", async () => {
      for (const client of liveClients) client.end();
      liveClients.clear();
      await Promise.all([
        identityStore.close(),
        executionStore.close(),
        candidateStore?.close(),
      ]);
    });
  }
  await app.ready();
  if (identityStore) {
    try {
      const bootstrapCode = await identityStore.ensureBootstrapCode(
        options.bootstrapCode,
      );
      if (bootstrapCode) options.onBootstrapCode?.(bootstrapCode);
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  return app;
}
