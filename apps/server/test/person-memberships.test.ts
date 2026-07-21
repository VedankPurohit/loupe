import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

function browserCookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const serialized = Array.isArray(value) ? value[0] : value;
  if (typeof serialized !== "string") throw new Error("Missing browser cookie");
  return serialized.split(";", 1)[0]!;
}

describe.sequential("Person and Organization membership through /api/v1", () => {
  const testDatabase = createTestDatabase("person_memberships");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bootstrapCode: string | undefined;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("keeps one Person while their Member and Administrator memberships stay independent", async () => {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Research Cooperative" },
        administrator: { displayName: "Initial Administrator" },
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    const administratorCookie = browserCookie(bootstrap);

    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      headers: { cookie: administratorCookie },
      payload: {},
    });
    expect(invite.statusCode).toBe(201);

    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/invites/redeem",
      payload: {
        code: invite.json().code,
        member: { displayName: "Multi Organization Person" },
      },
    });
    expect(redemption.statusCode).toBe(201);
    const personCookie = browserCookie(redemption);
    const originalBrowserSession = redemption.json();

    expect(originalBrowserSession).toMatchObject({
      person: {
        displayName: "Multi Organization Person",
        email: null,
      },
      organization: { name: "Research Cooperative" },
      member: {
        displayName: "Multi Organization Person",
        role: "member",
      },
    });

    const analysisCredential = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: personCookie },
      payload: { name: "Research Cooperative analysis" },
    });
    expect(analysisCredential.statusCode).toBe(201);
    expect(analysisCredential.json()).toMatchObject({
      analysisCredential: { memberId: originalBrowserSession.member.id },
    });

    const enrollmentGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: personCookie },
      payload: { deviceName: "Membership-bound Device" },
    });
    expect(enrollmentGrant.statusCode).toBe(201);
    const deviceEnrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: enrollmentGrant.json().grant },
    });
    expect(deviceEnrollment.statusCode).toBe(201);
    expect(deviceEnrollment.json()).toMatchObject({
      device: { memberId: originalBrowserSession.member.id },
    });

    const createdOrganization = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: personCookie },
      payload: { name: "Independent Studio" },
    });
    expect(createdOrganization.statusCode).toBe(201);
    expect(createdOrganization.json()).toMatchObject({
      person: { id: originalBrowserSession.person.id },
      organization: { name: "Independent Studio" },
      member: { role: "administrator" },
    });
    expect(createdOrganization.json().member.id).not.toBe(
      originalBrowserSession.member.id,
    );

    const memberships = await app.inject({
      method: "GET",
      url: "/api/v1/person/memberships",
      headers: { cookie: personCookie },
    });
    expect(memberships.statusCode).toBe(200);
    expect(memberships.json()).toEqual({
      person: {
        id: originalBrowserSession.person.id,
        displayName: "Multi Organization Person",
        email: null,
      },
      memberships: [
        {
          organization: originalBrowserSession.organization,
          member: originalBrowserSession.member,
        },
        {
          organization: createdOrganization.json().organization,
          member: createdOrganization.json().member,
        },
      ],
    });

    const activeInCreatedOrganization = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie: personCookie },
    });
    expect(activeInCreatedOrganization.statusCode).toBe(200);
    expect(activeInCreatedOrganization.json()).toEqual(
      createdOrganization.json(),
    );

    const switchedBack = await app.inject({
      method: "PUT",
      url: "/api/v1/session/active-membership",
      headers: { cookie: personCookie },
      payload: { membershipId: originalBrowserSession.member.id },
    });
    expect(switchedBack.statusCode).toBe(200);
    expect(switchedBack.json()).toEqual(originalBrowserSession);

    const stillScopedAnalysisCredentials = await app.inject({
      method: "GET",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: personCookie },
    });
    expect(stillScopedAnalysisCredentials.json()).toEqual({
      analysisCredentials: [analysisCredential.json().analysisCredential],
    });

    const stillScopedDevices = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: personCookie },
    });
    expect(stillScopedDevices.json()).toMatchObject({
      devices: [
        expect.objectContaining({
          id: deviceEnrollment.json().device.id,
          memberId: originalBrowserSession.member.id,
        }),
      ],
    });

    await migrateDatabase(testDatabase.databaseUrl);

    const afterRepeatMigration = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie: personCookie },
    });
    expect(afterRepeatMigration.statusCode).toBe(200);
    expect(afterRepeatMigration.json()).toEqual(originalBrowserSession);

    const membershipsAfterRepeatMigration = await app.inject({
      method: "GET",
      url: "/api/v1/person/memberships",
      headers: { cookie: personCookie },
    });
    expect(membershipsAfterRepeatMigration.statusCode).toBe(200);
    expect(membershipsAfterRepeatMigration.json()).toEqual(memberships.json());
  });
});
