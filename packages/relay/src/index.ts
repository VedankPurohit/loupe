import { execFile as execFileCallback } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import {
  SourceEventBatchResponseSchema,
  type GitContextObservation,
  type SourceEvent,
} from "@workspace/contracts";

const execFile = promisify(execFileCallback);

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorCode?: string;
}

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<GitCommandResult>;

async function runGitCommand(
  args: readonly string[],
  cwd: string,
): Promise<GitCommandResult> {
  try {
    const result = await execFile("git", [...args], { cwd, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      code?: string | number;
      stdout?: string;
      stderr?: string;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: typeof failure.code === "number" ? failure.code : null,
      errorCode: typeof failure.code === "string" ? failure.code : undefined,
    };
  }
}

function sanitizeRemoteIdentity(remote: string): string | null {
  const candidate = remote.trim();
  if (!candidate) return null;
  if (candidate.includes("://")) {
    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname) return null;
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return null;
    }
  }
  const scpStyle = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(candidate);
  if (scpStyle) {
    const path = scpStyle[2]!.split(/[?#]/, 1)[0];
    return path ? `${scpStyle[1]}:${path}` : null;
  }
  if (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../")
  ) {
    return candidate;
  }
  return null;
}

function unavailableGitContext(
  status: Exclude<GitContextObservation["status"], "available">,
  reason: NonNullable<GitContextObservation["reason"]>,
  cwd: string,
  sampledAt: string,
): GitContextObservation {
  return {
    status,
    repositoryRoot: null,
    remoteIdentity: null,
    branch: null,
    detached: null,
    worktree: null,
    commit: null,
    sampledAt,
    provenance: {
      source: "relay_local_git",
      evidence: "local_observation",
      stability: "observed",
      derivation: "exact",
      cwd,
    },
    reason,
  };
}

/**
 * Samples Git at one point in time. This is relay-local evidence, not proof of
 * repository state when an earlier source event originally occurred.
 */
export async function inspectGitContext(options: {
  cwd: string;
  sampledAt?: Date;
  runGit?: GitCommandRunner;
}): Promise<GitContextObservation> {
  const sampledAt = (options.sampledAt ?? new Date()).toISOString();
  const run = options.runGit ?? runGitCommand;
  const root = await run(["rev-parse", "--show-toplevel"], options.cwd);
  if (root.errorCode === "ENOENT") {
    return unavailableGitContext(
      "unavailable",
      "git_command_unavailable",
      options.cwd,
      sampledAt,
    );
  }
  if (root.exitCode !== 0) {
    const isNotRepository = /not a git repository/i.test(root.stderr);
    return unavailableGitContext(
      isNotRepository ? "not_repository" : "inspection_failed",
      isNotRepository
        ? "cwd_is_not_a_git_repository"
        : "git_inspection_failed",
      options.cwd,
      sampledAt,
    );
  }
  const repositoryRoot = root.stdout.trim();
  if (!repositoryRoot) {
    return unavailableGitContext(
      "inspection_failed",
      "git_inspection_failed",
      options.cwd,
      sampledAt,
    );
  }

  const [commitResult, branchResult, remoteResult] = await Promise.all([
    run(["rev-parse", "HEAD"], options.cwd),
    run(["symbolic-ref", "--quiet", "--short", "HEAD"], options.cwd),
    run(["config", "--get", "remote.origin.url"], options.cwd),
  ]);
  const branchIsDetached = branchResult.exitCode === 1;
  const remoteIsAbsent = remoteResult.exitCode === 1;
  if (
    commitResult.exitCode !== 0 ||
    (branchResult.exitCode !== 0 && !branchIsDetached) ||
    (remoteResult.exitCode !== 0 && !remoteIsAbsent)
  ) {
    return unavailableGitContext(
      commitResult.errorCode === "ENOENT" ||
        branchResult.errorCode === "ENOENT" ||
        remoteResult.errorCode === "ENOENT"
        ? "unavailable"
        : "inspection_failed",
      commitResult.errorCode === "ENOENT" ||
        branchResult.errorCode === "ENOENT" ||
        remoteResult.errorCode === "ENOENT"
        ? "git_command_unavailable"
        : "git_inspection_failed",
      options.cwd,
      sampledAt,
    );
  }
  const commit = commitResult.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    return unavailableGitContext(
      "inspection_failed",
      "git_inspection_failed",
      options.cwd,
      sampledAt,
    );
  }

  return {
    status: "available",
    repositoryRoot,
    remoteIdentity: remoteIsAbsent
      ? null
      : sanitizeRemoteIdentity(remoteResult.stdout),
    branch: branchIsDetached ? null : branchResult.stdout.trim() || null,
    detached: branchIsDetached,
    worktree: repositoryRoot,
    commit,
    sampledAt,
    provenance: {
      source: "relay_local_git",
      evidence: "local_observation",
      stability: "observed",
      derivation: "exact",
      cwd: options.cwd,
    },
    reason: null,
  };
}

export async function enrichSourceEventWithGitContext(
  event: SourceEvent,
  options: {
    cwd: string;
    sampledAt?: Date;
    runGit?: GitCommandRunner;
  },
): Promise<SourceEvent> {
  return { ...event, gitContext: await inspectGitContext(options) };
}

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

export interface DeliveryQueueItem {
  event: SourceEvent;
  state: "pending" | "poisoned";
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}

export interface DeliveryAttempt {
  sent: number;
  acknowledged: number;
  retrying: number;
  poisoned: number;
}

