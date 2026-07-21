import { randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  ApiErrorSchema,
  GoogleAuthTransactionResponseSchema,
  GoogleBrowserSessionResponseSchema,
  GoogleCredentialRequestSchema,
  GoogleLinkResponseSchema,
  GoogleUnlinkResponseSchema,
  browserSessionCookieName,
  browserSessionOpenApiSecurity,
} from "@workspace/contracts";

import type { GoogleIdTokenVerifier } from "./google-id-token-verifier.js";
import { GoogleAuthStore } from "./google-auth-store.js";

const transactionLifetimeMs = 5 * 60 * 1_000;
const browserSessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;

export type GoogleAuthConfiguration = {
  clientId: string;
  allowedOrigins: string[];
  verifier: GoogleIdTokenVerifier;
  clock?: () => Date;
  randomSecret?: () => string;
};

export function registerGoogleAuthRoutes(
  app: FastifyInstance,
  dependencies: {
    store: GoogleAuthStore | undefined;
    configuration: GoogleAuthConfiguration | undefined;
  },
): void {
  const clock = dependencies.configuration?.clock ?? (() => new Date());
  const randomSecret =
    dependencies.configuration?.randomSecret ??
    (() => randomBytes(32).toString("base64url"));
  const requireGoogleAuthConfiguration = (reply: {
    status(code: 503): { send(payload: unknown): unknown };
  }) => {
    if (dependencies.store && dependencies.configuration) return true;
    reply.status(503).send({
      error: {
        code: "GOOGLE_AUTH_NOT_CONFIGURED",
        message: "Google authentication is not configured for this deployment.",
      },
    });
    return false;
  };
  const allowedOrigin = (origin: string | undefined): origin is string =>
    origin !== undefined &&
    dependencies.configuration?.allowedOrigins.includes(origin) === true;

  app.post(
    "/api/v1/auth/google/transactions",
    {
      schema: {
        operationId: "createGoogleAuthTransaction",
        response: {
          201: GoogleAuthTransactionResponseSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireGoogleAuthConfiguration(reply)) return;
      const origin = request.headers.origin;
      if (!allowedOrigin(origin)) {
        return reply.status(403).send({
          error: {
            code: "GOOGLE_AUTH_ORIGIN_INVALID",
            message: "The credential-delivery origin is not allowed.",
          },
        });
      }
      const now = clock();
      const expiresAt = new Date(now.getTime() + transactionLifetimeMs);
      const transaction = randomSecret();
      const nonce = randomSecret();
      const csrfToken = randomSecret();
      await dependencies.store!.createTransaction({
        transaction,
        nonce,
        csrfToken,
        origin,
        now,
        expiresAt,
      });
      return reply.status(201).send({
        clientId: dependencies.configuration!.clientId,
        transaction,
        nonce,
        csrfToken,
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  const authenticateCredential = async (
    request: { headers: { origin?: string }; body: unknown },
    reply: { status(code: 403 | 503): { send(payload: unknown): unknown } },
  ) => {
    if (!requireGoogleAuthConfiguration(reply)) return undefined;
    const origin = request.headers.origin;
    if (!allowedOrigin(origin)) {
      reply.status(403).send({
        error: {
          code: "GOOGLE_AUTH_ORIGIN_INVALID",
          message: "The credential-delivery origin is not allowed.",
        },
      });
      return undefined;
    }
    const body = GoogleCredentialRequestSchema.parse(request.body);
    const now = clock();
    await dependencies.store!.consumeTransaction({
      transaction: body.transaction,
      nonce: body.nonce,
      csrfToken: body.csrfToken,
      origin,
      now,
    });
    const identity = await dependencies.configuration!.verifier.verifyCredential(
      body.credential,
      body.nonce,
    );
    return { identity, now };
  };

  app.post(
    "/api/v1/auth/google/session",
    {
      schema: {
        operationId: "createGoogleBrowserSession",
        body: GoogleCredentialRequestSchema,
        response: {
          201: GoogleBrowserSessionResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const authentication = await authenticateCredential(request, reply);
      if (!authentication) return;
      const sessionToken = `session_${randomSecret()}`;
      const session = await dependencies.store!.signIn({
        identity: authentication.identity,
        sessionToken,
        now: authentication.now,
        sessionExpiresAt: new Date(
          authentication.now.getTime() + browserSessionLifetimeMs,
        ),
      });
      return reply
        .setCookie(browserSessionCookieName, sessionToken, {
          httpOnly: true,
          maxAge: browserSessionLifetimeMs / 1_000,
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        })
        .status(201)
        .send(session);
    },
  );

  app.post(
    "/api/v1/auth/google/link",
    {
      schema: {
        operationId: "linkGoogleIdentity",
        security: browserSessionOpenApiSecurity,
        body: GoogleCredentialRequestSchema,
        response: {
          200: GoogleLinkResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireGoogleAuthConfiguration(reply)) return;
      const sessionToken = request.cookies[browserSessionCookieName];
      const personId = sessionToken
        ? await dependencies.store!.authenticatedPersonId(sessionToken, clock())
        : undefined;
      if (!personId) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      const authentication = await authenticateCredential(request, reply);
      if (!authentication) return;
      return dependencies.store!.link(
        personId,
        authentication.identity,
        authentication.now,
      );
    },
  );

  app.delete(
    "/api/v1/auth/google/link",
    {
      schema: {
        operationId: "unlinkGoogleIdentity",
        security: browserSessionOpenApiSecurity,
        response: {
          200: GoogleUnlinkResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireGoogleAuthConfiguration(reply)) return;
      const sessionToken = request.cookies[browserSessionCookieName];
      const now = clock();
      const personId = sessionToken
        ? await dependencies.store!.authenticatedPersonId(sessionToken, now)
        : undefined;
      if (!personId) {
        return reply.status(401).send({
          error: {
            code: "BROWSER_SESSION_REQUIRED",
            message: "An authenticated browser session is required.",
          },
        });
      }
      await dependencies.store!.unlink(personId, now);
      return { unlinked: true as const, revokeGoogleConsent: true as const };
    },
  );
}
