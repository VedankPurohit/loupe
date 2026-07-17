import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { openCaptureQueue } from "../src/index.js";

describe("relay capture queue redaction", () => {
  const databasePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(databasePaths.splice(0).map((path) => rm(path, { force: true })));
  });

  it("redacts only a high-confidence secret substring before real SQLite persistence", async () => {
    const databasePath = join(tmpdir(), `capture-${randomUUID()}.sqlite`);
    databasePaths.push(databasePath);
    const queue = openCaptureQueue({
      databasePath,
      fingerprintKey: Buffer.from("fixed-test-fingerprint-key-32-bytes"),
    });
    const secret = `sk-${"A".repeat(40)}`;

    const captured = queue.capture(
      {
        id: "capture-ordinary",
        source: "tool_input",
        content: `Run with token ${secret} against staging, then report status.`,
        sourcePath: "$.tool.input.command",
        capturedAt: "2026-07-17T12:00:00.000Z",
      },
      {
        version: 1,
        ordinaryRedactionEnabled: true,
        demoCanaryEnabled: false,
      },
    );

    expect(captured.content).toBe(
      "Run with token [REDACTED:openai_api_key] against staging, then report status.",
    );
    expect(captured.redactions).toEqual([
      {
        type: "api_key",
        fingerprint: "sha256-hmac:KfNlaW7XdvB3WC0djemv-9Uo7TPJm_oclDtZryZX1yg",
        rule: "openai_api_key_v1",
        sourceLocation: {
          path: "$.tool.input.command",
          start: 15,
          end: 58,
        },
      },
    ]);
    expect(queue.pending()).toEqual([captured]);
    queue.close();

    const sqliteBytes = await readFile(databasePath);
    expect(sqliteBytes.includes(Buffer.from(secret))).toBe(false);
    expect(sqliteBytes.includes(Buffer.from("against staging"))).toBe(true);
  });

  it("keeps ordinary redaction and the exact-prefix Demo canary independently controlled", () => {
    const databasePath = join(tmpdir(), `capture-${randomUUID()}.sqlite`);
    databasePaths.push(databasePath);
    const queue = openCaptureQueue({
      databasePath,
      fingerprintKey: Buffer.from("fixed-test-fingerprint-key-32-bytes"),
    });
    const ordinarySecret = `sk-${"B".repeat(40)}`;
    const canary = "demo_redaction_canary_0123456789ABCDEF";

    const explicitlyUnsafe = queue.capture(
      {
        id: "capture-disabled-ordinary",
        source: "prompt",
        content: `explicitly retained ${ordinarySecret}`,
        sourcePath: "$.prompt",
        capturedAt: "2026-07-17T12:01:00.000Z",
      },
      {
        version: 2,
        ordinaryRedactionEnabled: false,
        demoCanaryEnabled: false,
      },
    );
    expect(explicitlyUnsafe.content).toContain(ordinarySecret);
    expect(explicitlyUnsafe.redactions).toEqual([]);

    const disabledCanary = queue.capture(
      {
        id: "capture-disabled-canary",
        source: "prompt",
        content: `show ${canary} unchanged`,
        sourcePath: "$.prompt",
        capturedAt: "2026-07-17T12:02:00.000Z",
      },
      {
        version: 1,
        ordinaryRedactionEnabled: true,
        demoCanaryEnabled: false,
      },
    );
    expect(disabledCanary.content).toBe(`show ${canary} unchanged`);

    const enabledCanary = queue.capture(
      {
        id: "capture-enabled-canary",
        source: "tool_output",
        content: `near Demo_redaction_canary_0123456789ABCDEF; exact ${canary}; short demo_redaction_canary_short`,
        sourcePath: "$.tool.response",
        capturedAt: "2026-07-17T12:03:00.000Z",
      },
      {
        version: 3,
        ordinaryRedactionEnabled: true,
        demoCanaryEnabled: true,
      },
    );
    expect(enabledCanary.content).toBe(
      "near Demo_redaction_canary_0123456789ABCDEF; exact [REDACTED:demo_canary]; short demo_redaction_canary_short",
    );
    expect(enabledCanary.redactions).toMatchObject([
      { type: "demo_canary", rule: "demo_redaction_canary_v1" },
    ]);
    queue.close();
  });
});