export interface DeliveryQueue {
  record(event: SourceEvent): { eventId: string; status: "pending" | "duplicate" };
  pending(): DeliveryQueueItem[];
  deliverOnce(options: {
    baseUrl: string;
    deviceCredential: string;
    batchSize?: number;
    now?: Date;
    fetch?: typeof globalThis.fetch;
  }): Promise<DeliveryAttempt>;
  close(): void;
}

interface DeliveryRow {
  id: string;
  event_json: string;
  state: "pending" | "poisoned";
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
}

function toDeliveryItem(row: DeliveryRow): DeliveryQueueItem {
  return {
    event: JSON.parse(row.event_json) as SourceEvent,
    state: row.state,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}

/**
 * Opens the relay's durable local queue. Recording is synchronous; network
 * access begins only when the caller separately invokes `deliverOnce`.
 */
export function openDeliveryQueue(options: { databasePath: string }): DeliveryQueue {
  const database = new DatabaseSync(options.databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS source_event_delivery_queue (
      id TEXT PRIMARY KEY,
      deduplication_key TEXT NOT NULL UNIQUE,
      event_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'poisoned')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT
    ) STRICT
  `);
  const insert = database.prepare(`
    INSERT OR IGNORE INTO source_event_delivery_queue (
      id, deduplication_key, event_json
    ) VALUES (?, ?, ?)
  `);
  const selectById = database.prepare(`
    SELECT id, event_json, state, attempts, next_attempt_at, last_error
    FROM source_event_delivery_queue WHERE id = ?
  `);
  const selectAll = database.prepare(`
    SELECT id, event_json, state, attempts, next_attempt_at, last_error
    FROM source_event_delivery_queue ORDER BY rowid
  `);
  const selectDue = database.prepare(`
    SELECT id, event_json, state, attempts, next_attempt_at, last_error
    FROM source_event_delivery_queue
    WHERE state = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY rowid LIMIT ?
  `);
  const remove = database.prepare(
    "DELETE FROM source_event_delivery_queue WHERE id = ?",
  );
  const retry = database.prepare(`
    UPDATE source_event_delivery_queue
    SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?
    WHERE id = ?
  `);
  const poison = database.prepare(`
    UPDATE source_event_delivery_queue
    SET state = 'poisoned', attempts = attempts + 1,
        next_attempt_at = NULL, last_error = ?
    WHERE id = ?
  `);

  const retryAt = (attempts: number, now: Date) =>
    new Date(
      now.getTime() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)),
    ).toISOString();

  return {
    record(event) {
      const serialized = JSON.stringify(event);
      const result = insert.run(event.id, event.deduplicationKey, serialized);
      if (result.changes === 1) return { eventId: event.id, status: "pending" };
      const existing = selectById.get(event.id) as DeliveryRow | undefined;
      if (!existing || existing.event_json !== serialized) {
        throw new Error("Delivery identity conflicts with different source evidence.");
      }
      return { eventId: event.id, status: "duplicate" };
    },
    pending() {
      return (selectAll.all() as unknown as DeliveryRow[]).map(toDeliveryItem);
    },
    async deliverOnce(deliveryOptions) {
      const now = deliveryOptions.now ?? new Date();
      const batchSize = Math.max(1, Math.min(deliveryOptions.batchSize ?? 100, 100));
      const rows = selectDue.all(now.toISOString(), batchSize) as unknown as DeliveryRow[];
      if (rows.length === 0) {
        return { sent: 0, acknowledged: 0, retrying: 0, poisoned: 0 };
      }
      const batchId = randomUUID();
      const events = rows.map((row) => toDeliveryItem(row).event);
      let response: Response;
      try {
        response = await (deliveryOptions.fetch ?? globalThis.fetch)(
          `${deliveryOptions.baseUrl.replace(/\/$/, "")}/api/v1/device/source-event-batches`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${deliveryOptions.deviceCredential}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ batchId, events }),
          },
        );
        if (!response.ok) throw new Error(`DELIVERY_HTTP_${response.status}`);
      } catch (error) {
        const code = error instanceof Error ? error.message : "DELIVERY_NETWORK_ERROR";
        for (const row of rows) retry.run(retryAt(row.attempts, now), code, row.id);
        return {
          sent: rows.length,
          acknowledged: 0,
          retrying: rows.length,
          poisoned: 0,
        };
      }

      let acknowledgement;
      try {
        acknowledgement = SourceEventBatchResponseSchema.parse(await response.json());
        if (acknowledgement.batchId !== batchId) {
          throw new Error("Acknowledgement batch identity mismatch.");
        }
      } catch {
        for (const row of rows) {
          retry.run(retryAt(row.attempts, now), "ACKNOWLEDGEMENT_INVALID", row.id);
        }
        return {
          sent: rows.length,
          acknowledged: 0,
          retrying: rows.length,
          poisoned: 0,
        };
      }

      const results = new Map(
        acknowledgement.results.map((result) => [result.eventId, result]),
      );
      let acknowledged = 0;
      let retryingCount = 0;
      let poisonedCount = 0;
      for (const row of rows) {
        const result = results.get(row.id);
        if (result?.status === "accepted" || result?.status === "duplicate") {
          remove.run(row.id);
          acknowledged += 1;
        } else if (result?.status === "rejected" && result.retryable === false) {
          poison.run(result.code ?? "SOURCE_EVENT_REJECTED", row.id);
          poisonedCount += 1;
        } else {
          retry.run(
            retryAt(row.attempts, now),
            result?.code ?? "ACKNOWLEDGEMENT_MISSING",
            row.id,
          );
          retryingCount += 1;
        }
      }
      return {
        sent: rows.length,
        acknowledged,
        retrying: retryingCount,
        poisoned: poisonedCount,
      };
    },
    close() {
      database.close();
    },
  };
}
