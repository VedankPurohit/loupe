import swagger from "@fastify/swagger";
import cookie from "@fastify/cookie";
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import {
  AnalysisCredentialCreateRequestSchema,
  AnalysisCredentialCreateResponseSchema,
  AnalysisCredentialAuthorizationQuerySchema,
  AnalysisCredentialGrantRedeemRequestSchema,
  AnalysisCredentialIdParamsSchema,
  AnalysisCredentialStatusResponseSchema,
  AnalysisCredentialsResponseSchema,
  ActiveMembershipSelectionRequestSchema,
  ApiErrorSchema,
  AuthenticatedSessionResponseSchema,
  BootstrapRedeemRequestSchema,
  BootstrapStatusResponseSchema,
  CaptureRecordAcceptedResponseSchema,
  CaptureRecordIdParamsSchema,
  CaptureRecordSchema,
  CandidateHistoryResponseSchema,
  CandidateApprovalRequestSchema,
  CandidateApprovalResponseSchema,
  CandidateReviewDecisionRequestSchema,
  CandidateReviewEditRequestSchema,
  CandidateReviewResponseSchema,
  CandidateSubmissionRequestSchema,
  CandidateSubmissionResponseSchema,
  CandidateVersionParamsSchema,
  CitationActivityTargetResponseSchema,
  CitationTurnTargetResponseSchema,
  ComparisonActivityParamsSchema,
  ComparisonRequestSchema,
  ComparisonResponseSchema,
  ComparisonTurnParamsSchema,
  DeviceCapturePolicyResponseSchema,
  DeviceEnrollmentGrantRequestSchema,
  DeviceEnrollmentAuthorizationQuerySchema,
  DeviceDisconnectAuthorizationQuerySchema,
  DeviceEnrollmentGrantResponseSchema,
  DeviceEnrollmentRedeemRequestSchema,
  DeviceEnrollmentResponseSchema,
  DeviceIdParamsSchema,
  DeviceHealthResponseSchema,
  DeviceStandardArtifactSchema,
  DeviceStandardInstallationReportRequestSchema,
  DeviceStandardInstallationSchema,
  DeviceStandardInstallationsResponseSchema,
  DeviceStandardManifestSchema,
  DeviceStandardReleaseParamsSchema,
  EnrolledDevicesResponseSchema,
  EmptyRequestBodySchema,
  ExecutionSessionDetailResponseSchema,
  ExecutionSessionIdParamsSchema,
  ExecutionSessionsResponseSchema,
  ExamplePackImportResponseSchema,
  ExamplePackParamsSchema,
  HealthResponseSchema,
  InviteCodeRedeemRequestSchema,
  InviteCodeIdParamsSchema,
  InviteCodeRequestSchema,
  InviteCodeResponseSchema,
  OrganizationActivityQuerySchema,
  OrganizationActivityResponseSchema,
  OrganizationCreateRequestSchema,
  OrganizationMembershipCreateResponseSchema,
  OrganizationStandardParamsSchema,
  OrganizationStandardRollbackRequestSchema,
  OrganizationStandardsResponseSchema,
  RetainedSourceEventSchema,
  PersonMembershipsResponseSchema,
  PersonBrowserSessionResponseSchema,
  SourceEventBatchRequestSchema,
  SourceEventBatchResponseSchema,
  SourceEventIdParamsSchema,
  StructuralCaptureLedgerQuerySchema,
  StructuralCaptureLedgerResponseSchema,
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
import {
  DeviceDiagnosticsStore,
  registerDeviceDiagnosticsRoutes,
} from "./device-diagnostics.js";
import {
  registerGoogleAuthRoutes,
  type GoogleAuthConfiguration,
} from "./google-auth.js";
import { GoogleAuthError, GoogleAuthStore } from "./google-auth-store.js";
import {
  GoogleIdTokenError,
  GoogleJwksIdTokenVerifier,
  GoogleLibraryIdTokenVerifier,
  type GoogleJwks,
} from "./google-id-token-verifier.js";
import { IdentityError, IdentityStore } from "./identity-store.js";
import { StructuralCaptureLedgerStore } from "./structural-capture-ledger.js";

export interface BuildAppOptions {
  bootstrapCode?: string;
  databaseUrl?: string;
  onBootstrapCode?: (code: string) => void;
  priceTable?: VersionedPriceTable;
  googleAuth?: GoogleAuthConfiguration;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const identityStore = databaseUrl ? new IdentityStore(databaseUrl) : undefined;
  const executionStore = databaseUrl
    ? new ExecutionStore(databaseUrl, options.priceTable)
    : undefined;
  const candidateStore = databaseUrl ? new CandidateStore(databaseUrl) : undefined;
  const deviceDiagnosticsStore = databaseUrl
    ? new DeviceDiagnosticsStore(databaseUrl)
    : undefined;
  const structuralCaptureLedgerStore = databaseUrl
    ? new StructuralCaptureLedgerStore(databaseUrl)
    : undefined;
  const environmentGoogleClientId = process.env.GOOGLE_WEB_CLIENT_ID?.trim();
  const environmentGoogleOrigins = process.env.GOOGLE_AUTH_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const developmentGoogleJwksUrl =
    process.env.GOOGLE_AUTH_DEVELOPMENT_JWKS_URL?.trim();
  const googleAuthConfiguration =
    options.googleAuth ??
    (environmentGoogleClientId && environmentGoogleOrigins?.length
      ? {
          clientId: environmentGoogleClientId,
          allowedOrigins: environmentGoogleOrigins,
          verifier: developmentGoogleJwksUrl
            ? new GoogleJwksIdTokenVerifier({
                allowedAudiences: [environmentGoogleClientId],
                loadJwks: async () => {
                  const response = await fetch(developmentGoogleJwksUrl, {
                    headers: { accept: "application/json" },
                  });
                  if (!response.ok) throw new Error("JWKS unavailable");
                  return (await response.json()) as GoogleJwks;
                },
              })
            : new GoogleLibraryIdTokenVerifier([environmentGoogleClientId]),
        }
      : undefined);
  const googleAuthStore =
    databaseUrl && googleAuthConfiguration
      ? new GoogleAuthStore(databaseUrl)
      : undefined;
  const liveSequences = new Map<string, number>();
  const liveClients = new Map<string, Set<NodeJS.WritableStream>>();

  const publishSessionUpdates = (organizationId: string, sessionIds: string[]) => {
    const occurredAt = new Date().toISOString();
    const clients = liveClients.get(organizationId);
    for (const sessionId of sessionIds) {
      const sequence = (liveSequences.get(organizationId) ?? 0) + 1;
      liveSequences.set(organizationId, sequence);
      const event = {
        sequence,
        type: "session.updated" as const,
        sessionId,
        occurredAt,
      };
      const encoded = `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of clients ?? []) client.write(encoded);
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

  const authenticateAdministrator = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!identityStore) {
      reply.status(503).send({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database-backed administration is unavailable.",
        },
      });
      return undefined;
    }
    const bearer = bearerToken(request);
    if (bearer) {
      const analysis = await identityStore.authenticateAnalysis(bearer);
      if (analysis) {
        reply.status(403).send({
          error: {
            code: "ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN",
            message: "Analysis credentials cannot review or distribute standards.",
          },
        });
        return undefined;
      }
      const device = await identityStore.authenticateDevice(bearer);
      if (device) {
        reply.status(403).send({
          error: {
            code: "DEVICE_CREDENTIAL_SCOPE_FORBIDDEN",
            message: "Device credentials cannot review or distribute standards.",
          },
        });
        return undefined;
      }
    }
    const token = request.cookies[browserSessionCookieName];
    const session = token ? await identityStore.getSession(token) : undefined;
    if (!session) {
      reply.status(401).send({
        error: {
          code: "BROWSER_SESSION_REQUIRED",
          message: "An authenticated browser session is required.",
        },
      });
      return undefined;
    }
    if (session.member.role !== "administrator") {
      reply.status(403).send({
        error: {
          code: "ADMINISTRATOR_REQUIRED",
          message: "Administrator authority is required.",
        },
      });
      return undefined;
    }
    return session;
  };

  const authenticateStandardsDevice = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!identityStore) {
      reply.status(503).send({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database-backed Device synchronization is unavailable.",
        },
      });
      return undefined;
    }
    if (await rejectAnalysisScope(request, reply)) return undefined;
    const token = bearerToken(request);
    const device = token ? await identityStore.authenticateDevice(token) : undefined;
    if (!device) {
      reply.status(401).send({
        error: {
          code: "DEVICE_CREDENTIAL_REQUIRED",
          message: "A valid Device credential is required.",
        },
      });
      return undefined;
    }
    const organizationId = await identityStore.deviceOrganizationId(device.id);
    if (!organizationId) {
      reply.status(401).send({
        error: {
          code: "DEVICE_CREDENTIAL_REQUIRED",
          message: "A valid Device credential is required.",
        },
      });
      return undefined;
    }
    return { device, organizationId };
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

  registerDeviceDiagnosticsRoutes(app, {
    identityStore,
    diagnosticsStore: deviceDiagnosticsStore,
  });
  registerGoogleAuthRoutes(app, {
    store: googleAuthStore,
    configuration: googleAuthConfiguration,
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

  app.get(
    "/api/v1/analysis-credential",
    {
      schema: {
        operationId: "getActiveAnalysisCredential",
        security: analysisCredentialOpenApiSecurity,
        response: {
          200: AnalysisCredentialStatusResponseSchema,
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
      const token = bearerToken(request);
      const authentication = token
        ? await identityStore.authenticateAnalysis(token)
        : undefined;
      if (!authentication) {
        return reply.status(401).send({
          error: {
            code: "ANALYSIS_CREDENTIAL_REQUIRED",
            message: "A valid, active Analysis credential is required.",
          },
        });
      }
      return authentication;
    },
  );

  app.post(
    "/api/v1/analysis-credential/revoke",
    {
      schema: {
        operationId: "revokeActiveAnalysisCredential",
        security: analysisCredentialOpenApiSecurity,
        response: {
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
      const token = bearerToken(request);
      const authentication = token
        ? await identityStore.authenticateAnalysis(token)
        : undefined;
      if (!authentication) {
        return reply.status(401).send({
          error: {
            code: "ANALYSIS_CREDENTIAL_REQUIRED",
            message: "A valid, active Analysis credential is required.",
          },
        });
      }
      await identityStore.revokeAnalysisCredential(
        authentication.member.id,
        authentication.analysisCredential.id,
      );
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
    "/api/v1/invites/:id/revoke",
    {
      schema: {
        operationId: "revokeInviteCode",
        security: browserSessionOpenApiSecurity,
        params: InviteCodeIdParamsSchema,
        response: {
          204: AuthenticatedSessionResponseSchema.optional(),
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
        !(await identityStore.revokeInviteCode(
          session.member.id,
          request.params.id,
        ))
      ) {
        return reply.status(404).send({
          error: {
            code: "INVITE_NOT_FOUND",
            message: "The active Invite code was not found.",
          },
        });
      }
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/v1/organizations",
    {
      schema: {
        operationId: "createOrganizationMembership",
        security: browserSessionOpenApiSecurity,
        body: OrganizationCreateRequestSchema,
        response: {
          201: OrganizationMembershipCreateResponseSchema,
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
      if (!token) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const created = await identityStore.createOrganizationForSession(
        token,
        request.body.name,
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
    "/api/v1/person/memberships",
    {
      schema: {
        operationId: "listPersonMemberships",
        security: browserSessionOpenApiSecurity,
        response: {
          200: PersonMembershipsResponseSchema,
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
      const session = token
        ? await identityStore.getPersonSession(token)
        : undefined;
      if (!session) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const memberships = await identityStore.listPersonMemberships(
        session.person.id,
      );
      if (!memberships) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return memberships;
    },
  );

  app.post(
    "/api/v1/invites/redeem",
    {
      schema: {
        operationId: "redeemInviteCode",
        security: googleAuthConfiguration
          ? browserSessionOpenApiSecurity
          : undefined,
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
      const existingSessionToken =
        request.cookies[browserSessionCookieName];
      const existingSession = existingSessionToken
        ? await identityStore.getPersonSession(existingSessionToken)
        : undefined;
      if (googleAuthConfiguration && !existingSession) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "Sign in before redeeming an Invite code.",
          },
        });
      }
      const { sessionToken, ...session } = await identityStore.redeemInviteCode(
        request.body,
        existingSession ? existingSessionToken : undefined,
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

  app.put(
    "/api/v1/session/active-membership",
    {
      schema: {
        operationId: "selectActiveOrganizationMembership",
        security: browserSessionOpenApiSecurity,
        body: ActiveMembershipSelectionRequestSchema,
        response: {
          200: AuthenticatedSessionResponseSchema,
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
      const authenticated = token
        ? await identityStore.getPersonSession(token)
        : undefined;
      if (!token || !authenticated) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const selected = await identityStore.selectActiveMembership(
        token,
        request.body.membershipId,
      );
      if (!selected) {
        return reply.status(404).send({
          error: {
            code: "MEMBERSHIP_NOT_FOUND",
            message: "That Organization membership is not available to this Person.",
          },
        });
      }
      return selected;
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

  const escapeInstallerHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const parseInstallerCallback = (value: string): URL | undefined => {
    try {
      const callback = new URL(value);
      const loopback =
        callback.protocol === "http:" &&
        (callback.hostname === "localhost" ||
          callback.hostname === "127.0.0.1" ||
          callback.hostname === "[::1]");
      if (!loopback || !callback.port) return undefined;
      return callback;
    } catch {
      return undefined;
    }
  };
  const sendInstallerConfirmation = (
    reply: FastifyReply,
    input: { title: string; summary: string; action: string },
  ) =>
    reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
      )
      .send(`<!doctype html><meta charset="utf-8"><title>${escapeInstallerHtml(input.title)}</title>
<style>body{font:16px system-ui;max-width:42rem;margin:10vh auto;padding:2rem}button{font:inherit;padding:.7rem 1rem}</style>
<h1>${escapeInstallerHtml(input.title)}</h1>
<p>${escapeInstallerHtml(input.summary)}</p>
<form method="post"><button type="submit">${escapeInstallerHtml(input.action)}</button></form>`);
  const sendInstallerHandoff = (
    reply: FastifyReply,
    input: { callback: URL; title: string; message: string; fields: Record<string, string> },
  ) => {
    const nonce = randomBytes(18).toString("base64url");
    const fields = Object.entries(input.fields)
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${escapeInstallerHtml(name)}" value="${escapeInstallerHtml(value)}">`,
      )
      .join("\n  ");
    return reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; form-action http://localhost:* http://127.0.0.1:* http://[::1]:*; base-uri 'none'`,
      )
      .send(`<!doctype html><meta charset="utf-8"><title>${escapeInstallerHtml(input.title)}</title>
<p>${escapeInstallerHtml(input.message)}</p>
<form id="handoff" method="post" action="${escapeInstallerHtml(input.callback.toString())}">
  ${fields}
</form>
<script nonce="${nonce}">document.getElementById("handoff").submit()</script>`);
  };

  app.get(
    "/api/v1/analysis-credential/authorize",
    {
      schema: {
        operationId: "authorizeAnalysisCredentialInBrowser",
        security: browserSessionOpenApiSecurity,
        querystring: AnalysisCredentialAuthorizationQuerySchema,
        response: {
          200: z.string(),
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
      const callback = parseInstallerCallback(request.query.callback);
      if (!callback) {
        return reply.status(400).send({
          error: {
            code: "ANALYSIS_CALLBACK_INVALID",
            message: "The Analysis CLI callback must be a loopback HTTP URL.",
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
      return sendInstallerConfirmation(reply, {
        title: "Authorize Analysis credential",
        summary: `Create ${request.query.name} for ${session.organization.name}. It can read this Organization's evidence and submit Candidates, but cannot administer Loupe.`,
        action: "Authorize Analysis credential",
      });
    },
  );

  app.post(
    "/api/v1/analysis-credential/authorize",
    {
      schema: {
        operationId: "completeAnalysisCredentialAuthorizationInBrowser",
        security: browserSessionOpenApiSecurity,
        querystring: AnalysisCredentialAuthorizationQuerySchema,
        response: {
          200: z.string(),
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
      const callback = parseInstallerCallback(request.query.callback);
      if (!callback) {
        return reply.status(400).send({
          error: {
            code: "ANALYSIS_CALLBACK_INVALID",
            message: "The Analysis CLI callback must be a loopback HTTP URL.",
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
      const authorization = await identityStore.createAnalysisCredentialGrant(
        session.member.id,
        { name: request.query.name },
      );
      if (!authorization) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return sendInstallerHandoff(reply, {
        callback,
        title: "Loupe Analysis credential authorized",
        message: "Authorization received. You may close this tab.",
        fields: { grant: authorization.grant, state: request.query.state },
      });
    },
  );

  app.post(
    "/api/v1/analysis-credential-grants/redeem",
    {
      schema: {
        operationId: "redeemAnalysisCredentialGrant",
        body: AnalysisCredentialGrantRedeemRequestSchema,
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
      return reply
        .status(201)
        .send(await identityStore.redeemAnalysisCredentialGrant(request.body.grant));
    },
  );

  /**
   * Browser authorization used by the packaged relay installer. The GET is a
   * read-only confirmation page; only its same-origin POST issues a grant.
   * The installer receives the grant at loopback and never sees the browser's
   * HttpOnly Loupe Session cookie.
   */
  app.get(
    "/api/v1/device-enrollment/authorize",
    {
      schema: {
        operationId: "authorizeDeviceEnrollmentInBrowser",
        security: browserSessionOpenApiSecurity,
        querystring: DeviceEnrollmentAuthorizationQuerySchema,
        response: {
          200: z.string(),
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
      const callback = parseInstallerCallback(request.query.callback);
      if (!callback) {
        return reply.status(400).send({
          error: {
            code: "ENROLLMENT_CALLBACK_INVALID",
            message: "The installer callback must be a loopback HTTP URL.",
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
      return sendInstallerConfirmation(reply, {
        title: "Authorize Enrolled device",
        summary: `Enroll ${request.query.deviceName} in ${session.organization.name}. Captured Codex evidence will be visible to this Organization.`,
        action: "Authorize Enrolled device",
      });
    },
  );

  app.post(
    "/api/v1/device-enrollment/authorize",
    {
      schema: {
        operationId: "completeDeviceEnrollmentAuthorizationInBrowser",
        security: browserSessionOpenApiSecurity,
        querystring: DeviceEnrollmentAuthorizationQuerySchema,
        response: {
          200: z.string(),
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
      const callback = parseInstallerCallback(request.query.callback);
      if (!callback) {
        return reply.status(400).send({
          error: {
            code: "ENROLLMENT_CALLBACK_INVALID",
            message: "The installer callback must be a loopback HTTP URL.",
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
      const { grant } = await identityStore.createDeviceEnrollmentGrant(
        session.member.id,
        { deviceName: request.query.deviceName },
      );
      return sendInstallerHandoff(reply, {
        callback,
        title: "Loupe device authorized",
        message: "Authorization received. You may close this tab.",
        fields: { grant, state: request.query.state },
      });
    },
  );

  app.get(
    "/api/v1/device-disconnect/authorize",
    {
      schema: {
        operationId: "authorizeDeviceDisconnectInBrowser",
        security: browserSessionOpenApiSecurity,
        querystring: DeviceDisconnectAuthorizationQuerySchema,
        response: {
          200: z.string(),
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
      const callback = parseInstallerCallback(request.query.callback);
      if (!callback) {
        return reply.status(400).send({ error: { code: "ENROLLMENT_CALLBACK_INVALID", message: "The installer callback must be a loopback HTTP URL." } });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({ error: { code: "BROWSER_SESSION_REQUIRED", message: "An authenticated browser session is required." } });
      }
      return sendInstallerConfirmation(reply, {
        title: "Disconnect Enrolled device",
        summary: `Revoke future delivery from this Enrolled device in ${session.organization.name}. Accepted history will be preserved.`,
        action: "Disconnect Enrolled device",
      });
    },
  );

  app.post(
    "/api/v1/device-disconnect/authorize",
    {
      schema: {
        operationId: "completeDeviceDisconnectAuthorizationInBrowser",
        security: browserSessionOpenApiSecurity,
        querystring: DeviceDisconnectAuthorizationQuerySchema,
        response: {
          200: z.string(),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore) {
        return reply.status(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database-backed identity is unavailable." } });
      }
      const callback = parseInstallerCallback(request.query.callback);
      if (!callback) {
        return reply.status(400).send({ error: { code: "ENROLLMENT_CALLBACK_INVALID", message: "The installer callback must be a loopback HTTP URL." } });
      }
      const token = request.cookies[browserSessionCookieName];
      const session = token ? await identityStore.getSession(token) : undefined;
      if (!session) {
        return reply.status(401).send({ error: { code: "BROWSER_SESSION_REQUIRED", message: "An authenticated browser session is required." } });
      }
      if (!(await identityStore.revokeDevice(session.member.id, request.query.deviceId))) {
        return reply.status(404).send({ error: { code: "ENROLLED_DEVICE_NOT_FOUND", message: "The Enrolled device was not found." } });
      }
      return sendInstallerHandoff(reply, {
        callback,
        title: "Loupe device disconnected",
        message: "Disconnect complete. You may close this tab.",
        fields: { state: request.query.state, status: "revoked" },
      });
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

  app.post(
    "/api/v1/device-connection/revoke",
    {
      schema: {
        operationId: "revokeOwnDeviceConnection",
        security: deviceCredentialOpenApiSecurity,
        response: {
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
      const credential = bearerToken(request);
      const device = credential
        ? await identityStore.authenticateDevice(credential)
        : undefined;
      if (!device) {
        return reply.status(401).send({
          error: {
            code: "DEVICE_CREDENTIAL_REQUIRED",
            message: "A valid Device credential is required.",
          },
        });
      }
      await identityStore.revokeDevice(device.memberId, device.id);
      return reply.status(204).send();
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
        const organizationId = await identityStore.deviceOrganizationId(device.id);
        const sessionIds = await executionStore!.projectForDevice(device.id);
        if (organizationId) publishSessionUpdates(organizationId, sessionIds);
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

  app.get(
    "/api/v1/structural-capture-ledger",
    {
      schema: {
        operationId: "listStructuralCaptureLedger",
        security: browserOrAnalysisOpenApiSecurity,
        querystring: StructuralCaptureLedgerQuerySchema,
        response: {
          200: StructuralCaptureLedgerResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!identityStore || !structuralCaptureLedgerStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "The structural capture ledger is unavailable.",
          },
        });
      }
      const reader = await authenticateEvidenceReader(request, reply);
      if (!reader) return;
      return structuralCaptureLedgerStore.list(
        reader.organization.id,
        request.query,
      );
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
        body: EmptyRequestBodySchema,
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
      let organizationClients = liveClients.get(reader.organization.id);
      if (!organizationClients) {
        organizationClients = new Set();
        liveClients.set(reader.organization.id, organizationClients);
      }
      organizationClients.add(reply.raw);
      request.raw.once("close", () => {
        organizationClients!.delete(reply.raw);
        if (organizationClients!.size === 0) {
          liveClients.delete(reader.organization.id);
        }
      });
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
      preValidation: async (request, reply) => {
        if (!identityStore) return;
        const token = bearerToken(request);
        const device = token
          ? await identityStore.authenticateDevice(token)
          : undefined;
        if (device) {
          return reply.status(403).send({
            error: {
              code: "DEVICE_CREDENTIAL_SCOPE_FORBIDDEN",
              message: "A Device credential cannot access this Organization capability.",
            },
          });
        }
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
    "/api/v1/candidates/:candidateId/versions/:versionId/edit",
    {
      schema: {
        operationId: "editCandidateSkillVersion",
        security: browserSessionOpenApiSecurity,
        params: CandidateVersionParamsSchema,
        body: CandidateReviewEditRequestSchema,
        response: {
          201: CandidateSubmissionResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          422: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Candidate review is unavailable.",
          },
        });
      }
      const administrator = await authenticateAdministrator(request, reply);
      if (!administrator) return;
      return reply.status(201).send(
        await candidateStore.edit(
          administrator.organization.id,
          administrator.member.id,
          request.params.candidateId,
          request.params.versionId,
          request.body,
        ),
      );
    },
  );
  app.post(
    "/api/v1/candidates/:candidateId/versions/:versionId/reject",
    {
      schema: {
        operationId: "rejectCandidateSkillVersion",
        security: browserSessionOpenApiSecurity,
        params: CandidateVersionParamsSchema,
        body: CandidateReviewDecisionRequestSchema,
        response: {
          200: CandidateSubmissionResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Candidate review is unavailable.",
          },
        });
      }
      const administrator = await authenticateAdministrator(request, reply);
      if (!administrator) return;
      return candidateStore.reject(
        administrator.organization.id,
        administrator.member.id,
        request.params.candidateId,
        request.params.versionId,
        request.body.note,
      );
    },
  );
  app.post(
    "/api/v1/candidates/:candidateId/versions/:versionId/approve",
    {
      schema: {
        operationId: "approveCandidateSkillVersion",
        security: browserSessionOpenApiSecurity,
        params: CandidateVersionParamsSchema,
        body: CandidateApprovalRequestSchema,
        response: {
          201: CandidateApprovalResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed Candidate approval is unavailable.",
          },
        });
      }
      const administrator = await authenticateAdministrator(request, reply);
      if (!administrator) return;
      const release = await candidateStore.approve(
        administrator.organization.id,
        administrator.member.id,
        request.params.candidateId,
        request.params.versionId,
        request.body.artifactHash,
      );
      return reply.status(201).send({ release });
    },
  );

  app.get(
    "/api/v1/device/standards/manifest",
    {
      schema: {
        operationId: "getDeviceStandardManifest",
        security: deviceCredentialOpenApiSecurity,
        response: {
          200: DeviceStandardManifestSchema,
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
            message: "Database-backed standards are unavailable.",
          },
        });
      }
      const authentication = await authenticateStandardsDevice(request, reply);
      if (!authentication) return;
      return candidateStore.deviceManifest(authentication.organizationId);
    },
  );
  app.get(
    "/api/v1/device/standards/artifacts/:releaseId",
    {
      schema: {
        operationId: "getApprovedDeviceStandardArtifact",
        security: deviceCredentialOpenApiSecurity,
        params: DeviceStandardReleaseParamsSchema,
        response: {
          200: DeviceStandardArtifactSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed standards are unavailable.",
          },
        });
      }
      const authentication = await authenticateStandardsDevice(request, reply);
      if (!authentication) return;
      const artifact = await candidateStore.artifact(
        authentication.organizationId,
        request.params.releaseId,
      );
      if (!artifact) {
        return reply.status(404).send({
          error: {
            code: "STANDARD_RELEASE_NOT_FOUND",
            message: "The approved Organization standard release was not found.",
          },
        });
      }
      return artifact;
    },
  );
  app.get(
    "/api/v1/device/standards/installations",
    {
      schema: {
        operationId: "getOwnDeviceStandardInstallations",
        security: deviceCredentialOpenApiSecurity,
        response: {
          200: DeviceStandardInstallationsResponseSchema,
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
            message: "Database-backed installation status is unavailable.",
          },
        });
      }
      const authentication = await authenticateStandardsDevice(request, reply);
      if (!authentication) return;
      return {
        items: await candidateStore.deviceInstallations(authentication.device.id),
      };
    },
  );
  app.post(
    "/api/v1/device/standards/installations",
    {
      schema: {
        operationId: "reportOwnDeviceStandardInstallation",
        security: deviceCredentialOpenApiSecurity,
        body: DeviceStandardInstallationReportRequestSchema,
        response: {
          201: DeviceStandardInstallationSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database-backed installation status is unavailable.",
          },
        });
      }
      const authentication = await authenticateStandardsDevice(request, reply);
      if (!authentication) return;
      return reply.status(201).send(
        await candidateStore.reportInstallation(
          authentication.organizationId,
          authentication.device.id,
          request.body,
        ),
      );
    },
  );

  app.get(
    "/api/v1/organization-standards",
    {
      schema: {
        operationId: "listOrganizationStandards",
        security: browserSessionOpenApiSecurity,
        response: {
          200: OrganizationStandardsResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: { code: "DATABASE_UNAVAILABLE", message: "Standards are unavailable." },
        });
      }
      const administrator = await authenticateAdministrator(request, reply);
      if (!administrator) return;
      return { items: await candidateStore.standards(administrator.organization.id) };
    },
  );
  for (const action of ["pause", "resume"] as const) {
    app.post(
      `/api/v1/organization-standards/:standardId/${action}`,
      {
        schema: {
          operationId: `${action}OrganizationStandardDistribution`,
          security: browserSessionOpenApiSecurity,
          params: OrganizationStandardParamsSchema,
          response: {
            204: CandidateReviewResponseSchema.optional(),
            401: ApiErrorSchema,
            403: ApiErrorSchema,
            404: ApiErrorSchema,
            503: ApiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (!candidateStore) {
          return reply.status(503).send({
            error: { code: "DATABASE_UNAVAILABLE", message: "Standards are unavailable." },
          });
        }
        const administrator = await authenticateAdministrator(request, reply);
        if (!administrator) return;
        await candidateStore.setDistribution(
          administrator.organization.id,
          request.params.standardId,
          action === "pause" ? "paused" : "active",
        );
        return reply.status(204).send();
      },
    );
  }
  app.post(
    "/api/v1/organization-standards/:standardId/rollback",
    {
      schema: {
        operationId: "rollbackOrganizationStandard",
        security: browserSessionOpenApiSecurity,
        params: OrganizationStandardParamsSchema,
        body: OrganizationStandardRollbackRequestSchema,
        response: {
          204: CandidateReviewResponseSchema.optional(),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!candidateStore) {
        return reply.status(503).send({
          error: { code: "DATABASE_UNAVAILABLE", message: "Standards are unavailable." },
        });
      }
      const administrator = await authenticateAdministrator(request, reply);
      if (!administrator) return;
      await candidateStore.rollback(
        administrator.organization.id,
        request.params.standardId,
        request.body.releaseId,
      );
      return reply.status(204).send();
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
          200: PersonBrowserSessionResponseSchema,
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
      const session = token
        ? await identityStore.getPersonSession(token)
        : undefined;
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

  app.post(
    "/api/v1/session/logout",
    {
      schema: {
        operationId: "logoutBrowserSession",
        security: browserSessionOpenApiSecurity,
        response: {
          204: AuthenticatedSessionResponseSchema.optional(),
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
      if (!token || !(await identityStore.revokeSession(token))) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      return reply
        .clearCookie(browserSessionCookieName, {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        })
        .status(204)
        .send();
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
      const status =
        error.code === "CANDIDATE_NOT_FOUND" ||
        error.code === "STANDARD_NOT_FOUND" ||
        error.code === "STANDARD_RELEASE_NOT_FOUND"
          ? 404
          : error.code === "CANDIDATE_VERSION_EXISTS" ||
              error.code === "CANDIDATE_REVIEW_ALREADY_DECIDED" ||
              error.code === "CANDIDATE_APPROVAL_HASH_MISMATCH"
            ? 409
            : 422;
      return reply
        .status(status)
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
    if (error instanceof GoogleAuthError) {
      const status =
        error.code === "GOOGLE_AUTH_ORIGIN_INVALID" ||
        error.code === "GOOGLE_AUTH_CSRF_INVALID"
          ? 403
          : error.code === "GOOGLE_AUTH_TRANSACTION_REPLAYED" ||
              error.code === "GOOGLE_IDENTITY_ALREADY_LINKED" ||
              error.code === "GOOGLE_IDENTITY_UNLINKED"
            ? 409
            : error.code === "GOOGLE_IDENTITY_NOT_LINKED"
              ? 404
              : 401;
      return reply.status(status).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof GoogleIdTokenError) {
      const status =
        error.code === "GOOGLE_ID_TOKEN_VERIFICATION_UNAVAILABLE" ? 503 : 401;
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
      for (const clients of liveClients.values()) {
        for (const client of clients) client.end();
      }
      liveClients.clear();
      liveSequences.clear();
      await Promise.all([
        identityStore.close(),
        executionStore.close(),
        candidateStore?.close(),
        deviceDiagnosticsStore?.close(),
        structuralCaptureLedgerStore?.close(),
        googleAuthStore?.close(),
      ]);
    });
    await executionStore.reprojectAllOrganizations();
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
