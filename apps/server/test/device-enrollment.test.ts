import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("Device enrollment through /api/v1", () => {
  const testDatabase = createTestDatabase("device_enrollment");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let browserCookie: string;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);

    let bootstrapCode: string | undefined;
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Acme Engineering" },
        administrator: { displayName: "Ada Lovelace" },
      },
    });
    const setCookie = bootstrap.headers["set-cookie"];
    browserCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(
      ";",
      1,
    )[0]!;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("exchanges one short-lived grant for a scoped, single-use Device credential", async () => {
    const grantResponse = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Ada's MacBook Pro" },
    });
    expect(grantResponse.statusCode).toBe(201);
    expect(grantResponse.json()).toMatchObject({
      grant: expect.stringMatching(/^enroll_[A-Za-z0-9_-]{32,}$/),
      expiresAt: expect.any(String),
    });

    const { grant } = grantResponse.json() as { grant: string };
    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant },
    });
    expect(redemption.statusCode).toBe(201);
    expect(redemption.json()).toMatchObject({
      credential: expect.stringMatching(/^device_[A-Za-z0-9_-]{32,}$/),
      device: {
        name: "Ada's MacBook Pro",
        capturePolicy: {
          version: 1,
          ordinaryRedactionEnabled: true,
          demoCanaryEnabled: false,
        },
      },
    });

    const reusedGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant },
    });
    expect(reusedGrant.statusCode).toBe(401);
    expect(reusedGrant.json()).toEqual({
      error: {
        code: "DEVICE_ENROLLMENT_GRANT_INVALID",
        message: "The device-enrollment grant is invalid, expired, revoked, or already used.",
      },
    });

    const { credential } = redemption.json() as { credential: string };
    const ownPolicy = await app.inject({
      method: "GET",
      url: "/api/v1/device/capture-policy",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(ownPolicy.statusCode).toBe(200);
    expect(ownPolicy.json()).toEqual({
      version: 1,
      ordinaryRedactionEnabled: true,
      demoCanaryEnabled: false,
    });

    const ownHealth = await app.inject({
      method: "GET",
      url: "/api/v1/device/health",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(ownHealth.statusCode).toBe(200);
    expect(ownHealth.json()).toMatchObject({
      deviceId: expect.any(String),
      status: "healthy",
      lastSeenAt: expect.any(String),
      policyVersion: 1,
    });

    for (const restricted of [
      { method: "GET", url: "/api/v1/sessions" },
      { method: "POST", url: "/api/v1/candidates", payload: {} },
      { method: "POST", url: "/api/v1/administration/actions", payload: {} },
    ] as const) {
      const response = await app.inject({
        ...restricted,
        headers: { authorization: `Bearer ${credential}` },
      });
      expect(response.statusCode, restricted.url).toBe(403);
      expect(response.json()).toEqual({
        error: {
          code: "DEVICE_CREDENTIAL_SCOPE_FORBIDDEN",
          message: "A Device credential cannot access this Organization capability.",
        },
      });
    }
  });

  it("lets the member inspect health, version policy changes, and revoke only the Device credential", async () => {
    const unauthenticatedGrant = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      payload: { deviceName: "Unknown Mac" },
    });
    expect(unauthenticatedGrant.statusCode).toBe(401);

    const grantResponse = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Ada's Mac Studio" },
    });
    const { grant } = grantResponse.json() as { grant: string };
    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant },
    });
    const { credential, device } = redemption.json() as {
      credential: string;
      device: { id: string };
    };

    await app.inject({
      method: "GET",
      url: "/api/v1/device/capture-policy",
      headers: { authorization: `Bearer ${credential}` },
    });
    const devices = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: browserCookie },
    });
    expect(devices.statusCode).toBe(200);
    expect(devices.json()).toMatchObject({
      devices: expect.arrayContaining([
        expect.objectContaining({
          id: device.id,
          name: "Ada's Mac Studio",
          health: "healthy",
          lastSeenAt: expect.any(String),
          capturePolicy: {
            version: 1,
            ordinaryRedactionEnabled: true,
            demoCanaryEnabled: false,
          },
        }),
      ]),
    });

    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${device.id}/capture-policy`,
      headers: { cookie: browserCookie },
      payload: {
        ordinaryRedactionEnabled: false,
        demoCanaryEnabled: true,
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({
      version: 2,
      ordinaryRedactionEnabled: false,
      demoCanaryEnabled: true,
    });

    const effective = await app.inject({
      method: "GET",
      url: "/api/v1/device/capture-policy",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(effective.json()).toEqual(changed.json());

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${device.id}/revoke`,
      headers: { cookie: browserCookie },
    });
    expect(revoked.statusCode).toBe(204);

    const afterRevocation = await app.inject({
      method: "GET",
      url: "/api/v1/device/capture-policy",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(afterRevocation.statusCode).toBe(401);

    const devicesAfterRevocation = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: browserCookie },
    });
    expect(devicesAfterRevocation.json()).toMatchObject({
      devices: expect.arrayContaining([
        expect.objectContaining({
          id: device.id,
          health: "revoked",
          capturePolicy: expect.objectContaining({ version: 2 }),
        }),
      ]),
    });
  });
});
