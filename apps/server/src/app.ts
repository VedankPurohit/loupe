import swagger from "@fastify/swagger";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import {
  ApiErrorSchema,
  AuthenticatedSessionResponseSchema,
  BootstrapRedeemRequestSchema,
  BootstrapStatusResponseSchema,
  HealthResponseSchema,
  browserSessionCookieName,
  browserSessionOpenApiSecurity,
  browserSessionOpenApiSecurityScheme,
  browserSessionSecuritySchemeName,
} from "@workspace/contracts";

import { IdentityError, IdentityStore } from "./identity-store.js";

export interface BuildAppOptions {
  bootstrapCode?: string;
  databaseUrl?: string;
  onBootstrapCode?: (code: string) => void;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const identityStore = databaseUrl ? new IdentityStore(databaseUrl) : undefined;

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
          [browserSessionSecuritySchemeName]: browserSessionOpenApiSecurityScheme,
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
    if (error instanceof IdentityError) {
      const status =
        error.code === "BOOTSTRAP_CODE_ALREADY_REDEEMED" ? 409 : 401;
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

  if (identityStore) {
    app.addHook("onClose", async () => identityStore.close());
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
