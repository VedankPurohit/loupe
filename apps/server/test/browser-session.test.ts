import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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

describe.sequential("browser session revocation through /api/v1", () => {
  const testDatabase = createTestDatabase("browser_session_revocation");
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  beforeAll(async () => {
    await testDatabase.create();
    await migrateDatabase(testDatabase.databaseUrl);
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  afterAll(async () => {
    await testDatabase.drop();
  });

  it("logs out the current session, clears its cookie, and denies reuse of the stolen token", async () => {
    let bootstrapCode: string | undefined;
    const app = await buildApp({
      databaseUrl: testDatabase.databaseUrl,
      onBootstrapCode: (code) => {
        bootstrapCode = code;
      },
    });
    apps.push(app);
    const redemption = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      payload: {
        code: bootstrapCode,
        organization: { name: "Session Security" },
        administrator: { displayName: "Administrator" },
      },
    });
    const cookie = browserCookie(redemption);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/session/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("browser_session=;");
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");

    const stolenToken = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie },
    });
    expect(stolenToken.statusCode).toBe(401);
    expect(stolenToken.json()).toEqual({
      error: {
        code: "BROWSER_SESSION_REQUIRED",
        message: "An authenticated browser session is required.",
      },
    });
  });
});
