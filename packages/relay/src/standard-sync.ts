import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DeviceStandardArtifactSchema,
  DeviceStandardInstallationReportRequestSchema,
  DeviceStandardManifestSchema,
  type CandidatePackage,
  type DeviceStandardArtifact,
  type DeviceStandardInstallationReportRequest,
  type DeviceStandardManifest,
} from "@workspace/contracts";

export const minimumStandardPollIntervalMs = 5_000;
export const maximumStandardPollIntervalMs = 5 * 60_000;
export const defaultStandardPollIntervalMs = 30_000;

type OrganizationStandardTarget = DeviceStandardManifest["targets"][number];
type OrganizationStandardManifest = DeviceStandardManifest;
type StandardInstallationStatus = DeviceStandardInstallationReportRequest;
type StandardArtifact = DeviceStandardArtifact;

interface InstalledState {
  schemaVersion: 1;
  standardId: string;
  releaseId: string;
  version: string;
  artifactHash: string;
  previousReleaseId: string | null;
  installedAt: string;
}

export interface StandardSyncResult {
  manifest: OrganizationStandardManifest;
  statuses: StandardInstallationStatus[];
  nextPollAfterMs: number;
}

export interface StandardSyncOptions {
  installRoot: string;
  baseUrl: string;
  deviceCredential: string;
  activeSessionIds: () => Promise<string[]>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

export interface StandardSyncDaemonOptions extends StandardSyncOptions {
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  onPollError?: (error: unknown) => void;
}

function ensureSessionActivityTable(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_active_sessions (
      session_id TEXT PRIMARY KEY,
      last_observed_at TEXT NOT NULL
    ) STRICT
  `);
}

/** Records only the minimum local lifecycle needed to protect active Sessions. */
export function recordLocalSessionActivity(options: {
  databasePath: string;
  producerEvent: string;
  payload: Record<string, unknown>;
  observedAt?: string;
}): void {
  const sessionId =
    typeof options.payload.session_id === "string"
      ? options.payload.session_id
      : typeof options.payload.sessionId === "string"
        ? options.payload.sessionId
        : null;
  if (!sessionId) return;
  const database = new DatabaseSync(options.databasePath);
  try {
    ensureSessionActivityTable(database);
    if (options.producerEvent === "Stop" || options.producerEvent === "SessionEnd") {
      database.prepare("DELETE FROM local_active_sessions WHERE session_id = ?").run(sessionId);
      return;
    }
    database
      .prepare(`
        INSERT INTO local_active_sessions (session_id, last_observed_at)
        VALUES (?, ?)
        ON CONFLICT (session_id) DO UPDATE SET last_observed_at = excluded.last_observed_at
      `)
      .run(sessionId, options.observedAt ?? new Date().toISOString());
  } finally {
    database.close();
  }
}

/** Active records expire after a bounded crash-recovery window. */
export function listActiveSessionIds(options: {
  databasePath: string;
  now?: Date;
  idleAfterMs?: number;
}): string[] {
  const database = new DatabaseSync(options.databasePath);
  try {
    ensureSessionActivityTable(database);
    const now = options.now ?? new Date();
    const idleAfterMs = Math.max(60_000, options.idleAfterMs ?? 30 * 60_000);
    const cutoff = new Date(now.getTime() - idleAfterMs).toISOString();
    database
      .prepare("DELETE FROM local_active_sessions WHERE last_observed_at < ?")
      .run(cutoff);
    return (
      database
        .prepare("SELECT session_id FROM local_active_sessions ORDER BY session_id")
        .all() as Array<{ session_id: string }>
    ).map((row) => row.session_id);
  } finally {
    database.close();
  }
}

function parseManifest(value: unknown): OrganizationStandardManifest {
  return DeviceStandardManifestSchema.parse(value);
}

function parseArtifact(value: unknown): StandardArtifact {
  return DeviceStandardArtifactSchema.parse(value);
}

function safeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`STANDARD_NAMESPACE_INVALID: ${label} is not a safe identifier.`);
  }
  return value;
}

export function organizationStandardNamespace(installRoot: string, standardId: string): string {
  return join(
    installRoot,
    ".organization-standards",
    safeIdentifier(standardId, "standardId"),
  );
}

function canonicalPackage(candidatePackage: CandidatePackage): CandidatePackage {
  return {
    files: [...candidatePackage.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}

function hashPackage(candidatePackage: CandidatePackage): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalPackage(candidatePackage)))
    .digest("hex")}`;
}

function assertSafePackage(candidatePackage: CandidatePackage): void {
  const paths = new Set<string>();
  for (const file of candidatePackage.files) {
    if (
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
      paths.has(file.path)
    ) {
      throw new Error("STANDARD_ARTIFACT_INVALID: package contains an unsafe or duplicate path.");
    }
    paths.add(file.path);
  }
  if (!paths.has("SKILL.md")) {
    throw new Error("STANDARD_ARTIFACT_INVALID: package must contain a root SKILL.md.");
  }
}

async function optionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function optionalLink(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function boundedPollInterval(seconds: number): number {
  return Math.max(
    minimumStandardPollIntervalMs,
    Math.min(maximumStandardPollIntervalMs, Math.round(seconds * 1_000)),
  );
}

async function requestJson(
  url: string,
  credential: string,
  fetcher: typeof globalThis.fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`STANDARD_DOWNLOAD_HTTP_${response.status}`);
  return response.json();
}

async function reportStatus(
  options: StandardSyncOptions,
  status: StandardInstallationStatus,
): Promise<void> {
  const response = await (options.fetch ?? globalThis.fetch)(
    `${options.baseUrl.replace(/\/$/, "")}/api/v1/device/standards/installations`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(DeviceStandardInstallationReportRequestSchema.parse(status)),
    },
  );
  if (!response.ok) throw new Error(`STANDARD_STATUS_HTTP_${response.status}`);
}

