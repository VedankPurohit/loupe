import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyMacosSetup,
  disconnectMacosSetup,
  lifecycleEvents,
  previewMacosSetup,
  uninstallMacosSetup,
  verifyCodexHookTrust,
  type RelayServiceManager,
} from "../src/setup.js";

class FakeServiceManager implements RelayServiceManager {
  actions: string[] = [];

  async install(): Promise<void> { this.actions.push("install"); }
  async start(): Promise<void> { this.actions.push("start"); }
  async stop(): Promise<void> { this.actions.push("stop"); }
  async remove(): Promise<void> { this.actions.push("remove"); }
  async status(): Promise<"running" | "stopped" | "missing"> { return "running"; }
}

describe("reversible macOS setup", () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("previews without mutation, merges supported hooks, and restores exact prior files", async () => {
    const root = join(tmpdir(), `relay-setup-${randomUUID()}`);
    roots.push(root);
    const codexHome = join(root, "codex");
    const stateDir = join(root, "state");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(codexHome, { recursive: true });
    const originalConfig = 'model = "gpt-5.6-sol"\n';
    const originalHooks = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-stop" }] }] },
    }, null, 2) + "\n";
    await writeFile(join(codexHome, "config.toml"), originalConfig);
    await writeFile(join(codexHome, "hooks.json"), originalHooks);

    const serviceManager = new FakeServiceManager();
    const preview = await previewMacosSetup({
      codexHome,
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      nodePath: process.execPath,
      relayCliPath: "/tmp/relay-cli.js",
    });

    expect(preview.disclosures).toEqual(expect.arrayContaining([
      expect.stringContaining("Organization members"),
      expect.stringContaining("ordinary high-confidence redaction is enabled"),
      expect.stringContaining("Demo redaction canary is disabled"),
      expect.stringContaining("http://127.0.0.1:3000"),
      expect.stringContaining("launchd"),
    ]));
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(originalConfig);
    expect(await readFile(join(codexHome, "hooks.json"), "utf8")).toBe(originalHooks);

    await applyMacosSetup({
      preview,
      enrollment: {
        credential: `device_${"a".repeat(48)}`,
        deviceId: "11111111-1111-4111-8111-111111111111",
      },
      serviceManager,
      verifyDelivery: async () => true,
      verifyHookTrust: async () => true,
    });

    const mergedHooks = JSON.parse(await readFile(join(codexHome, "hooks.json"), "utf8"));
    expect(mergedHooks.hooks.Stop).toHaveLength(2);
    expect(mergedHooks.hooks.SessionStart).toHaveLength(1);
    expect(serviceManager.actions).toEqual(["install", "start"]);

    await disconnectMacosSetup({
      stateDir,
      browserSession: "browser_test",
      serviceManager,
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          "http://127.0.0.1:3000/api/v1/devices/11111111-1111-4111-8111-111111111111/revoke",
        );
        expect(init?.headers).toEqual({ cookie: "browser_session=browser_test" });
        return new Response(null, { status: 204 });
      },
    });
    expect(serviceManager.actions).toEqual(["install", "start", "stop"]);

    await uninstallMacosSetup({ stateDir, serviceManager });
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(originalConfig);
    expect(await readFile(join(codexHome, "hooks.json"), "utf8")).toBe(originalHooks);
    expect(serviceManager.actions).toEqual(["install", "start", "stop", "stop", "remove"]);
  });

  it("rejects cleartext delivery to a non-loopback server", async () => {
    const root = join(tmpdir(), `relay-setup-${randomUUID()}`);
    roots.push(root);

    await expect(
      previewMacosSetup({
        codexHome: join(root, "codex"),
        stateDir: join(root, "state"),
        serverUrl: "http://observability.example.test:3000",
        nodePath: process.execPath,
        relayCliPath: "/tmp/relay-cli.js",
      }),
    ).rejects.toThrow(
      "SERVER_URL_INSECURE: HTTPS is required unless the server is localhost, 127.0.0.1, or ::1.",
    );
  });

  it("rolls back when Codex has not trusted the installed capture hooks", async () => {
    const root = join(tmpdir(), `relay-setup-${randomUUID()}`);
    roots.push(root);
    const codexHome = join(root, "codex");
    const stateDir = join(root, "state");
    const serviceManager = new FakeServiceManager();
    const preview = await previewMacosSetup({
      codexHome,
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      nodePath: process.execPath,
      relayCliPath: "/tmp/relay-cli.js",
    });

    await expect(
      applyMacosSetup({
        preview,
        enrollment: {
          credential: `device_${"a".repeat(48)}`,
          deviceId: "11111111-1111-4111-8111-111111111111",
        },
        serviceManager,
        verifyDelivery: async () => true,
        verifyHookTrust: async () => false,
      }),
    ).rejects.toThrow(
      "SETUP_HOOK_TRUST_REQUIRED: review and trust the installed hooks in Codex, then rerun setup.",
    );
    await expect(readFile(join(codexHome, "config.toml"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(codexHome, "hooks.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(serviceManager.actions).toEqual(["install", "start", "stop", "remove"]);
  });

  it("detects untrusted installed hooks through Codex's hooks/list contract", async () => {
    const root = join(tmpdir(), `relay-setup-${randomUUID()}`);
    roots.push(root);
    const codexHome = join(root, "codex");
    const stateDir = join(root, "state");
    const preview = await previewMacosSetup({
      codexHome,
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      nodePath: process.execPath,
      relayCliPath: "/tmp/relay-cli.js",
    });
    const fakeCodex = join(root, "fake-codex.cjs");
    const sourcePath = join(codexHome, "hooks.json");
    await mkdir(root, { recursive: true });
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node
const readline = require("node:readline");
const events = ${JSON.stringify(lifecycleEvents)};
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "fake" } }) + "\\n");
  }
  if (message.method === "hooks/list") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        data: [{
          cwd: message.params.cwds[0],
          hooks: events.map((eventName) => ({
            eventName,
            sourcePath: ${JSON.stringify(sourcePath)},
            command: ${JSON.stringify(preview.hookCommand)},
            enabled: true,
            trustStatus: "untrusted"
          })),
          warnings: [],
          errors: []
        }]
      }
    }) + "\\n");
  }
});
`,
    );
    await chmod(fakeCodex, 0o700);

    await expect(
      verifyCodexHookTrust({
        codexPath: fakeCodex,
        codexHome,
        cwd: root,
        expectedSourcePath: sourcePath,
        expectedCommand: preview.hookCommand,
      }),
    ).resolves.toBe(false);
  });

  it("validates every managed file before disabling launchd during uninstall", async () => {
    const root = join(tmpdir(), `relay-setup-${randomUUID()}`);
    roots.push(root);
    const codexHome = join(root, "codex");
    const stateDir = join(root, "state");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(codexHome, { recursive: true });
    await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.6-sol"\n');
    await writeFile(join(codexHome, "hooks.json"), '{"hooks": {}}\n');
    const serviceManager = new FakeServiceManager();
    const preview = await previewMacosSetup({
      codexHome,
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      nodePath: process.execPath,
      relayCliPath: "/tmp/relay-cli.js",
    });
    await applyMacosSetup({
      preview,
      enrollment: {
        credential: `device_${"a".repeat(48)}`,
        deviceId: "11111111-1111-4111-8111-111111111111",
      },
      serviceManager,
      verifyDelivery: async () => true,
      verifyHookTrust: async () => true,
    });
    serviceManager.actions = [];
    await writeFile(join(codexHome, "hooks.json"), '{"hooks": {"Stop": []}}\n');

    await expect(
      uninstallMacosSetup({
        stateDir,
        serviceManager,
        beforeServiceStop: async () => {
          serviceManager.actions.push("revoke");
        },
      }),
    ).rejects.toThrow("UNINSTALL_CONFIG_CHANGED");
    expect(serviceManager.actions).toEqual([]);
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(
      preview.proposed.config,
    );
  });
});
