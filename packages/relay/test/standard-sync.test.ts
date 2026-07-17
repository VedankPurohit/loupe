import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listActiveSessionIds,
  organizationStandardNamespace,
  recordLocalSessionActivity,
  runOrganizationStandardSyncDaemon,
  syncOrganizationStandardOnce,
} from "../src/standard-sync.js";

const skillContent =
  "---\nname: prefer-evidence\ndescription: Require evidence before recommendations.\n---\n\n# Prefer evidence\n\nCite observed Turns before recommending changes.\n";
const standardId = "11111111-1111-4111-8111-111111111111";
const firstReleaseId = "22222222-2222-4222-8222-222222222222";
const approvedHash =
  "sha256:48bb181d41354e2c6a051c0f981286934507e784b4e7c389694ac0bd6c116830";
const secondReleaseId = "33333333-3333-4333-8333-333333333333";
const secondSkillContent =
  "---\nname: prefer-evidence\ndescription: Require evidence before recommendations.\n---\n\n# Prefer evidence v2\n";
const secondHash =
  "sha256:39017774ebeeaa6fb42cf1d3102e8a305b449be0f5aeceff1980b00745d3df13";
const secondStandardId = "44444444-4444-4444-8444-444444444444";
const thirdReleaseId = "55555555-5555-4555-8555-555555555555";
const thirdSkillContent =
  "---\nname: guard-context\ndescription: Guard context before model calls.\n---\n\n# Guard context v2\n";
const thirdHash =
  "sha256:974e0cad87cffa1da56058b01b9736aba113fb7cfd85d3cc7b7ca6c8c6e653dc";

interface TestDistribution {
  server: Server;
  baseUrl: string;
  statuses: Array<Record<string, unknown>>;
  artifactRequests: string[];
}

interface MultiTestTarget {
  standardId: string;
  name: string;
  releaseId: string;
  version: string;
  artifactHash: string;
  package: { files: Array<{ path: string; content: string }> };
  state: "active" | "paused";
  previousReleaseId: string | null;
}

interface MultiTestDistribution extends TestDistribution {
  targets: MultiTestTarget[];
}

async function startDistribution(options?: {
  artifactHash?: string;
  artifactStatus?: number;
  pollAfterSeconds?: number;
  relativeArtifactUrl?: boolean;
  package?: { files: Array<{ path: string; content: string }> };
  state?: "active" | "paused";
  targetReleaseId?: string;
  previousReleaseId?: string | null;
}): Promise<TestDistribution> {
  const statuses: Array<Record<string, unknown>> = [];
  const artifactRequests: string[] = [];
  let baseUrl = "";
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/v1/device/standards/manifest") {
      const releaseId = options?.targetReleaseId ?? firstReleaseId;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          schemaVersion: "1",
          pollAfterSeconds: options?.pollAfterSeconds ?? 30,
          generatedAt: "2026-07-17T08:00:00.000Z",
          targets: [{
            standardId,
            name: "prefer-evidence",
            releaseId,
            version: releaseId === firstReleaseId ? "1.0.0" : "2.0.0",
            artifactHash: options?.artifactHash ?? approvedHash,
            artifactUrl: options?.relativeArtifactUrl
              ? `/api/v1/device/standards/artifacts/${releaseId}`
              : `${baseUrl}/api/v1/device/standards/artifacts/${releaseId}`,
            collisionPolicy: "organization_wins_preserve_personal",
            sequence: 1,
            state: options?.state ?? "active",
            mandatory: true,
            previousReleaseId: options?.previousReleaseId ?? null,
          }],
        }),
      );
      return;
    }
    if (
      request.method === "GET" &&
      request.url?.startsWith("/api/v1/device/standards/artifacts/")
    ) {
      artifactRequests.push(request.url);
      if (options?.artifactStatus && options.artifactStatus !== 200) {
        response.writeHead(options.artifactStatus).end();
        return;
      }
      const releaseId = request.url.split("/").at(-1)!;
      const candidatePackage = options?.package ?? {
        files: [{ path: "SKILL.md", content: skillContent }],
      };
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          releaseId,
          standardId,
          name: "prefer-evidence",
          version: releaseId === firstReleaseId ? "1.0.0" : "2.0.0",
          artifactHash: options?.artifactHash ?? approvedHash,
          package: candidatePackage,
        }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/api/v1/device/standards/installations"
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      statuses.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl, statuses, artifactRequests };
}

