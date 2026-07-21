import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adaptCodexObservation,
  createCodexSourceEvent,
} from "@workspace/agent-adapter";
import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("live execution Organization isolation", () => {
  const testDatabase = createTestDatabase("live_org_isolation");
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let firstOrganizationCookie: string;
  let secondOrganizationDeviceCredential: string;

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
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const bootstrap = await fetch(`${baseUrl}/api/v1/bootstrap/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: bootstrapCode,
        organization: { name: "First Organization" },
        administrator: { displayName: "First Administrator" },
      }),
    });
    firstOrganizationCookie = bootstrap.headers.getSetCookie()[0]!.split(";", 1)[0]!;

    const sql = postgres(testDatabase.databaseUrl, { max: 1 });
    // The multi-Organization migration already removes the legacy singleton
    // guard. Keep this compatibility fixture idempotent for databases created
    // from either schema generation point.
    await sql`alter table organizations drop constraint if exists organizations_singleton_key_check`;
    await sql`drop index if exists organizations_singleton_key_unique`;
    const secondOrganizationId = randomUUID();
    const secondPersonId = randomUUID();
    const secondMemberId = randomUUID();
    const secondDeviceId = randomUUID();
    secondOrganizationDeviceCredential = `device_${randomUUID()}`;
    const credentialDigest = createHash("sha256")
      .update(secondOrganizationDeviceCredential)
      .digest("base64url");
    await sql`
      insert into organizations (id, name)
      values (${secondOrganizationId}, 'Second Organization')
    `;
    await sql`
      insert into persons (id, display_name)
      values (${secondPersonId}, 'Second Person')
    `;
    await sql`
      insert into organization_members (id, organization_id, person_id, display_name, role)
      values (${secondMemberId}, ${secondOrganizationId}, ${secondPersonId}, 'Second Member', 'member')
    `;
    await sql`
      insert into enrolled_devices (id, organization_id, member_id, name)
      values (${secondDeviceId}, ${secondOrganizationId}, ${secondMemberId}, 'Second Device')
    `;
    await sql`
      insert into device_credentials (device_id, token_digest)
      values (${secondDeviceId}, ${credentialDigest})
    `;
    await sql.end();
  });

  afterAll(async () => {
    await app?.close();
    await testDatabase.drop();
  });

  it("does not stream another Organization's Session IDs over a real SSE socket", async () => {
    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/v1/live`, {
      headers: { cookie: firstOrganizationCookie },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const initial = await reader.read();
    expect(new TextDecoder().decode(initial.value)).toContain("retry: 1000");

    const raw = {
      source: "codex_hook" as const,
      producer: { name: "codex" as const, version: "0.144.5" },
      producerEvent: "SessionStart",
      occurredAt: "2026-07-17T12:00:00.000Z",
      capturedAt: "2026-07-17T12:00:00.100Z",
      capturePath: "hook:SessionStart",
      payload: {
        hook_event_name: "SessionStart",
        session_id: "second-organization-secret-session-id",
        source: "startup",
      },
    };
    const event = createCodexSourceEvent({
      id: randomUUID(),
      adapted: adaptCodexObservation(raw),
      redaction: { policyVersion: 1, applied: false, evidence: [] },
    });
    const delivery = await fetch(`${baseUrl}/api/v1/device/source-event-batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondOrganizationDeviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
    });
    expect(delivery.status).toBe(200);

    const next = await Promise.race([
      reader.read().then((result) => ({ kind: "event" as const, result })),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), 300),
      ),
    ]);
    expect(next).toEqual({ kind: "timeout" });
    controller.abort();
  });
});