async function readInstalledState(namespace: string): Promise<InstalledState | null> {
  const serialized = await optionalText(join(namespace, "state.json"));
  if (serialized === null) return null;
  try {
    return JSON.parse(serialized) as InstalledState;
  } catch {
    return null;
  }
}

async function recoverStandardNamespace(options: {
  namespace: string;
  standardId: string;
  now: string;
}): Promise<InstalledState | null> {
  await rm(join(options.namespace, ".staging"), { recursive: true, force: true });
  await mkdir(join(options.namespace, ".staging"), { recursive: true });
  const persisted = await readInstalledState(options.namespace);
  const currentTarget = await optionalLink(join(options.namespace, "current"));
  if (!currentTarget?.startsWith("versions/")) return persisted;
  const metadataText = await optionalText(join(options.namespace, currentTarget, ".release.json"));
  if (!metadataText) return persisted;
  let metadata: { releaseId?: unknown; version?: unknown; artifactHash?: unknown };
  try {
    metadata = JSON.parse(metadataText) as typeof metadata;
  } catch {
    return persisted;
  }
  if (
    typeof metadata.releaseId !== "string" ||
    typeof metadata.version !== "string" ||
    typeof metadata.artifactHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(metadata.artifactHash) ||
    currentTarget !== join("versions", metadata.releaseId)
  ) {
    return persisted;
  }
  if (
    persisted?.releaseId === metadata.releaseId &&
    persisted.artifactHash === metadata.artifactHash
  ) {
    return persisted;
  }
  const recovered: InstalledState = {
    schemaVersion: 1,
    standardId: options.standardId,
    releaseId: metadata.releaseId,
    version: metadata.version,
    artifactHash: metadata.artifactHash,
    previousReleaseId:
      persisted?.releaseId && persisted.releaseId !== metadata.releaseId
        ? persisted.releaseId
        : persisted?.previousReleaseId ?? null,
    installedAt: options.now,
  };
  await atomicWriteJson(join(options.namespace, "state.json"), recovered);
  return recovered;
}

