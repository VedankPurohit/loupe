import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("expired Bootstrap-code recovery through /api/v1", () => {
  const testDatabase = createTestDatabase("agent_observer_bootstrap_recovery");
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.useRealTimers();
  });

  afterAll(async () => {
    await testDatabase.drop();
  });

  it("issues a replacement after an unredeemed code expires", async () => {
    const issuedAt = new Date("2026-07-17T00:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now: issuedAt });

    let expiredCode: string | undefined;
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        expiredCode = code;
      },
    });
    await app.close();
    app = undefined;

    vi.setSystemTime(new Date("2026-07-18T00:00:01.000Z"));

    let replacementCode: string | undefined;
    app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        replacementCode = code;
      },
    });

    expect(expiredCode).toMatch(/^bootstrap_[A-Za-z0-9_-]{43}$/);
    expect(replacementCode).toMatch(/^bootstrap_[A-Za-z0-9_-]{43}$/);
    expect(replacementCode).not.toBe(expiredCode);

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/bootstrap/status",
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ required: true });

    const expiredRedemption = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: expiredCode,
        organization: { name: "Acme Engineering" },
        administrator: { displayName: "Ada Lovelace" },
      },
    });
    expect(expiredRedemption.statusCode).toBe(401);
    expect(expiredRedemption.json()).toMatchObject({
      error: { code: "BOOTSTRAP_CODE_INVALID" },
    });

    const replacementRedemption = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: replacementCode,
        organization: { name: "Acme Engineering" },
        administrator: { displayName: "Ada Lovelace" },
      },
    });
    expect(replacementRedemption.statusCode).toBe(201);
  });
});
