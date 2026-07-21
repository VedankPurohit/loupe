import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("browser-authorized Analysis credential lifecycle", () => {
  const testDatabase = createTestDatabase("analysis_credential_browser_authorization");
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
        organization: { name: "Analysis Browser Auth Org" },
        administrator: { displayName: "Analysis Operator" },
      },
    });
    const setCookie = bootstrap.headers["set-cookie"];
    browserCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!
      .split(";", 1)[0]!;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("confirms in the browser and redeems a state-bound grant exactly once", async () => {
    const callback = "http://127.0.0.1:43193/callback";
    const state = "a".repeat(24);
    const authorizationUrl = `/api/v1/analysis-credential/authorize?name=Local%20investigator&callback=${encodeURIComponent(callback)}&state=${state}`;

    const preview = await app.inject({
      method: "GET",
      url: authorizationUrl,
      headers: { cookie: browserCookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.body).toContain("Authorize Analysis credential");
    expect(preview.body).toContain("Analysis Browser Auth Org");
    expect(preview.body).not.toContain('name="grant"');

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
    expect(confirmed.body).toContain(`name="state" value="${state}"`);
    const grant = /name="grant" value="([^"]+)"/.exec(confirmed.body)?.[1];
    expect(grant).toMatch(/^analysis_grant_/);

    const redeemed = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credential-grants/redeem",
      payload: { grant },
    });
    expect(redeemed.statusCode).toBe(201);
    expect(redeemed.json()).toMatchObject({
      credential: expect.stringMatching(/^analysis_/),
      analysisCredential: {
        name: "Local investigator",
        scopes: ["organization:evidence:read", "candidate:submit"],
        revokedAt: null,
      },
    });

    const reused = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credential-grants/redeem",
      payload: { grant },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({
      error: { code: "ANALYSIS_CREDENTIAL_GRANT_INVALID" },
    });
  });

  it("reports and revokes only the calling Analysis credential", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credentials",
      headers: { cookie: browserCookie },
      payload: { name: "Lifecycle investigator" },
    });
    const credential = created.json().credential as string;

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/analysis-credential",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      organization: { name: "Analysis Browser Auth Org" },
      member: { displayName: "Analysis Operator" },
      analysisCredential: {
        name: "Lifecycle investigator",
        scopes: ["organization:evidence:read", "candidate:submit"],
      },
    });

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/administration/actions",
      headers: { authorization: `Bearer ${credential}` },
      payload: { action: "approve" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({
      error: { code: "ANALYSIS_CREDENTIAL_SCOPE_FORBIDDEN" },
    });

    const revoked = await app.inject({
      method: "POST",
      url: "/api/v1/analysis-credential/revoke",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(revoked.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/analysis-credential",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({
      error: { code: "ANALYSIS_CREDENTIAL_REQUIRED" },
    });
  });

  it("rejects unauthenticated and non-loopback authorization callbacks", async () => {
    const state = "b".repeat(24);
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/v1/analysis-credential/authorize?name=Local%20investigator&callback=http%3A%2F%2F127.0.0.1%3A43193%2Fcallback&state=${state}`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    const remote = await app.inject({
      method: "GET",
      url: `/api/v1/analysis-credential/authorize?name=Local%20investigator&callback=http%3A%2F%2Fexample.test%3A43193%2Fcallback&state=${state}`,
      headers: { cookie: browserCookie },
    });
    expect(remote.statusCode).toBe(400);
    expect(remote.json()).toMatchObject({
      error: { code: "ANALYSIS_CALLBACK_INVALID" },
    });
  });
});