async function startMultiStandardDistribution(): Promise<MultiTestDistribution> {
  const statuses: Array<Record<string, unknown>> = [];
  const artifactRequests: string[] = [];
  let baseUrl = "";
  const targets = [
    {
      standardId,
      name: "prefer-evidence",
      releaseId: firstReleaseId,
      version: "1.0.0",
      artifactHash: approvedHash,
      package: { files: [{ path: "SKILL.md", content: skillContent }] },
      state: "active" as const,
      previousReleaseId: null,
    },
    {
      standardId: secondStandardId,
      name: "guard-context",
      releaseId: secondReleaseId,
      version: "1.0.0",
      artifactHash: secondHash,
      package: { files: [{ path: "SKILL.md", content: secondSkillContent }] },
      state: "active" as const,
      previousReleaseId: null,
    },
  ];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/v1/device/standards/manifest") {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          schemaVersion: "1",
          pollAfterSeconds: 30,
          generatedAt: "2026-07-17T08:00:00.000Z",
          targets: targets.map((target) => ({
            ...target,
            package: undefined,
            artifactUrl: `${baseUrl}/api/v1/device/standards/artifacts/${target.releaseId}`,
            collisionPolicy: "organization_wins_preserve_personal",
            sequence: 1,
            state: target.state,
            mandatory: true,
            previousReleaseId: target.previousReleaseId,
          })),
        }),
      );
      return;
    }
    if (
      request.method === "GET" &&
      request.url?.startsWith("/api/v1/device/standards/artifacts/")
    ) {
      artifactRequests.push(request.url);
      const releaseId = request.url.split("/").at(-1)!;
      const target = targets.find((item) => item.releaseId === releaseId);
      if (!target) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          releaseId: target.releaseId,
          standardId: target.standardId,
          name: target.name,
          version: target.version,
          artifactHash: target.artifactHash,
          package: target.package,
        }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/api/v1/device/standards/installations"
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      statuses.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl, statuses, artifactRequests, targets };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("mandatory Organization standard synchronization", () => {
  const roots: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("installs every mandatory standard from one manifest on a fresh Enrolled device", async () => {
    const distribution = await startMultiStandardDistribution();
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-multi-${randomUUID()}`);
    roots.push(installRoot);

    const result = await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_multi_standard",
      activeSessionIds: async () => [],
    });

    for (const [targetStandardId, expectedContent] of [
      [standardId, skillContent],
      [secondStandardId, secondSkillContent],
    ] as const) {
      const namespace = organizationStandardNamespace(installRoot, targetStandardId);
      const activeTarget = await readlink(join(namespace, "current"));
      expect(await readFile(join(namespace, activeTarget, "SKILL.md"), "utf8")).toBe(
        expectedContent,
      );
    }
    expect(result.statuses).toEqual([
      expect.objectContaining({
        standardId,
        releaseId: firstReleaseId,
        state: "installed",
      }),
      expect.objectContaining({
        standardId: secondStandardId,
        releaseId: secondReleaseId,
        state: "installed",
      }),
    ]);
    expect(distribution.statuses).toEqual(result.statuses);
  });

  it("leaves one paused standard unchanged while another standard advances", async () => {
    const distribution = await startMultiStandardDistribution();
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-independent-pause-${randomUUID()}`);
    roots.push(installRoot);
    const sync = () =>
      syncOrganizationStandardOnce({
        installRoot,
        baseUrl: distribution.baseUrl,
        deviceCredential: "device_independent_pause",
        activeSessionIds: async () => [],
      });
    await sync();
    const pausedNamespace = organizationStandardNamespace(installRoot, standardId);
    const pausedBefore = await readlink(join(pausedNamespace, "current"));

    distribution.targets[0]!.state = "paused";
    Object.assign(distribution.targets[1]!, {
      releaseId: thirdReleaseId,
      version: "2.0.0",
      artifactHash: thirdHash,
      package: { files: [{ path: "SKILL.md", content: thirdSkillContent }] },
      previousReleaseId: secondReleaseId,
    });
    const result = await sync();

    expect(result.statuses).toEqual([
      expect.objectContaining({
        standardId,
        releaseId: firstReleaseId,
        installedReleaseId: firstReleaseId,
        state: "idle",
      }),
      expect.objectContaining({
        standardId: secondStandardId,
        releaseId: thirdReleaseId,
        installedReleaseId: thirdReleaseId,
        state: "installed",
      }),
    ]);
    expect(await readlink(join(pausedNamespace, "current"))).toBe(pausedBefore);
    expect(
      await readlink(join(organizationStandardNamespace(installRoot, secondStandardId), "current")),
    ).toBe(join("versions", thirdReleaseId));
    expect(distribution.artifactRequests).toEqual([
      `/api/v1/device/standards/artifacts/${firstReleaseId}`,
      `/api/v1/device/standards/artifacts/${secondReleaseId}`,
      `/api/v1/device/standards/artifacts/${thirdReleaseId}`,
    ]);
  });

  it("rolls back one standard without changing another standard", async () => {
    const distribution = await startMultiStandardDistribution();
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-independent-rollback-${randomUUID()}`);
    roots.push(installRoot);
    const sync = () =>
      syncOrganizationStandardOnce({
        installRoot,
        baseUrl: distribution.baseUrl,
        deviceCredential: "device_independent_rollback",
        activeSessionIds: async () => [],
      });
    await sync();
    Object.assign(distribution.targets[1]!, {
      releaseId: thirdReleaseId,
      version: "2.0.0",
      artifactHash: thirdHash,
      package: { files: [{ path: "SKILL.md", content: thirdSkillContent }] },
      previousReleaseId: secondReleaseId,
    });
    await sync();
    const unaffectedNamespace = organizationStandardNamespace(installRoot, standardId);
    const unaffectedBefore = await readlink(join(unaffectedNamespace, "current"));

    Object.assign(distribution.targets[1]!, {
      releaseId: secondReleaseId,
      version: "1.0.0",
      artifactHash: secondHash,
      package: { files: [{ path: "SKILL.md", content: secondSkillContent }] },
      previousReleaseId: thirdReleaseId,
    });
    const rollback = await sync();

    expect(rollback.statuses).toEqual([
      expect.objectContaining({
        standardId,
        installedReleaseId: firstReleaseId,
        state: "installed",
      }),
      expect.objectContaining({
        standardId: secondStandardId,
        installedReleaseId: secondReleaseId,
        state: "rolled_back",
      }),
    ]);
    expect(await readlink(join(unaffectedNamespace, "current"))).toBe(unaffectedBefore);
    expect(
      await readlink(join(organizationStandardNamespace(installRoot, secondStandardId), "current")),
    ).toBe(join("versions", secondReleaseId));
  });

  it("installs the one approved exact artifact on every Enrolled device without touching a personal skill", async () => {
    const distribution = await startDistribution();
    servers.push(distribution.server);
    const destinations = await Promise.all(
      ["device-a", "device-b"].map(async (device) => {
        const installRoot = join(tmpdir(), `standard-sync-${device}-${randomUUID()}`);
        roots.push(installRoot);
        await mkdir(join(installRoot, "prefer-evidence"), { recursive: true });
        await writeFile(join(installRoot, "prefer-evidence", "SKILL.md"), "personal version\n");
        await syncOrganizationStandardOnce({
          installRoot,
          baseUrl: distribution.baseUrl,
          deviceCredential: `device_${device}`,
          activeSessionIds: async () => [],
        });
        return installRoot;
      }),
    );

    for (const installRoot of destinations) {
      const namespace = organizationStandardNamespace(
        installRoot,
        standardId,
      );
      const activeTarget = await readlink(join(namespace, "current"));
      expect(await readFile(join(namespace, activeTarget, "SKILL.md"), "utf8")).toBe(
        skillContent,
      );
      expect(await readFile(join(installRoot, "prefer-evidence", "SKILL.md"), "utf8")).toBe(
        "personal version\n",
      );
    }
    expect(distribution.artifactRequests).toEqual([
      `/api/v1/device/standards/artifacts/${firstReleaseId}`,
      `/api/v1/device/standards/artifacts/${firstReleaseId}`,
    ]);
    expect(distribution.statuses).toHaveLength(2);
    expect(distribution.statuses).toEqual([
      expect.objectContaining({ releaseId: firstReleaseId, state: "installed" }),
      expect.objectContaining({ releaseId: firstReleaseId, state: "installed" }),
    ]);
  });

  it("keeps the current version active and reports an observable artifact download failure", async () => {
    const control: Parameters<typeof startDistribution>[0] = {};
    const distribution = await startDistribution(control);
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-download-${randomUUID()}`);
    roots.push(installRoot);
    await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_download_failure",
      activeSessionIds: async () => [],
    });
    const namespace = organizationStandardNamespace(installRoot, standardId);
    const activeBefore = await readlink(join(namespace, "current"));

    control!.targetReleaseId = secondReleaseId;
    control!.artifactStatus = 503;
    const result = await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_download_failure",
      activeSessionIds: async () => [],
    });

    expect(result.statuses[0]).toMatchObject({
      state: "download_failed",
      installedReleaseId: firstReleaseId,
      failure: { stage: "download", code: "STANDARD_DOWNLOAD_HTTP_503" },
    });
    expect(await readlink(join(namespace, "current"))).toBe(activeBefore);
    expect(distribution.statuses.at(-1)).toMatchObject(result.statuses[0]);
  });

  it("polls repeatedly at the bounded server-directed interval until the daemon is stopped", async () => {
    const distribution = await startDistribution({ pollAfterSeconds: 5 });
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-poll-${randomUUID()}`);
    roots.push(installRoot);
    const controller = new AbortController();
    const waits: number[] = [];

    await runOrganizationStandardSyncDaemon({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_bounded_poll",
      activeSessionIds: async () => [],
      signal: controller.signal,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        if (waits.length === 2) controller.abort();
      },
    });

    expect(waits).toEqual([5_000, 5_000]);
    expect(distribution.statuses).toHaveLength(2);
  });

  it("resolves the server's device-scoped relative artifact URL", async () => {
    const distribution = await startDistribution({ relativeArtifactUrl: true });
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-relative-${randomUUID()}`);
    roots.push(installRoot);

    const result = await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_relative_artifact",
      activeSessionIds: async () => [],
    });

    expect(result.statuses[0]?.state).toBe("installed");
  });

  it("honors Administrator pause without changing or forgetting the installed release", async () => {
    const control: Parameters<typeof startDistribution>[0] = {};
    const distribution = await startDistribution(control);
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-pause-${randomUUID()}`);
    roots.push(installRoot);
    await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_pause",
      activeSessionIds: async () => [],
    });
    const namespace = organizationStandardNamespace(installRoot, standardId);
    const activeBefore = await readlink(join(namespace, "current"));

    control!.state = "paused";
    const result = await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_pause",
      activeSessionIds: async () => [],
    });

    expect(result.statuses[0]).toMatchObject({
      state: "idle",
      releaseId: firstReleaseId,
      installedReleaseId: firstReleaseId,
    });
    expect(await readlink(join(namespace, "current"))).toBe(activeBefore);
    expect(distribution.artifactRequests).toHaveLength(1);
  });

  it("switches back to the Administrator rollback target and retains both working versions", async () => {
    const control: Parameters<typeof startDistribution>[0] = {};
    const distribution = await startDistribution(control);
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-rollback-${randomUUID()}`);
    roots.push(installRoot);
    const sync = () =>
      syncOrganizationStandardOnce({
        installRoot,
        baseUrl: distribution.baseUrl,
        deviceCredential: "device_rollback",
        activeSessionIds: async () => [],
      });
    await sync();
    control!.targetReleaseId = secondReleaseId;
    control!.artifactHash = secondHash;
    control!.package = { files: [{ path: "SKILL.md", content: secondSkillContent }] };
    await sync();

    control!.targetReleaseId = firstReleaseId;
    control!.artifactHash = approvedHash;
    control!.package = { files: [{ path: "SKILL.md", content: skillContent }] };
    control!.previousReleaseId = secondReleaseId;
    const rollback = await sync();

    const namespace = organizationStandardNamespace(installRoot, standardId);
    expect(rollback.statuses[0]?.state).toBe("rolled_back");
    expect(await readlink(join(namespace, "current"))).toBe(
      join("versions", firstReleaseId),
    );
    expect(await readFile(join(namespace, "versions", firstReleaseId, "SKILL.md"), "utf8")).toBe(
      skillContent,
    );
    expect(await readFile(join(namespace, "versions", secondReleaseId, "SKILL.md"), "utf8")).toBe(
      secondSkillContent,
    );
  });

  it("recovers the active release and clears abandoned staging after a daemon restart", async () => {
    const distribution = await startDistribution();
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-restart-${randomUUID()}`);
    roots.push(installRoot);
    const sync = () =>
      syncOrganizationStandardOnce({
        installRoot,
        baseUrl: distribution.baseUrl,
        deviceCredential: "device_restart",
        activeSessionIds: async () => [],
      });
    await sync();
    const namespace = organizationStandardNamespace(installRoot, standardId);
    await rm(join(namespace, "state.json"));
    const abandoned = join(namespace, ".staging", "abandoned-download");
    await mkdir(abandoned, { recursive: true });
    await writeFile(join(abandoned, "partial"), "partial artifact");

    const recovered = await sync();

    expect(recovered.statuses[0]).toMatchObject({
      state: "installed",
      installedReleaseId: firstReleaseId,
    });
    expect(distribution.artifactRequests).toHaveLength(1);
    await expect(readFile(join(abandoned, "partial"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("durably defers installation from SessionStart until the matching Stop", async () => {
    const distribution = await startDistribution();
    servers.push(distribution.server);
    const stateDir = join(tmpdir(), `standard-sync-session-${randomUUID()}`);
    roots.push(stateDir);
    await mkdir(stateDir, { recursive: true });
    const databasePath = join(stateDir, "relay.sqlite");
    recordLocalSessionActivity({
      databasePath,
      producerEvent: "SessionStart",
      payload: { session_id: "session-active" },
      observedAt: "2026-07-17T08:00:00.000Z",
    });

    const deferred = await syncOrganizationStandardOnce({
      installRoot: stateDir,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_active_session",
      activeSessionIds: async () =>
        listActiveSessionIds({
          databasePath,
          now: new Date("2026-07-17T08:01:00.000Z"),
        }),
    });
    expect(deferred.statuses[0]).toMatchObject({
      state: "deferred_active_session",
      installedReleaseId: null,
      activeSessionIds: ["session-active"],
    });
    expect(distribution.artifactRequests).toHaveLength(0);

    recordLocalSessionActivity({
      databasePath,
      producerEvent: "Stop",
      payload: { session_id: "session-active" },
      observedAt: "2026-07-17T08:02:00.000Z",
    });
    const installed = await syncOrganizationStandardOnce({
      installRoot: stateDir,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_active_session",
      activeSessionIds: async () => listActiveSessionIds({ databasePath }),
    });
    expect(installed.statuses[0]?.state).toBe("installed");
  });

  it("reports a staging failure without removing an already-owned destination", async () => {
    const distribution = await startDistribution();
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-stage-${randomUUID()}`);
    roots.push(installRoot);
    await writeFile(installRoot, "member-owned path");

    const result = await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_staging_failure",
      activeSessionIds: async () => [],
    });

    expect(result.statuses[0]).toMatchObject({
      state: "staging_failed",
      installedReleaseId: null,
      failure: { stage: "staging" },
    });
    expect(await readFile(installRoot, "utf8")).toBe("member-owned path");
    expect(distribution.statuses.at(-1)).toMatchObject(result.statuses[0]);
  });

  it("rejects a changed unapproved package and keeps the approved release current", async () => {
    const control: Parameters<typeof startDistribution>[0] = {};
    const distribution = await startDistribution(control);
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-hash-${randomUUID()}`);
    roots.push(installRoot);
    const sync = () =>
      syncOrganizationStandardOnce({
        installRoot,
        baseUrl: distribution.baseUrl,
        deviceCredential: "device_hash",
        activeSessionIds: async () => [],
      });
    await sync();
    const namespace = organizationStandardNamespace(installRoot, standardId);
    const approvedTarget = await readlink(join(namespace, "current"));

    control!.targetReleaseId = secondReleaseId;
    control!.artifactHash = secondHash;
    control!.package = {
      files: [{ path: "SKILL.md", content: `${secondSkillContent}\nchanged after approval\n` }],
    };
    const rejected = await sync();

    expect(rejected.statuses[0]).toMatchObject({
      state: "verification_failed",
      installedReleaseId: firstReleaseId,
      failure: { stage: "verification", code: "STANDARD_ARTIFACT_HASH_MISMATCH" },
    });
    expect(await readlink(join(namespace, "current"))).toBe(approvedTarget);
  });

  it("reports an atomic-switch collision and preserves the colliding content", async () => {
    const distribution = await startDistribution();
    servers.push(distribution.server);
    const installRoot = join(tmpdir(), `standard-sync-switch-${randomUUID()}`);
    roots.push(installRoot);
    const namespace = organizationStandardNamespace(installRoot, standardId);
    await mkdir(join(namespace, "current"), { recursive: true });
    await writeFile(join(namespace, "current", "member-content"), "preserve me");

    const result = await syncOrganizationStandardOnce({
      installRoot,
      baseUrl: distribution.baseUrl,
      deviceCredential: "device_switch_failure",
      activeSessionIds: async () => [],
    });

    expect(result.statuses[0]).toMatchObject({
      state: "switch_failed",
      failure: { stage: "switch" },
    });
    expect(await readFile(join(namespace, "current", "member-content"), "utf8")).toBe(
      "preserve me",
    );
  });
});
