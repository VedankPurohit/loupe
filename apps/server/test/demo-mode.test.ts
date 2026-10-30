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

async function bootstrap(app: Awaited<ReturnType<typeof buildApp>>, code: string) {
  const redemption = await app.inject({
    method: "POST",
    url: "/api/v1/bootstrap/redeem",
    payload: {
      code,
      organization: { name: "OpenAI" },
      administrator: { displayName: "Demo Administrator" },
    },
  });
  expect(redemption.statusCode).toBe(201);
}

describe.sequential("developer demo mode auto-login", () => {
  const testDatabase = createTestDatabase("demo_mode");
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

  it("does not register the demo-login route when demo mode is off", async () => {
    const app = await buildApp({ databaseUrl: testDatabase.databaseUrl, demoMode: false });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/v1/dev/demo-login" });
    expect(response.statusCode).toBe(404);
  });

  it("does not register the demo-login route in production even when requested", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = await buildApp({ databaseUrl: testDatabase.databaseUrl, demoMode: true });
      apps.push(app);
      const response = await app.inject({ method: "GET", url: "/api/v1/dev/demo-login" });
      expect(response.statusCode).toBe(404);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("redirects to the web application when no organization has been bootstrapped", async () => {
    const app = await buildApp({ databaseUrl: testDatabase.databaseUrl, demoMode: true });
    apps.push(app);
    const login = await app.inject({ method: "GET", url: "/api/v1/dev/demo-login" });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toBe("http://127.0.0.1:5173/");
    expect(login.headers["set-cookie"]).toBeUndefined();
  });

  it("mints an administrator session that authenticates the browser", async () => {
    // A dedicated fresh database so the Bootstrap code is generated (and
    // captured) by this test rather than an earlier buildApp on a shared store.
    const mintDatabase = createTestDatabase("demo_mode_mint");
    await mintDatabase.create();
    await migrateDatabase(mintDatabase.databaseUrl);
    try {
      let bootstrapCode: string | undefined;
      const app = await buildApp({
        databaseUrl: mintDatabase.databaseUrl,
        demoMode: true,
        onBootstrapCode: (code) => {
          bootstrapCode = code;
        },
      });
      apps.push(app);
      await bootstrap(app, bootstrapCode!);

      const login = await app.inject({ method: "GET", url: "/api/v1/dev/demo-login" });
      expect(login.statusCode).toBe(302);
      expect(login.headers.location).toBe("http://127.0.0.1:5173/");
      const cookie = browserCookie(login);
      expect(cookie.startsWith("browser_session=")).toBe(true);

      const session = await app.inject({
        method: "GET",
        url: "/api/v1/session",
        headers: { cookie },
      });
      expect(session.statusCode).toBe(200);
      const body = session.json();
      expect(body.organization?.name).toBe("OpenAI");
      expect(body.member?.role).toBe("administrator");
    } finally {
      await Promise.all(apps.splice(0).map((app) => app.close()));
      await mintDatabase.drop();
    }
  });
});
