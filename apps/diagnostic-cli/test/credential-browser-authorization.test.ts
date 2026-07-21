import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function runCli(
  args: string[],
  environment: Record<string, string>,
) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: { ...process.env, NO_COLOR: "1", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { exitCode, stdout, stderr };
}

describe("spawned browser-authorized Analysis credential CLI", () => {
  it("writes a credential to a 0600 file, reports status, and revokes without printing secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analysis-browser-auth-"));
    temporaryDirectories.push(directory);
    const bin = join(directory, "bin");
    await mkdir(bin);
    const credentialPath = join(directory, "credentials", "analysis");
    const grant =
      "analysis_grant_test_lookup_123_test_secret_1234567890123456789012345678901234567890123";
    const credential =
      "analysis_1234567890123456789012345678901234567890123";
    const credentialRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      memberId: "22222222-2222-4222-8222-222222222222",
      name: "Local investigator",
      scopes: ["organization:evidence:read", "candidate:submit"],
      createdAt: "2026-07-19T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    };
    let redeemed = false;
    let revoked = false;
    const server = createServer(async (request, response) => {
      const body: Buffer[] = [];
      for await (const chunk of request) body.push(Buffer.from(chunk as Buffer));
      response.setHeader("content-type", "application/json");
      if (
        request.method === "POST" &&
        request.url === "/api/v1/analysis-credential-grants/redeem"
      ) {
        expect(JSON.parse(Buffer.concat(body).toString("utf8"))).toEqual({ grant });
        redeemed = true;
        response.end(
          JSON.stringify({ credential, analysisCredential: credentialRecord }),
        );
        return;
      }
      expect(request.headers.authorization).toBe(`Bearer ${credential}`);
      if (request.method === "GET" && request.url === "/api/v1/analysis-credential") {
        response.end(
          JSON.stringify({
            person: {
              id: "33333333-3333-4333-8333-333333333333",
              displayName: "Analysis Operator",
              email: null,
            },
            organization: {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Local Organization",
            },
            member: {
              id: credentialRecord.memberId,
              displayName: "Analysis Operator",
              role: "administrator",
            },
            analysisCredential: credentialRecord,
          }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/api/v1/analysis-credential/revoke") {
        revoked = true;
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    const openPath = join(bin, "open");
    await writeFile(
      openPath,
      `#!/usr/bin/env node
const url = new URL(process.argv[2]);
if (url.pathname !== "/api/v1/analysis-credential/authorize") process.exit(10);
if (url.searchParams.get("name") !== "Local investigator") process.exit(11);
const response = await fetch(url.searchParams.get("callback"), {
  method: "POST",
  body: new URLSearchParams({ state: url.searchParams.get("state"), grant: ${JSON.stringify(grant)} }),
});
if (!response.ok) process.exit(12);
`,
      "utf8",
    );
    await chmod(openPath, 0o700);
    const environment = {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: directory,
    };

    const created = await runCli(
      [
        "credential",
        "create",
        "--name",
        "Local investigator",
        "--output",
        credentialPath,
        "--server-url",
        serverUrl,
        "--json",
      ],
      environment,
    );
    expect(created).toMatchObject({ exitCode: 0, stderr: "" });
    expect(redeemed).toBe(true);
    expect(created.stdout).not.toContain(credential);
    expect(JSON.parse(created.stdout)).toMatchObject({
      analysisCredential: { id: credentialRecord.id, name: "Local investigator" },
      credentialFile: credentialPath,
    });
    expect(await readFile(credentialPath, "utf8")).toBe(`${credential}\n`);
    expect((await stat(credentialPath)).mode & 0o777).toBe(0o600);

    const status = await runCli(
      [
        "credential",
        "status",
        "--analysis-credential-file",
        credentialPath,
        "--server-url",
        serverUrl,
        "--json",
      ],
      environment,
    );
    expect(status).toMatchObject({ exitCode: 0, stderr: "" });
    expect(status.stdout).not.toContain(credential);
    expect(JSON.parse(status.stdout)).toMatchObject({
      organization: { name: "Local Organization" },
      analysisCredential: { id: credentialRecord.id },
    });

    const revoke = await runCli(
      [
        "credential",
        "revoke",
        "--analysis-credential-file",
        credentialPath,
        "--server-url",
        serverUrl,
        "--json",
      ],
      environment,
    );
    expect(revoke).toMatchObject({ exitCode: 0, stderr: "" });
    expect(revoked).toBe(true);
    expect(revoke.stdout).not.toContain(credential);
    expect(JSON.parse(revoke.stdout)).toEqual({
      revoked: true,
      credentialFileRemoved: true,
    });
    await expect(access(credentialPath)).rejects.toThrow();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});
