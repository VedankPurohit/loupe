import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import type { GoogleIdTokenVerifier } from "../src/google-id-token-verifier.js";
import { createTestDatabase } from "./test-database.js";

const allowedOrigin = "http://localhost:5173";

function browserCookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  if (typeof serialized !== "string") throw new Error("Missing browser cookie");
  return serialized.split(";", 1)[0]!;
}

describe.sequential("Organization membership selection through /api/v1", () => {
  const testDatabase = createTestDatabase("organization_switching");
  let app: Awaited<ReturnType<typeof buildApp>>;

  async function signIn(subject: string, displayName: string) {
    const transaction = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google/transactions",
      headers: { origin: allowedOrigin },
    });
    expect(transaction.statusCode).toBe(201);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google/session",
      headers: { origin: allowedOrigin },
      payload: {
        transaction: transaction.json().transaction,
        nonce: transaction.json().nonce,
        csrfToken: transaction.json().csrfToken,
        credential: JSON.stringify({ subject, displayName }),
      },
    });
    expect(response.statusCode).toBe(201);
    return { cookie: browserCookie(response), response };
  }

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    const verifier: GoogleIdTokenVerifier = {
      async verifyCredential(credential, nonce) {
        const parsed = JSON.parse(credential) as {
          subject: string;
          displayName: string;
        };
        return {
          subject: parsed.subject,
          email: `${parsed.subject}@example.test`,
          displayName: parsed.displayName,
          avatarUrl: null,
          nonce,
        };
      },
    };
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      googleAuth: {
        clientId: "ticket-10.apps.googleusercontent.com",
        allowedOrigins: [allowedOrigin],
        randomSecret: () => randomUUID().replaceAll("-", ""),
        verifier,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("creates a first Organization atomically and activates its Administrator membership", async () => {
    const authenticated = await signIn("new-person", "New Person");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: authenticated.cookie },
      payload: { name: "First Organization" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      person: { id: authenticated.response.json().person.id },
      organization: { name: "First Organization" },
      member: { displayName: "New Person", role: "administrator" },
    });

    const activeSession = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie: authenticated.cookie },
    });
    expect(activeSession.statusCode).toBe(200);
    expect(activeSession.json()).toEqual(created.json());
  });

  it("keeps Google authentication separate from admission and lists an empty membership state", async () => {
    const authenticated = await signIn("unadmitted-person", "Unadmitted Person");

    const memberships = await app.inject({
      method: "GET",
      url: "/api/v1/person/memberships",
      headers: { cookie: authenticated.cookie },
    });

    expect(memberships.statusCode).toBe(200);
    expect(memberships.json()).toEqual({
      person: authenticated.response.json().person,
      memberships: [],
    });
    const session = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie: authenticated.cookie },
    });
    expect(session.json()).toMatchObject({ organization: null, member: null });
  });

  it("documents Invite redemption as browser-session secured when Google authentication is configured", async () => {
    const description = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
    });

    expect(description.statusCode).toBe(200);
    expect(description.json()).toMatchObject({
      paths: {
        "/api/v1/invites/redeem": {
          post: {
            security: [{ browserSession: [] }],
            responses: { "201": {}, "400": {}, "401": {}, "503": {} },
          },
        },
      },
    });
  });

  it("redeems an Organization-scoped ordinary-Member invite once and exposes revocation", async () => {
    const administrator = await signIn("inviting-admin", "Inviting Administrator");
    const organization = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: administrator.cookie },
      payload: { name: "Invite Organization" },
    });
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administrator.cookie },
      payload: {},
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json()).toMatchObject({
      id: expect.any(String),
      role: "member",
    });

    const invited = await signIn("invited-person", "Invited Person");
    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      headers: { cookie: invited.cookie },
      payload: {
        code: invite.json().code,
        member: { displayName: "Client cannot replace identity" },
      },
    });
    expect(redemption.statusCode).toBe(201);
    expect(redemption.json()).toMatchObject({
      person: { id: invited.response.json().person.id },
      organization: { id: organization.json().organization.id },
      member: { displayName: "Invited Person", role: "member" },
    });

    const replayingPerson = await signIn("replaying-person", "Replaying Person");
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      headers: { cookie: replayingPerson.cookie },
      payload: { code: invite.json().code },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("INVITE_CODE_INVALID");

    const revokedInvite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administrator.cookie },
      payload: {},
    });
    const revocation = await app.inject({
      method: "POST",
      url: `/api/v1/invites/${revokedInvite.json().id}/revoke`,
      headers: { cookie: administrator.cookie },
    });
    expect(revocation.statusCode).toBe(204);
    const revokedRedemption = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      headers: { cookie: replayingPerson.cookie },
      payload: { code: revokedInvite.json().code },
    });
    expect(revokedRedemption.statusCode).toBe(401);
    expect(revokedRedemption.json().error.code).toBe("INVITE_CODE_INVALID");

    const configuredDeploymentInvite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administrator.cookie },
      payload: {},
    });
    const invalidCookie = "browser_session=attacker-chosen-token";
    const unauthenticatedRedemption = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      headers: { cookie: invalidCookie },
      payload: {
        code: configuredDeploymentInvite.json().code,
        member: { displayName: "Legacy Local Person" },
      },
    });
    expect(unauthenticatedRedemption.statusCode).toBe(401);
    expect(unauthenticatedRedemption.json().error.code).toBe(
      "BROWSER_SESSION_REQUIRED",
    );
  });

  it("switches only to a server-proven own membership and keeps roles independent", async () => {
    const administrator = await signIn("switch-admin", "Switch Administrator");
    await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: administrator.cookie },
      payload: { name: "Shared Organization" },
    });
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administrator.cookie },
      payload: {},
    });
    const person = await signIn("switching-person", "Switching Person");
    const joined = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      headers: { cookie: person.cookie },
      payload: { code: invite.json().code },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: person.cookie },
      payload: { name: "Personal Organization" },
    });
    expect(created.json().member.role).toBe("administrator");

    const memberships = await app.inject({
      method: "GET",
      url: "/api/v1/person/memberships",
      headers: { cookie: person.cookie },
    });
    expect(memberships.json().memberships).toEqual([
      {
        organization: joined.json().organization,
        member: joined.json().member,
      },
      {
        organization: created.json().organization,
        member: created.json().member,
      },
    ]);

    const switched = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: person.cookie },
      payload: { membershipId: joined.json().member.id },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toEqual(joined.json());

    const arbitrarySelection = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: person.cookie },
      payload: { membershipId: administrator.response.json().person.id },
    });
    expect(arbitrarySelection.statusCode).toBe(404);
    expect(arbitrarySelection.json().error.code).toBe("MEMBERSHIP_NOT_FOUND");

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/session/logout",
      headers: { cookie: person.cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect((await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: person.cookie },
      payload: { membershipId: created.json().member.id },
    })).statusCode).toBe(401);
  });
});
