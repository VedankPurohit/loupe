import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { inspectGitContext, type GitCommandRunner } from "../src/index.js";

const execFile = promisify(execFileCallback);

describe("relay Git context enrichment", () => {
  const paths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("samples a repository and strips credentials from its remote identity", async () => {
    const repository = await mkdtemp(join(tmpdir(), `git-context-${randomUUID()}-`));
    paths.push(repository);
    await execFile("git", ["init", "--initial-branch=main", repository]);
    await execFile("git", ["-C", repository, "config", "user.name", "Test User"]);
    await execFile("git", ["-C", repository, "config", "user.email", "test@example.invalid"]);
    await execFile("git", [
      "-C",
      repository,
      "remote",
      "add",
      "origin",
      "https://oauth2:credential-value@example.com/acme/project.git?token=also-secret",
    ]);
    await writeFile(join(repository, "README.md"), "Git context fixture\n", "utf8");
    await execFile("git", ["-C", repository, "add", "README.md"]);
    await execFile("git", ["-C", repository, "commit", "-m", "fixture"]);
    const expectedCommit = (
      await execFile("git", ["-C", repository, "rev-parse", "HEAD"])
    ).stdout.trim();
    const expectedRepositoryRoot = await realpath(repository);

    const observed = await inspectGitContext({
      cwd: repository,
      sampledAt: new Date("2026-07-17T12:30:00.000Z"),
    });

    expect(observed).toEqual({
      status: "available",
      repositoryRoot: expectedRepositoryRoot,
      remoteIdentity: "https://example.com/acme/project.git",
      branch: "main",
      detached: false,
      worktree: expectedRepositoryRoot,
      commit: expectedCommit,
      sampledAt: "2026-07-17T12:30:00.000Z",
      provenance: {
        source: "relay_local_git",
        evidence: "local_observation",
        stability: "observed",
        derivation: "exact",
        cwd: repository,
      },
      reason: null,
    });
    expect(JSON.stringify(observed)).not.toContain("credential-value");
    expect(JSON.stringify(observed)).not.toContain("also-secret");

    await execFile("git", ["-C", repository, "checkout", "--detach"]);
    expect(await inspectGitContext({ cwd: repository })).toMatchObject({
      status: "available",
      branch: null,
      detached: true,
      commit: expectedCommit,
    });
  });

  it("returns explicit non-repository, inspection-failure, and unavailable states", async () => {
    const directory = await mkdtemp(join(tmpdir(), `not-a-repo-${randomUUID()}-`));
    paths.push(directory);
    expect(await inspectGitContext({ cwd: directory })).toMatchObject({
      status: "not_repository",
      repositoryRoot: null,
      remoteIdentity: null,
      branch: null,
      detached: null,
      worktree: null,
      commit: null,
      reason: "cwd_is_not_a_git_repository",
    });

    const failedRunner: GitCommandRunner = async () => ({
      stdout: "",
      stderr: "sensitive diagnostic deliberately not returned",
      exitCode: 2,
    });
    expect(
      await inspectGitContext({ cwd: directory, runGit: failedRunner }),
    ).toMatchObject({
      status: "inspection_failed",
      repositoryRoot: null,
      reason: "git_inspection_failed",
    });

    const unavailableRunner: GitCommandRunner = async () => ({
      stdout: "",
      stderr: "",
      exitCode: null,
      errorCode: "ENOENT",
    });
    expect(
      await inspectGitContext({ cwd: directory, runGit: unavailableRunner }),
    ).toMatchObject({
      status: "unavailable",
      repositoryRoot: null,
      reason: "git_command_unavailable",
    });
  });
});
