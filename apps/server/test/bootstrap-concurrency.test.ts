import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("concurrent Bootstrap redemption through /api/v1", () => {
  const testDatabase = createTestDatabase("bootstrap_concurrency");
  const bootstrapCode =
    "bootstrap_concurrent_0123456789abcdefghijklmnopqrstuvwxyz";
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
    app = await buildApp({
      bootstrapCode,
      databaseUrl: testDatabase.databaseUrl,
    });
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("returns one success and one stable already-redeemed conflict", async () => {
    const request = {
      method: "POST" as const,
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Acme Engineering" },
        administrator: { displayName: "Ada Lovelace" },
      },
    };

    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);

    const conflict = responses.find(({ statusCode }) => statusCode === 409);
    expect(conflict?.json()).toEqual({
      error: {
        code: "BOOTSTRAP_CODE_ALREADY_REDEEMED",
        message: "Bootstrap has already been completed.",
      },
    });
  });
});
