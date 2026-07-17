export interface CapturePolicy {
  version: number;
  ordinaryRedactionEnabled: boolean;
  demoCanaryEnabled: boolean;
}

export interface CaptureInput {
  id: string;
  source: "prompt" | "tool_input" | "tool_output";
  content: string;
  sourcePath: string;
  capturedAt: string;
}

export interface RedactionEvidence {
  type: string;
  fingerprint: string;
  rule: string;
  sourceLocation: { path: string; start: number; end: number };
}

export interface QueuedCapture extends CaptureInput {
  policyVersion: number;
  redactions: RedactionEvidence[];
}

export interface CaptureQueue {
  capture(input: CaptureInput, policy: CapturePolicy): QueuedCapture;
  pending(): QueuedCapture[];
  close(): void;
}

interface RedactionRule {
  type: string;
  name: string;
  replacement: string;
  pattern: RegExp;
}

const ordinaryRules: RedactionRule[] = [
  {
    type: "api_key",
    name: "openai_api_key_v1",
    replacement: "[REDACTED:openai_api_key]",
    pattern: /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    type: "access_token",
    name: "github_personal_access_token_v1",
    replacement: "[REDACTED:github_personal_access_token]",
    pattern: /(?<![A-Za-z0-9_])(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{30,})(?![A-Za-z0-9_])/g,
  },
];

const demoRule: RedactionRule = {
  type: "demo_canary",
  name: "demo_redaction_canary_v1",
  replacement: "[REDACTED:demo_canary]",
  pattern: /(?<![A-Za-z0-9_])demo_redaction_canary_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
};

function redact(
  input: CaptureInput,
  policy: CapturePolicy,
  fingerprintKey: Uint8Array,
): QueuedCapture {
  const matches: Array<{
    start: number;
    end: number;
    secret: string;
    rule: RedactionRule;
  }> = [];
  const rules = [
    ...(policy.ordinaryRedactionEnabled ? ordinaryRules : []),
    ...(policy.demoCanaryEnabled ? [demoRule] : []),
  ];
  for (const rule of rules) {
    for (const match of input.content.matchAll(rule.pattern)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        secret: match[0],
        rule,
      });
    }
  }
  matches.sort((left, right) => left.start - right.start || right.end - left.end);

  let cursor = 0;
  let content = "";
  const redactions: RedactionEvidence[] = [];
  for (const match of matches) {
    if (match.start < cursor) continue;
    content += input.content.slice(cursor, match.start) + match.rule.replacement;
    cursor = match.end;
    const fingerprint = createHmac("sha256", fingerprintKey)
      .update(match.secret)
      .digest("base64url");
    redactions.push({
      type: match.rule.type,
      fingerprint: `sha256-hmac:${fingerprint}`,
      rule: match.rule.name,
      sourceLocation: {
        path: input.sourcePath,
        start: match.start,
        end: match.end,
      },
    });
  }
  content += input.content.slice(cursor);
  return { ...input, content, policyVersion: policy.version, redactions };
}

export function openCaptureQueue(options: {
  databasePath: string;
  fingerprintKey: Uint8Array;
}): CaptureQueue {
  if (options.fingerprintKey.byteLength < 32) {
    throw new Error("fingerprintKey must contain at least 32 bytes.");
  }
  const database = new DatabaseSync(options.databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS capture_queue (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      source_path TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      policy_version INTEGER NOT NULL,
      redactions_json TEXT NOT NULL
    ) STRICT
  `);
  const insert = database.prepare(`
    INSERT INTO capture_queue (
      id, source, content, source_path, captured_at, policy_version, redactions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const selectPending = database.prepare(`
    SELECT id, source, content, source_path, captured_at, policy_version, redactions_json
    FROM capture_queue ORDER BY rowid
  `);

  return {
    capture(input, policy) {
      const captured = redact(input, policy, options.fingerprintKey);
      insert.run(
        captured.id,
        captured.source,
        captured.content,
        captured.sourcePath,
        captured.capturedAt,
        captured.policyVersion,
        JSON.stringify(captured.redactions),
      );
      return captured;
    },
    pending() {
      return (selectPending.all() as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        source: row.source as CaptureInput["source"],
        content: row.content as string,
        sourcePath: row.source_path as string,
        capturedAt: row.captured_at as string,
        policyVersion: row.policy_version as number,
        redactions: JSON.parse(row.redactions_json as string) as RedactionEvidence[],
      }));
    },
    close() {
      database.close();
    },
  };
}
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
