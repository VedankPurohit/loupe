import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";
import { openCaptureQueue } from "@workspace/relay";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("redacted capture persistence through public seams", () => {
  const testDatabase = createTestDatabase("redaction_persistence");
  const sqlitePath = join(tmpdir(), `capture-${randomUUID()}.sqlite`);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let browserCookie: string;
  let deviceCredential: string;

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
        organization: { name: "Security Engineering" },
        administrator: { displayName: "Grace Hopper" },
      },
    });
    const setCookie = bootstrap.headers["set-cookie"];
    browserCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(
      ";",
      1,
    )[0]!;
    const grantResponse = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollment-grants",
      headers: { cookie: browserCookie },
      payload: { deviceName: "Grace's MacBook" },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments/redeem",
      payload: { grant: grantResponse.json().grant },
    });
    deviceCredential = enrollment.json().credential as string;
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
    await rm(sqlitePath, { force: true });
  });

  it("preserves surrounding tool content and redaction evidence without persisting the secret", async () => {
    const policyResponse = await app.inject({
      method: "GET",
      url: "/api/v1/device/capture-policy",
      headers: { authorization: `Bearer ${deviceCredential}` },
    });
    const queue = openCaptureQueue({
      databasePath: sqlitePath,
      fingerprintKey: Buffer.from("central-independent-device-key-32"),
    });
    const secret = `ghp_${"a".repeat(36)}`;
    const captured = queue.capture(
      {
        id: randomUUID(),
        source: "tool_output",
        content: `clone succeeded; credential=${secret}; checkout remains ready`,
        sourcePath: "$.tool.response.stdout",
        capturedAt: "2026-07-17T12:30:00.000Z",
      },
      policyResponse.json(),
    );

    const delivered = await app.inject({
      method: "POST",
      url: "/api/v1/device/capture-records",
      headers: { authorization: `Bearer ${deviceCredential}` },
      payload: captured,
    });
    expect(delivered.statusCode).toBe(202);
    expect(delivered.json()).toEqual({ id: captured.id, accepted: true });

    const deviceCannotBrowse = await app.inject({
      method: "GET",
      url: `/api/v1/capture-records/${captured.id}`,
      headers: { authorization: `Bearer ${deviceCredential}` },
    });
    expect(deviceCannotBrowse.statusCode).toBe(403);

    const inspected = await app.inject({
      method: "GET",
      url: `/api/v1/capture-records/${captured.id}`,
      headers: { cookie: browserCookie },
    });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json()).toMatchObject({
      id: captured.id,
      source: "tool_output",
      content:
        "clone succeeded; credential=[REDACTED:github_personal_access_token]; checkout remains ready",
      policyVersion: 1,
      redactions: [
        {
          type: "access_token",
          fingerprint: expect.stringMatching(/^sha256-hmac:[A-Za-z0-9_-]{43}$/),
          rule: "github_personal_access_token_v1",
          sourceLocation: {
            path: "$.tool.response.stdout",
            start: 28,
            end: 68,
          },
        },
      ],
    });

    queue.close();
    const sqliteBytes = await readFile(sqlitePath);
    expect(sqliteBytes.includes(Buffer.from(secret))).toBe(false);

    const centralStore = postgres(testDatabase.databaseUrl, { max: 1 });
    const rows = await centralStore<{ content: string; redactions: unknown }[]>`
      select content, redactions from captured_records where id = ${captured.id}
    `;
    await centralStore.end();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(secret);
  });
});