async function installArtifact(options: {
  namespace: string;
  target: OrganizationStandardTarget;
  artifact: StandardArtifact;
  now: string;
}): Promise<InstalledState> {
  const { namespace, target, artifact } = options;
  assertSafePackage(artifact.package);
  const versionsRoot = join(namespace, "versions");
  const stagingRoot = join(namespace, ".staging");
  const staged = join(stagingRoot, randomUUID());
  const finalDirectory = join(versionsRoot, safeIdentifier(target.releaseId, "releaseId"));
  await mkdir(staged, { recursive: true });
  try {
    for (const file of artifact.package.files) {
      const destination = join(staged, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { mode: 0o600 });
    }
    await atomicWriteJson(join(staged, ".release.json"), {
      releaseId: target.releaseId,
      version: target.version,
      artifactHash: target.artifactHash,
    });
    await mkdir(versionsRoot, { recursive: true });
    try {
      await rename(staged, finalDirectory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      const existing = await optionalText(join(finalDirectory, ".release.json"));
      if (!existing || (JSON.parse(existing) as { artifactHash?: string }).artifactHash !== target.artifactHash) {
        throw new Error("STANDARD_RELEASE_COLLISION: release identity has different content.");
      }
    }
  } finally {
    await rm(staged, { recursive: true, force: true });
  }

  const currentPath = join(namespace, "current");
  const previousTarget = await optionalLink(currentPath);
  const newTarget = join("versions", target.releaseId);
  const switchLink = join(namespace, `.current-${randomUUID()}`);
  await symlink(newTarget, switchLink, "dir");
  await rename(switchLink, currentPath);
  const previousReleaseId = previousTarget?.startsWith("versions/")
    ? previousTarget.slice("versions/".length)
    : null;
  const state: InstalledState = {
    schemaVersion: 1,
    standardId: target.standardId,
    releaseId: target.releaseId,
    version: target.version,
    artifactHash: target.artifactHash,
    previousReleaseId,
    installedAt: options.now,
  };
  await atomicWriteJson(join(namespace, "state.json"), state);
  return state;
}

async function syncOrganizationStandardTarget(options: {
  sync: StandardSyncOptions;
  target: OrganizationStandardTarget;
  observedAt: string;
  activeSessionIds: () => Promise<string[]>;
}): Promise<StandardInstallationStatus> {
  const { sync, target, observedAt } = options;
  const fetcher = sync.fetch ?? globalThis.fetch;
  const namespace = organizationStandardNamespace(sync.installRoot, target.standardId);
  let installed: InstalledState | null;
  try {
    await mkdir(namespace, { recursive: true });
    installed = await recoverStandardNamespace({
      namespace,
      standardId: target.standardId,
      now: observedAt,
    });
  } catch (error) {
    const fsCode = (error as NodeJS.ErrnoException).code ?? "FAILED";
    const switchCollision = fsCode === "EINVAL";
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: null,
      state: switchCollision ? "switch_failed" : "staging_failed",
      observedAt,
      activeSessionIds: [],
      failure: {
        stage: switchCollision ? "switch" : "staging",
        code: `STANDARD_${switchCollision ? "SWITCH" : "STAGING"}_${fsCode}`.slice(0, 120),
        message: switchCollision
          ? "The atomic current pointer collides with unmanaged content; it was left unchanged."
          : "The Organization-owned staging namespace is unavailable; member-owned content was left unchanged.",
      },
    };
  }
  if (target.state === "paused") {
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed?.releaseId ?? null,
      state: "idle",
      observedAt,
      activeSessionIds: [],
    };
  }
  if (installed?.releaseId === target.releaseId && installed.artifactHash === target.artifactHash) {
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed.releaseId,
      state: "installed",
      observedAt,
      activeSessionIds: [],
    };
  }
  const activeSessionIds = await options.activeSessionIds();
  if (activeSessionIds.length > 0) {
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed?.releaseId ?? null,
      state: "deferred_active_session",
      observedAt,
      activeSessionIds,
    };
  }
  let downloadedArtifact: unknown;
  try {
    downloadedArtifact = await requestJson(
      new URL(target.artifactUrl, `${sync.baseUrl.replace(/\/$/, "")}/`).toString(),
      sync.deviceCredential,
      fetcher,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "STANDARD_DOWNLOAD_FAILED";
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed?.releaseId ?? null,
      state: "download_failed",
      observedAt,
      activeSessionIds: [],
      failure: {
        stage: "download",
        code: code.slice(0, 120),
        message: "The approved artifact could not be downloaded; the current version remains active.",
      },
    };
  }
  let artifact: StandardArtifact;
  try {
    artifact = parseArtifact(downloadedArtifact);
  } catch {
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed?.releaseId ?? null,
      state: "verification_failed",
      observedAt,
      activeSessionIds: [],
      failure: {
        stage: "verification",
        code: "STANDARD_ARTIFACT_CONTRACT_INVALID",
        message: "Downloaded content is not a valid approved standard artifact.",
      },
    };
  }
  if (
    artifact.releaseId !== target.releaseId ||
    artifact.standardId !== target.standardId ||
    artifact.name !== target.name ||
    artifact.version !== target.version ||
    artifact.artifactHash !== target.artifactHash ||
    hashPackage(artifact.package) !== target.artifactHash
  ) {
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed?.releaseId ?? null,
      state: "verification_failed",
      observedAt,
      activeSessionIds: [],
      failure: {
        stage: "verification",
        code: "STANDARD_ARTIFACT_HASH_MISMATCH",
        message: "Downloaded artifact does not match the exact Administrator-approved hash.",
      },
    };
  }
  let installedState: InstalledState;
  try {
    installedState = await installArtifact({ namespace, target, artifact, now: observedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "STANDARD_INSTALL_FAILED";
    const fsCode = (error as NodeJS.ErrnoException).code;
    const verificationFailure = message.startsWith("STANDARD_ARTIFACT_INVALID") ||
      message.startsWith("STANDARD_RELEASE_COLLISION");
    const switchFailure = !verificationFailure &&
      (fsCode === "EINVAL" || fsCode === "EISDIR" || fsCode === "ENOTEMPTY");
    const stage = verificationFailure ? "verification" : switchFailure ? "switch" : "staging";
    return {
      standardId: target.standardId,
      releaseId: target.releaseId,
      installedReleaseId: installed?.releaseId ?? null,
      state: verificationFailure
        ? "verification_failed"
        : switchFailure
          ? "switch_failed"
          : "staging_failed",
      observedAt,
      activeSessionIds: [],
      failure: {
        stage,
        code: (message.startsWith("STANDARD_")
          ? message.split(":", 1)[0]!
          : `STANDARD_${stage.toUpperCase()}_${fsCode ?? "FAILED"}`).slice(0, 120),
        message: `The ${stage} step failed; the prior current version remains recoverable.`,
      },
    };
  }
  return {
    standardId: target.standardId,
    releaseId: target.releaseId,
    installedReleaseId: installedState.releaseId,
    state: installed?.previousReleaseId === target.releaseId ? "rolled_back" : "installed",
    observedAt,
    activeSessionIds: [],
  };
}

/**
 * Synchronizes every mandatory Organization standard in one device manifest.
 * Each standard has an isolated Organization namespace and installation result.
 */
export async function syncOrganizationStandardOnce(
  options: StandardSyncOptions,
): Promise<StandardSyncResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const manifest = parseManifest(
    await requestJson(
      `${options.baseUrl.replace(/\/$/, "")}/api/v1/device/standards/manifest`,
      options.deviceCredential,
      fetcher,
    ),
  );
  const nextPollAfterMs = boundedPollInterval(manifest.pollAfterSeconds);
  let activeSessionIdsPromise: Promise<string[]> | undefined;
  const activeSessionIds = () =>
    (activeSessionIdsPromise ??= options.activeSessionIds());
  const statuses: StandardInstallationStatus[] = [];
  for (const target of manifest.targets) {
    statuses.push(
      await syncOrganizationStandardTarget({
        sync: options,
        target,
        observedAt,
        activeSessionIds,
      }),
    );
  }
  let reportError: unknown;
  for (const status of statuses) {
    try {
      await reportStatus(options, status);
    } catch (error) {
      reportError ??= error;
    }
  }
  if (reportError) throw reportError;
  return { manifest, statuses, nextPollAfterMs };
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Runs mandatory synchronization immediately and then at each bounded interval. */
export async function runOrganizationStandardSyncDaemon(
  options: StandardSyncDaemonOptions,
): Promise<void> {
  let nextPollAfterMs = defaultStandardPollIntervalMs;
  while (!options.signal?.aborted) {
    try {
      const result = await syncOrganizationStandardOnce(options);
      nextPollAfterMs = result.nextPollAfterMs;
    } catch (error) {
      options.onPollError?.(error);
      nextPollAfterMs = defaultStandardPollIntervalMs;
    }
    await (options.sleep ?? ((milliseconds) => abortableSleep(milliseconds, options.signal)))(
      nextPollAfterMs,
    );
  }
}
