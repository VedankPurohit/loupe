import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

async function runCli(args: string[]) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      NO_COLOR: "1",
      CODING_AGENT_OBSERVABILITY_BROWSER_SESSION: "browser-session-test-token",
    },
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

test("an Administrator can import the server-controlled rich-v1 pack through the CLI", async () => {
  let requestedUrl: string | undefined;
  let requestedCookie: string | undefined;
  const server = createServer((request, response) => {
    requestedUrl = request.url;
    requestedCookie = request.headers.cookie;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        version: "rich-v1",
        imported: true,
        exampleMemberId: "11111111-1111-4111-8111-111111111111",
        sessionIds: ["seeded-rich-v1-provenance-safe-00"],
        syntheticDesignation: "seeded",
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");

  const result = await runCli([
    "examples",
    "import",
    "rich-v1",
    "--server-url",
    `http://127.0.0.1:${address.port}`,
  ]);

  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(requestedUrl).toBe("/api/v1/administration/example-packs/rich-v1/import");
  expect(requestedCookie).toBe("browser_session=browser-session-test-token");
  expect(result.stdout).toContain(
    "Imported rich-v1: seeded-rich-v1-provenance-safe-00 [Seeded]",
  );
});
