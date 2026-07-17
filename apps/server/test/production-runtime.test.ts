import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database.js";

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a test port.");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitUntilListening(child: ChildProcessWithoutNullStreams) {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Built server did not start in time.\n${output}`));
    }, 10_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Server listening at")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Built server exited with code ${code}.\n${output}`));
    });
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams) {
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Built server did not exit in time.\n${output}`));
    }, 10_000);
    child.once("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
  return { code, output };
}

describe.sequential("emitted production server", () => {
  const testDatabase = createTestDatabase("production_runtime");
  let child: ChildProcessWithoutNullStreams | undefined;

  beforeAll(async () => {
    await testDatabase.create();
  });

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child?.once("exit", () => resolve()));
    }
    await testDatabase.drop();
  });

  it("rejects an empty injected code before creating a credential", async () => {
    const port = await reservePort();
    child = spawn(process.execPath, ["dist/main.js"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        BOOTSTRAP_CODE: "",
        DATABASE_URL: testDatabase.databaseUrl,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
    });

    const result = await waitForExit(child);
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'BOOTSTRAP_CODE must start with "bootstrap_" and contain at least 43 URL-safe characters after the prefix.',
    );
  });

  it("starts with plain Node and serves the versioned API", async () => {
    const port = await reservePort();
    child = spawn(process.execPath, ["dist/main.js"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: testDatabase.databaseUrl,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
    });
    await waitUntilListening(child);

    const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", apiVersion: "v1" });
  });
});
