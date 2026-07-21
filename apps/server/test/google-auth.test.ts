import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { GoogleJwksIdTokenVerifier } from "../src/google-id-token-verifier.js";
import { createTestDatabase } from "./test-database.js";

const clientId = "loupe-development.apps.googleusercontent.com";
const allowedOrigin = "http://localhost:5173";
const now = new Date("2026-07-18T10:00:00.000Z");
const keyId = "development-key-1";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: "jwk" });

function signedCredential(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

describe.sequential("Google Person authentication through /api/v1", () => {
  const testDatabase = createTestDatabase("google_person_auth");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bootstrapCode: string | undefined;

  async function begin(origin = allowedOrigin) {
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/google/transactions",
      headers: { origin },
    });
  }

  function validClaims(nonce: string, overrides: Record<string, unknown> = {}) {
    return {
      iss: "https://accounts.google.com",
      aud: clientId,
      sub: `google-subject-${randomUUID()}`,
      email: "person@example.test",
      name: "Google Person Example",
      picture: "https://profiles.example.test/person.png",
      nonce,
      iat: Math.floor(now.getTime() / 1_000) - 10,
      exp: Math.floor(now.getTime() / 1_000) + 300,
      ...overrides,
    };
  }

  async function submit(
    transaction: Awaited<ReturnType<typeof begin>>,
    claims: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
    origin = allowedOrigin,
    path = "/api/v1/auth/google/session",
    cookie?: string,
  ) {
    return app.inject({
      method: "POST",
      url: path,
      headers: { origin, ...(cookie ? { cookie } : {}) },
      payload: {
        transaction: transaction.json().transaction,
        nonce: transaction.json().nonce,
        csrfToken: transaction.json().csrfToken,
        credential: signedCredential(claims),
        ...overrides,
      },
    });
  }

  function responseCookie(response: {
    headers: Record<string, string | string[] | number | undefined>;
  }): string {
    const value = response.headers["set-cookie"];
    const serialized = Array.isArray(value) ? value[0] : value;
    if (typeof serialized !== "string") throw new Error("Missing browser cookie");
    return serialized.split(";", 1)[0]!;
  }

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      googleAuth: {
        clientId,
        allowedOrigins: [allowedOrigin],
        clock: () => now,
        randomSecret: () => randomUUID().replaceAll("-", ""),
        verifier: new GoogleJwksIdTokenVerifier({
          allowedAudiences: [clientId],
          clock: () => now,
          loadJwks: async () => ({
            keys: [{ ...publicJwk, kid: keyId, alg: "RS256", use: "sig" }],
          }),
        }),
      },
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("creates an authenticated Loupe browser session for the Google sub in an independently signed development credential", async () => {
    const transaction = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google/transactions",
      headers: { origin: allowedOrigin },
    });
    expect(transaction.statusCode).toBe(201);

    const credential = signedCredential({
      iss: "https://accounts.google.com",
      aud: clientId,
      sub: "google-subject-alice-001",
      email: "alice@example.test",
      email_verified: true,
      name: "Alice Example",
      picture: "https://profiles.example.test/alice.png",
      nonce: transaction.json().nonce,
      iat: Math.floor(now.getTime() / 1_000) - 10,
      exp: Math.floor(now.getTime() / 1_000) + 300,
    });
    const signIn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google/session",
      headers: { origin: allowedOrigin },
      payload: {
        transaction: transaction.json().transaction,
        nonce: transaction.json().nonce,
        csrfToken: transaction.json().csrfToken,
        credential,
      },
    });

    expect(signIn.statusCode).toBe(201);
    expect(signIn.json()).toMatchObject({
      person: {
        displayName: "Alice Example",
        email: "alice@example.test",
      },
      organization: null,
      member: null,
      googleProfile: {
        subject: "google-subject-alice-001",
        avatarUrl: "https://profiles.example.test/alice.png",
      },
    });
    expect(signIn.headers["set-cookie"]).toContain("browser_session=");
    expect(signIn.headers["set-cookie"]).toContain("HttpOnly");
    expect(JSON.stringify(signIn.json())).not.toContain(credential);
    expect(signIn.body).not.toContain("session_");

    const cookie = Array.isArray(signIn.headers["set-cookie"])
      ? signIn.headers["set-cookie"][0]!
      : signIn.headers["set-cookie"]!;
    const persistedSession = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie: cookie.split(";", 1)[0]! },
    });
    expect(persistedSession.statusCode).toBe(200);
    expect(persistedSession.json()).toMatchObject({
      person: { id: signIn.json().person.id },
      organization: null,
      member: null,
    });
  });

  it("rejects a credential signed by an untrusted key without echoing it", async () => {
    const transaction = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google/transactions",
      headers: { origin: allowedOrigin },
    });
    const rogueKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: clientId,
        sub: "untrusted-subject",
        nonce: transaction.json().nonce,
        exp: Math.floor(now.getTime() / 1_000) + 300,
      }),
    ).toString("base64url");
    const input = `${header}.${payload}`;
    const credential = `${input}.${sign("RSA-SHA256", Buffer.from(input), rogueKey).toString("base64url")}`;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google/session",
      headers: { origin: allowedOrigin },
      payload: {
        transaction: transaction.json().transaction,
        nonce: transaction.json().nonce,
        csrfToken: transaction.json().csrfToken,
        credential,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
        message: "The Google credential signature could not be verified.",
      },
    });
    expect(response.body).not.toContain(credential);
  });

  it("rejects a signed credential from the wrong issuer", async () => {
    const transaction = await begin();
    const response = await submit(
      transaction,
      validClaims(transaction.json().nonce, { iss: "https://issuer.example.test" }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_ID_TOKEN_ISSUER_INVALID",
        message: "The Google credential issuer is not allowed.",
      },
    });
  });

  it("rejects a signed credential for a different Web client audience", async () => {
    const transaction = await begin();
    const response = await submit(
      transaction,
      validClaims(transaction.json().nonce, {
        aud: "another-client.apps.googleusercontent.com",
      }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_ID_TOKEN_AUDIENCE_INVALID",
        message: "The Google credential audience is not allowed.",
      },
    });
  });

  it("rejects an expired signed credential", async () => {
    const transaction = await begin();
    const response = await submit(
      transaction,
      validClaims(transaction.json().nonce, {
        exp: Math.floor(now.getTime() / 1_000),
      }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_ID_TOKEN_EXPIRED",
        message: "The Google credential has expired.",
      },
    });
  });

  it("rejects a transaction nonce mismatch before credential verification", async () => {
    const transaction = await begin();
    const response = await submit(
      transaction,
      validClaims(transaction.json().nonce),
      { nonce: "mismatched-nonce-value-that-is-long-enough" },
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_AUTH_NONCE_INVALID",
        message:
          "The Google authentication nonce is invalid or has already been used.",
      },
    });
  });

  it("rejects a signed credential whose nonce does not match its transaction", async () => {
    const transaction = await begin();
    const response = await submit(
      transaction,
      validClaims("different-signed-nonce-value"),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_ID_TOKEN_NONCE_INVALID",
        message:
          "The Google credential nonce is invalid or has already been used.",
      },
    });
  });

  it("consumes a Google authentication transaction exactly once", async () => {
    const transaction = await begin();
    const claims = validClaims(transaction.json().nonce);
    const first = await submit(transaction, claims);
    expect(first.statusCode).toBe(201);

    const replay = await submit(transaction, claims);
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({
      error: {
        code: "GOOGLE_AUTH_TRANSACTION_REPLAYED",
        message: "The Google authentication transaction has already been used.",
      },
    });
  });

  it("rejects transaction creation and credential delivery from another origin", async () => {
    const rejectedStart = await begin("https://attacker.example.test");
    expect(rejectedStart.statusCode).toBe(403);
    expect(rejectedStart.json()).toEqual({
      error: {
        code: "GOOGLE_AUTH_ORIGIN_INVALID",
        message: "The credential-delivery origin is not allowed.",
      },
    });

    const transaction = await begin();
    const rejectedDelivery = await submit(
      transaction,
      validClaims(transaction.json().nonce),
      {},
      "https://attacker.example.test",
    );
    expect(rejectedDelivery.statusCode).toBe(403);
    expect(rejectedDelivery.json()).toEqual(rejectedStart.json());
  });

  it("rejects a credential delivery with the wrong CSRF token", async () => {
    const transaction = await begin();
    const response = await submit(
      transaction,
      validClaims(transaction.json().nonce),
      { csrfToken: "wrong-csrf-token-value-that-is-long-enough" },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "GOOGLE_AUTH_CSRF_INVALID",
        message: "The Google authentication CSRF token is invalid.",
      },
    });
  });

  it("keys Google identity by sub while refreshing mutable profile fields", async () => {
    const subject = `stable-subject-${randomUUID()}`;
    const firstTransaction = await begin();
    const first = await submit(
      firstTransaction,
      validClaims(firstTransaction.json().nonce, {
        sub: subject,
        email: "old-profile@example.test",
        name: "Old Profile Name",
        picture: "https://profiles.example.test/old.png",
      }),
    );
    expect(first.statusCode).toBe(201);

    const secondTransaction = await begin();
    const second = await submit(
      secondTransaction,
      validClaims(secondTransaction.json().nonce, {
        sub: subject,
        email: "new-profile@example.test",
        name: "New Profile Name",
        picture: "https://profiles.example.test/new.png",
      }),
    );
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({
      person: {
        id: first.json().person.id,
        email: "new-profile@example.test",
        displayName: "New Profile Name",
      },
      googleProfile: {
        subject,
        avatarUrl: "https://profiles.example.test/new.png",
      },
    });
  });

  it("does not merge different Google subs that report the same email", async () => {
    const sharedEmail = "shared-address@example.test";
    const firstTransaction = await begin();
    const first = await submit(
      firstTransaction,
      validClaims(firstTransaction.json().nonce, {
        sub: `first-${randomUUID()}`,
        email: sharedEmail,
      }),
    );
    const secondTransaction = await begin();
    const second = await submit(
      secondTransaction,
      validClaims(secondTransaction.json().nonce, {
        sub: `second-${randomUUID()}`,
        email: sharedEmail,
      }),
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().person.id).not.toBe(first.json().person.id);
  });

  it("links Google to an existing local Person only through an authenticated explicit request", async () => {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Local Migration Organization" },
        administrator: { displayName: "Existing Local Person" },
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    const localPersonId = bootstrap.json().person.id;
    const localCookie = responseCookie(bootstrap);
    const subject = `explicit-link-${randomUUID()}`;

    const unauthenticatedTransaction = await begin();
    const unauthenticated = await submit(
      unauthenticatedTransaction,
      validClaims(unauthenticatedTransaction.json().nonce, { subject }),
      {},
      allowedOrigin,
      "/api/v1/auth/google/link",
    );
    expect(unauthenticated.statusCode).toBe(401);

    const transaction = await begin();
    const linked = await submit(
      transaction,
      validClaims(transaction.json().nonce, {
        sub: subject,
        email: "existing-local@example.test",
        name: "Existing Local Person Linked",
      }),
      {},
      allowedOrigin,
      "/api/v1/auth/google/link",
      localCookie,
    );
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      person: { id: localPersonId },
      googleProfile: { subject },
    });

    const signInTransaction = await begin();
    const signIn = await submit(
      signInTransaction,
      validClaims(signInTransaction.json().nonce, { sub: subject }),
    );
    expect(signIn.statusCode).toBe(201);
    expect(signIn.json().person.id).toBe(localPersonId);
  });

  it("unlinks Google through a distinct explicit operation", async () => {
    const transaction = await begin();
    const subject = `unlink-${randomUUID()}`;
    const signIn = await submit(
      transaction,
      validClaims(transaction.json().nonce, { sub: subject }),
    );
    const cookie = responseCookie(signIn);
    const unlink = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/google/link",
      headers: { cookie },
    });
    expect(unlink.statusCode).toBe(200);
    expect(unlink.json()).toEqual({
      unlinked: true,
      revokeGoogleConsent: true,
    });

    const ordinarySignInTransaction = await begin();
    const ordinarySignIn = await submit(
      ordinarySignInTransaction,
      validClaims(ordinarySignInTransaction.json().nonce, { sub: subject }),
    );
    expect(ordinarySignIn.statusCode).toBe(409);
    expect(ordinarySignIn.json()).toEqual({
      error: {
        code: "GOOGLE_IDENTITY_UNLINKED",
        message:
          "This Google identity was unlinked and requires an explicit authenticated relink.",
      },
    });

    const relinkTransaction = await begin();
    const relink = await submit(
      relinkTransaction,
      validClaims(relinkTransaction.json().nonce, { sub: subject }),
      {},
      allowedOrigin,
      "/api/v1/auth/google/link",
      cookie,
    );
    expect(relink.statusCode).toBe(200);
  });

  it("logs out only the Loupe browser session and denies reuse of its token", async () => {
    const transaction = await begin();
    const signIn = await submit(
      transaction,
      validClaims(transaction.json().nonce),
    );
    const cookie = responseCookie(signIn);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/session/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("browser_session=;");
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");

    const stolenSession = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/google/link",
      headers: { cookie },
    });
    expect(stolenSession.statusCode).toBe(401);
    expect(stolenSession.json()).toEqual({
      error: {
        code: "BROWSER_SESSION_REQUIRED",
        message: "An authenticated browser session is required.",
      },
    });
  });
});
