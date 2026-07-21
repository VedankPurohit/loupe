import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("browser-authorized Device enrollment", () => {
  const testDatabase = createTestDatabase("device_enrollment_browser_authorization");
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
        organization: { name: "Browser Auth Org" },
        administrator: { displayName: "Installer Operator" },
      },
    });
    const setCookie = bootstrap.headers["set-cookie"];
    browserCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0]!;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("requires browser confirmation before issuing a state-bound, single-use grant", async () => {
    const callback = "http://127.0.0.1:43191/callback";
    const authorizationUrl = `/api/v1/device-enrollment/authorize?deviceName=Operator%20Mac&callback=${encodeURIComponent(callback)}&state=${"s".repeat(24)}`;
    const preview = await app.inject({
      method: "GET",
      url: authorizationUrl,
      headers: { cookie: browserCookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.body).toContain("Authorize Enrolled device");
    expect(preview.body).not.toContain('name="grant"');

    const response = await app.inject({
      method: "POST",
      url: authorizationUrl,
      headers: {
        cookie: browserCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain(`action="${callback}"`);
    expect(response.body).toContain(`name="state" value="${"s".repeat(24)}"`);
    const grant = /name="grant" value="([^"]+)"/.exec(response.body)?.[1];
    expect(grant).toMatch(/^enroll_/);

    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant },
    });
    expect(redemption.statusCode).toBe(201);
    expect(redemption.json()).toMatchObject({ device: { name: "Operator Mac" } });
    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant },
    });
    expect(reused.statusCode).toBe(401);
  });

  it("requires browser confirmation before disconnecting and preserves server history", async () => {
    const grantResponse = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Disconnect Mac" },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: grantResponse.json().grant },
    });
    const deviceId = enrollment.json().device.id as string;
    const callback = "http://127.0.0.1:43192/callback";
    const authorizationUrl = `/api/v1/device-disconnect/authorize?deviceId=${deviceId}&callback=${encodeURIComponent(callback)}&state=${"d".repeat(24)}`;

    const preview = await app.inject({
      method: "GET",
      url: authorizationUrl,
      headers: { cookie: browserCookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain("Disconnect Enrolled device");
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: browserCookie },
    });
    expect(before.json().devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: deviceId, health: "healthy" })]),
    );

    const confirmed = await app.inject({
      method: "POST",
      url: authorizationUrl,
      headers: {
        cookie: browserCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "",
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.body).toContain(`action="${callback}"`);
    expect(confirmed.body).toContain('name="status" value="revoked"');
    const retryAfterLostCallback = await app.inject({
      method: "POST",
      url: authorizationUrl,
      headers: {
        cookie: browserCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "",
    });
    expect(retryAfterLostCallback.statusCode).toBe(200);
    expect(retryAfterLostCallback.body).toContain('name="status" value="revoked"');
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: browserCookie },
    });
    expect(after.json().devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: deviceId, health: "revoked" })]),
    );
  });

  it("lets a newly enrolled Device revoke itself during installer rollback", async () => {
    const grantResponse = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Rollback Mac" },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: grantResponse.json().grant },
    });
    const credential = enrollment.json().credential as string;
    const deviceId = enrollment.json().device.id as string;

    const revoked = await app.inject({
      method: "POST",
      url: "/api/v1/device-connection/revoke",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(revoked.statusCode).toBe(204);
    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/device-connection/revoke",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(reused.statusCode).toBe(401);
    const devices = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: browserCookie },
    });
    expect(devices.json().devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: deviceId, health: "revoked" })]),
    );
  });

  it("rejects unauthenticated and non-loopback callbacks before issuing a grant", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/v1/device-enrollment/authorize?deviceName=Operator%20Mac&callback=http%3A%2F%2F127.0.0.1%3A43191%2Fcallback&state=${"s".repeat(24)}`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    const remote = await app.inject({
      method: "GET",
      url: `/api/v1/device-enrollment/authorize?deviceName=Operator%20Mac&callback=http%3A%2F%2Fexample.test%3A43191%2Fcallback&state=${"s".repeat(24)}`,
      headers: { cookie: browserCookie },
    });
    expect(remote.statusCode).toBe(400);
    expect(remote.json().error.code).toBe("ENROLLMENT_CALLBACK_INVALID");
  });
});
