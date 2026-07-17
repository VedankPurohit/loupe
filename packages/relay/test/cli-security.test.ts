import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

async function runCli(args: string[]) {
  const child = spawn("pnpm", ["exec", "tsx", cliPath, ...args], {
    env: { ...process.env, NO_COLOR: "1" },
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

describe("relay CLI credential handling", () => {
  it("keeps browser session values out of help and rejects the legacy argv flag", async () => {
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).not.toContain("--browser-session TOKEN");
    expect(help.stdout).not.toContain("LOUPE_");
    expect(help.stdout).toContain("--browser-session-file PATH");

    const legacy = await runCli(["status", "--browser-session", "stolen-secret"]);
    expect(legacy.exitCode).toBe(1);
    expect(legacy.stderr).toContain(
      "SECRET_ARG_REJECTED: --browser-session is unsafe because process arguments may be visible",
    );
    expect(legacy.stderr).not.toContain("stolen-secret");
  });
});
