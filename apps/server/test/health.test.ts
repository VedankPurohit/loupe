import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe("GET /api/v1", () => {
  const testDatabase = createTestDatabase("health_contract");
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

  it("reports health and publishes the generated API description", async () => {
    const app = await buildApp({ databaseUrl: testDatabase.databaseUrl });
    apps.push(app);

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", apiVersion: "v1" });

    const description = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(description.statusCode).toBe(200);
    expect(description.json()).toMatchObject({
      openapi: "3.0.3",
      info: { title: "Coding-agent observability API", version: "1.0.0" },
      paths: {
        "/api/v1/health": { get: {} },
        "/api/v1/bootstrap/redeem": {
          post: {
            requestBody: { required: true },
            responses: { "201": {}, "400": {}, "401": {}, "409": {} },
          },
        },
        "/api/v1/session": {
          get: {
            security: [{ browserSession: [] }],
          },
        },
        "/api/v1/session/logout": {
          post: {
            security: [{ browserSession: [] }],
            responses: { "204": {}, "401": {} },
          },
        },
      },
      components: {
        securitySchemes: {
          browserSession: {
            type: "apiKey",
            in: "cookie",
            name: "browser_session",
          },
        },
      },
    });
  });

  it("does not report healthy without the PostgreSQL identity store", async () => {
    const app = await buildApp();
    apps.push(app);

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.statusCode).toBe(503);
    expect(health.json()).toEqual({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database-backed identity is unavailable.",
      },
    });
  });

  it("uses stable API errors for malformed JSON and unknown v1 routes", async () => {
    const app = await buildApp({ databaseUrl: testDatabase.databaseUrl });
    apps.push(app);

    const malformed = await app.inject({
      method: "POST",
      url: "/api/v1/bootstrap/redeem",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({
      error: {
        code: "REQUEST_VALIDATION_FAILED",
        message: "The request did not match the API contract.",
      },
    });

    const unknown = await app.inject({
      method: "GET",
      url: "/api/v1/not-a-route",
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "The requested API route does not exist.",
      },
    });
  });
});
