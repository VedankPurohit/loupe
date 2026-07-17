import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { LaunchdServiceManager } from "../src/launchd.js";

describe("per-user launchd service", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("writes login/restart lifecycle and uses the GUI user domain", async () => {
    const homeDir = join(tmpdir(), `launchd-${randomUUID()}`);
    roots.push(homeDir);
    const calls: string[][] = [];
    const manager = new LaunchdServiceManager({
      homeDir,
      uid: 501,
      run: async (...args) => {
        calls.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    await manager.install({
      label: "org.coding-agent-observability.relay",
      programArguments: ["/opt/node", "/opt/relay cli.js", "run"],
      environment: { SAFE: "a&b" },
      standardOutPath: join(homeDir, "relay.out"),
      standardErrorPath: join(homeDir, "relay.err"),
    });
    const plist = await readFile(manager.plistPath, "utf8");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("/opt/relay cli.js");
    expect(plist).toContain("a&amp;b");

    await manager.start();
    expect(await manager.status()).toBe("running");
    await manager.stop();
    expect(calls).toEqual([
      ["bootstrap", "gui/501", manager.plistPath],
      ["kickstart", "-k", "gui/501/org.coding-agent-observability.relay"],
      ["print", "gui/501/org.coding-agent-observability.relay"],
      ["print", "gui/501/org.coding-agent-observability.relay"],
      ["bootout", "gui/501/org.coding-agent-observability.relay"],
    ]);
  });
});
