import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("Organization bootstrap through /api/v1", () => {
  const testDatabase = createTestDatabase("bootstrap_journey");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bootstrapCode: string | undefined;
  let codeExposedAfterRestart: string | undefined;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    await app.close();
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        codeExposedAfterRestart = code;
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("redeems the server Bootstrap code into one Administrator browser session", async () => {
    expect(bootstrapCode).toMatch(/^bootstrap_[A-Za-z0-9_-]{32,}$/);
    expect(codeExposedAfterRestart).toBeUndefined();

    const initialStatus = await app.inject({
      method: "GET",
      url: "/api/v1/bootstrap/status",
    });
    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json()).toEqual({ required: true });

    const invalidCode = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: "bootstrap_not_the_server_issued_secret",
        organization: { name: "Acme Engineering" },
        administrator: { displayName: "Ada Lovelace" },
      },
    });
    expect(invalidCode.statusCode).toBe(401);
    expect(invalidCode.json()).toEqual({
      error: {
        code: "BOOTSTRAP_CODE_INVALID",
        message: "The Bootstrap code is invalid, expired, or revoked.",
      },
    });

    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Acme Engineering" },
        administrator: { displayName: "Ada Lovelace" },
      },
    });

    expect(redemption.statusCode).toBe(201);
    expect(redemption.json()).toMatchObject({
      organization: { name: "Acme Engineering" },
      member: { displayName: "Ada Lovelace", role: "administrator" },
    });
    expect(redemption.headers["set-cookie"]).toContain(
      "browser_session=",
    );
    expect(redemption.headers["set-cookie"]).toContain("HttpOnly");

    const setCookie = redemption.headers["set-cookie"];
    const browserCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: {
        cookie: browserCookie!.split(";", 1)[0]!,
      },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      organization: { name: "Acme Engineering" },
      member: { displayName: "Ada Lovelace", role: "administrator" },
    });

    const completedStatus = await app.inject({
      method: "GET",
      url: "/api/v1/bootstrap/status",
    });
    expect(completedStatus.json()).toEqual({ required: false });

    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Second Organization" },
        administrator: { displayName: "Second Administrator" },
      },
    });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json()).toEqual({
      error: {
        code: "BOOTSTRAP_CODE_ALREADY_REDEEMED",
        message: "Bootstrap has already been completed.",
      },
    });
  });

  it("rejects malformed redemption bodies with the documented stable error", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: { code: "" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: {
        code: "REQUEST_VALIDATION_FAILED",
        message: "The request did not match the API contract.",
      },
    });
  });
});
