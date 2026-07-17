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

  it("redacts AWS, Slack, Google, Stripe, GitLab, npm, and PEM secrets before persistence", async () => {
    const databasePath = join(tmpdir(), `capture-${randomUUID()}.sqlite`);
    databasePaths.push(databasePath);
    const queue = openCaptureQueue({
      databasePath,
      fingerprintKey: Buffer.from("fixed-test-fingerprint-key-32-bytes"),
    });
    const policy = { version: 1, ordinaryRedactionEnabled: true, demoCanaryEnabled: false };
    const cases: Array<{ content: string; replacement: string; rule: string }> = [
      {
        content: "Fix the failing test. My key is AKIAIOSFODNN7EXAMPLE please dont leak it",
        replacement: "[REDACTED:aws_access_key_id]",
        rule: "aws_access_key_id_v1",
      },
      {
        content: `slack says xoxb-${"1234567890".repeat(2)}-abcdef is live`,
        replacement: "[REDACTED:slack_token]",
        rule: "slack_token_v1",
      },
      {
        content: `maps key AIza${"S".repeat(35)} in env`,
        replacement: "[REDACTED:google_api_key]",
        rule: "google_api_key_v1",
      },
      {
        content: `stripe sk_live_${"a1B2".repeat(6)} charged`,
        replacement: "[REDACTED:stripe_secret_key]",
        rule: "stripe_secret_key_v1",
      },
      {
        content: `gitlab glpat-${"Zz9".repeat(8)} token`,
        replacement: "[REDACTED:gitlab_personal_access_token]",
        rule: "gitlab_personal_access_token_v1",
      },
      {
        content: `publish with npm_${"A1b2C3".repeat(6)} now`,
        replacement: "[REDACTED:npm_access_token]",
        rule: "npm_access_token_v1",
      },
      {
        content:
          "key file:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\ndone",
        replacement: "[REDACTED:pem_private_key]",
        rule: "pem_private_key_block_v1",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const captured = queue.capture(
        {
          id: `capture-rule-${index}`,
          source: "prompt",
          content: testCase.content,
          sourcePath: "$.prompt",
          capturedAt: "2026-07-17T12:05:00.000Z",
        },
        policy,
      );
      expect(captured.content, testCase.rule).toContain(testCase.replacement);
      expect(captured.redactions.map((entry) => entry.rule), testCase.rule).toContain(
        testCase.rule,
      );
    }
    queue.close();

    const sqliteBytes = await readFile(databasePath);
    expect(sqliteBytes.includes(Buffer.from("AKIAIOSFODNN7EXAMPLE"))).toBe(false);
    expect(sqliteBytes.includes(Buffer.from("BEGIN RSA PRIVATE KEY"))).toBe(false);
  });

  it("does not redact near-miss values that resemble but are not supported secrets", () => {
    const databasePath = join(tmpdir(), `capture-${randomUUID()}.sqlite`);
    databasePaths.push(databasePath);
    const queue = openCaptureQueue({
      databasePath,
      fingerprintKey: Buffer.from("fixed-test-fingerprint-key-32-bytes"),
    });
    const nearMisses =
      "AKIASHORT xoxq-1234567890123 AIzaTooShort sk_prod_abcdefghijklmnop npm_short glpat-tiny";
    const captured = queue.capture(
      {
        id: "capture-near-miss",
        source: "prompt",
        content: nearMisses,
        sourcePath: "$.prompt",
        capturedAt: "2026-07-17T12:06:00.000Z",
      },
      { version: 1, ordinaryRedactionEnabled: true, demoCanaryEnabled: false },
    );
    expect(captured.content).toBe(nearMisses);
    expect(captured.redactions).toEqual([]);
    queue.close();
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
