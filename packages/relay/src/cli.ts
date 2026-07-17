#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";

import {
  DeviceEnrollmentGrantResponseSchema,
  DeviceEnrollmentResponseSchema,
  ExecutionSessionDetailResponseSchema,
  browserSessionCookieName,
} from "@workspace/contracts";

import { openDeliveryQueue } from "./index.js";
import { LaunchdServiceManager } from "./launchd.js";
import {
  deliverPendingOnce,
  recordCodexPayload,
  recordSetupVerification,
  runRelayDaemon,
} from "./runtime.js";
import {
  applyMacosSetup,
  disconnectMacosSetup,
  previewMacosSetup,
  readSetupState,
  requireSecureServerUrl,
  revokeMacosSetupCredential,
  uninstallMacosSetup,
  verifyCodexHookTrust,
} from "./setup.js";

const defaultStateDir = join(
  homedir(),
  "Library",
  "Application Support",
  "coding-agent-observability-relay",
);

const usage = `Usage:
  coding-agent-relay setup [--server-url URL] [--browser-session-file PATH|-] [--device-name NAME] [--codex-home PATH] [--state-dir PATH] [--yes]
  coding-agent-relay disconnect [--browser-session-file PATH|-] [--state-dir PATH]
  coding-agent-relay uninstall [--browser-session-file PATH|-] [--state-dir PATH]
  coding-agent-relay status [--state-dir PATH]
  coding-agent-relay checkpoint [--browser-session-file PATH|-] --session-id ID [--web-url URL] [--state-dir PATH]

Credential input:
  CODING_AGENT_OBSERVABILITY_BROWSER_SESSION  Browser Session value for automation
  --browser-session-file PATH                 Read it from a 0600 file (or stdin with -)

Internal service commands:
  coding-agent-relay run --state-dir PATH [--otlp-port PORT]
  coding-agent-relay hook --state-dir PATH`;

const legacySecretFlag = "--browser-session";

function rejectSecretArguments(args: string[]): void {
  if (
    args.some(
      (argument) =>
        argument === legacySecretFlag || argument.startsWith(`${legacySecretFlag}=`),
    )
  ) {
    throw new Error(
      "SECRET_ARG_REJECTED: --browser-session is unsafe because process arguments may be visible. Use CODING_AGENT_OBSERVABILITY_BROWSER_SESSION, --browser-session-file PATH (mode 0600), or --browser-session-file - for stdin.",
    );
  }
}

async function readSecretInput(path: string): Promise<string> {
  let content: string;
  if (path === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    content = Buffer.concat(chunks).toString("utf8");
  } else {
    const metadata = await stat(path);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new Error(
        "SECRET_FILE_PERMISSIONS: browser Session file must be a regular file readable only by its owner (mode 0600).",
      );
    }
    content = await readFile(path, "utf8");
  }
  const secret = content.trim();
  if (!secret) throw new Error("SECRET_INPUT_EMPTY: browser Session input was empty.");
  return secret;
}

async function browserSession(options: Map<string, string | true>): Promise<string> {
  const file = options.get("--browser-session-file");
  if (typeof file === "string") return readSecretInput(file);
  const environment = process.env.CODING_AGENT_OBSERVABILITY_BROWSER_SESSION?.trim();
  if (environment) return environment;
  throw new Error(
    "BROWSER_SESSION_REQUIRED: set CODING_AGENT_OBSERVABILITY_BROWSER_SESSION or use --browser-session-file PATH (mode 0600) or - for stdin.",
  );
}

function flags(args: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    if (flag === "--yes") {
      result.set(flag, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    result.set(flag, value);
    index += 1;
  }
  return result;
}

function value(options: Map<string, string | true>, name: string, fallback?: string): string {
  const found = options.get(name) ?? fallback;
  if (typeof found !== "string" || found.length === 0) throw new Error(`${name} is required.`);
  return found;
}

async function enroll(options: {
  serverUrl: string;
  browserSession: string;
  deviceName: string;
}): Promise<{ credential: string; deviceId: string }> {
  const grantResponse = await fetch(`${options.serverUrl}/api/v1/device-enrollment-grants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${browserSessionCookieName}=${options.browserSession}`,
    },
    body: JSON.stringify({ deviceName: options.deviceName }),
  });
  if (!grantResponse.ok) throw new Error(`ENROLLMENT_GRANT_HTTP_${grantResponse.status}`);
  const grant = DeviceEnrollmentGrantResponseSchema.parse(await grantResponse.json());
  const redeemResponse = await fetch(`${options.serverUrl}/api/v1/device-enrollments/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant: grant.grant }),
  });
  if (!redeemResponse.ok) throw new Error(`ENROLLMENT_REDEEM_HTTP_${redeemResponse.status}`);
  const enrollment = DeviceEnrollmentResponseSchema.parse(await redeemResponse.json());
  return { credential: enrollment.credential, deviceId: enrollment.device.id };
}

async function setup(args: string[]): Promise<void> {
  if (process.platform !== "darwin") throw new Error("MACOS_REQUIRED: setup currently supports macOS only.");
  const options = flags(args);
  const stateDir = value(options, "--state-dir", defaultStateDir);
  const serverUrl = value(options, "--server-url", "http://127.0.0.1:3000").replace(/\/$/, "");
  requireSecureServerUrl(serverUrl);
  try {
    const installed = await readSetupState(stateDir);
    if (installed.serverUrl !== serverUrl) {
      throw new Error(
        `SETUP_ALREADY_INSTALLED: disconnect and uninstall before changing server URL from ${installed.serverUrl}.`,
      );
    }
    const manager = new LaunchdServiceManager({ homeDir: homedir() });
    if ((await manager.status()) !== "running" && installed.credential) {
      await manager.install(installed.service);
      await manager.start();
    }
    process.stdout.write("Setup already applied; configuration was left unchanged.\n");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const preview = await previewMacosSetup({
    codexHome: value(options, "--codex-home", process.env.CODEX_HOME ?? join(homedir(), ".codex")),
    stateDir,
    serverUrl,
    nodePath: process.execPath,
    relayCliPath: fileURLToPath(import.meta.url),
  });
  process.stdout.write("Capture setup preview (no changes applied):\n");
  for (const disclosure of preview.disclosures) process.stdout.write(`- ${disclosure}\n`);
  for (const file of preview.files) process.stdout.write(`- ${file.action}: ${file.path}\n`);
  if (!options.has("--yes")) {
    process.stdout.write("\nReview the preview, then rerun with --yes to consent and apply.\n");
    return;
  }
  const browserSessionValue = await browserSession(options);
  const enrollment = await enroll({
    serverUrl,
    browserSession: browserSessionValue,
    deviceName: value(options, "--device-name", `Mac ${homedir().split("/").at(-1) ?? "device"}`),
  });
  const manager = new LaunchdServiceManager({ homeDir: homedir() });
  await applyMacosSetup({
    preview,
    enrollment,
    serviceManager: manager,
    verifyHookTrust: () =>
      verifyCodexHookTrust({
        codexHome: preview.codexHome,
        cwd: process.cwd(),
        expectedSourcePath: join(preview.codexHome, "hooks.json"),
        expectedCommand: preview.hookCommand,
      }),
    verifyDelivery: async () => {
      const eventIds = await recordSetupVerification({ stateDir });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await deliverPendingOnce({ stateDir }).catch(() => undefined);
        const queue = openDeliveryQueue({ databasePath: join(stateDir, "relay.sqlite") });
        const pending = queue.pending().some(({ event }) => eventIds.includes(event.id));
        queue.close();
        if (!pending) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    },
  });
  process.stdout.write("Setup complete: relay installed, started, and test delivery acknowledged.\n");
}

async function disconnect(args: string[]): Promise<void> {
  const options = flags(args);
  await disconnectMacosSetup({
    stateDir: value(options, "--state-dir", defaultStateDir),
    browserSession: await browserSession(options),
    serviceManager: new LaunchdServiceManager({ homeDir: homedir() }),
  });
  process.stdout.write("Disconnected: delivery credential revoked; accepted server history was preserved.\n");
}

async function uninstall(args: string[]): Promise<void> {
  const options = flags(args);
  const stateDir = value(options, "--state-dir", defaultStateDir);
  const manager = new LaunchdServiceManager({ homeDir: homedir() });
  const state = await readSetupState(stateDir);
  const browserSessionValue = state.credential ? await browserSession(options) : undefined;
  await uninstallMacosSetup({
    stateDir,
    serviceManager: manager,
    beforeServiceStop: browserSessionValue
      ? () =>
          revokeMacosSetupCredential({
            stateDir,
            browserSession: browserSessionValue,
          })
      : undefined,
  });
  process.stdout.write("Uninstalled: launchd service and managed Codex capture changes removed; server history preserved.\n");
}

async function status(args: string[]): Promise<void> {
  const options = flags(args);
  const stateDir = value(options, "--state-dir", defaultStateDir);
  const state = await readSetupState(stateDir);
  const manager = new LaunchdServiceManager({ homeDir: homedir() });
  const queue = openDeliveryQueue({ databasePath: join(stateDir, "relay.sqlite") });
  const pending = queue.pending();
  queue.close();
  process.stdout.write(`${JSON.stringify({
    service: await manager.status(),
    serverUrl: state.serverUrl,
    deviceId: state.deviceId,
    connected: state.credential !== null,
    policy: state.policy,
    pending: pending.filter(({ state: queueState }) => queueState === "pending").length,
    poisoned: pending.filter(({ state: queueState }) => queueState === "poisoned").length,
  }, null, 2)}\n`);
}

async function hook(args: string[]): Promise<void> {
  const options = flags(args);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  await recordCodexPayload({
    stateDir: value(options, "--state-dir"),
    source: "codex_hook",
    producerEvent: typeof payload.hook_event_name === "string" ? payload.hook_event_name : "unknown",
    payload,
  });
}

async function run(args: string[]): Promise<void> {
  const options = flags(args);
  await runRelayDaemon({
    stateDir: value(options, "--state-dir"),
    port: Number(value(options, "--otlp-port", "4318")),
  });
}

async function checkpoint(args: string[]): Promise<void> {
  const options = flags(args);
  const stateDir = value(options, "--state-dir", defaultStateDir);
  const state = await readSetupState(stateDir);
  const sessionId = value(options, "--session-id");
  const browserSessionValue = await browserSession(options);
  const service = await new LaunchdServiceManager({ homeDir: homedir() }).status();
  if (service !== "running") throw new Error(`CHECKPOINT_SERVICE_${service.toUpperCase()}`);
  const queue = openDeliveryQueue({ databasePath: join(stateDir, "relay.sqlite") });
  const pending = queue.pending();
  queue.close();
  if (pending.some(({ state: queueState }) => queueState === "pending")) {
    throw new Error("CHECKPOINT_DELIVERY_PENDING");
  }
  const detailResponse = await fetch(
    `${state.serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { cookie: `${browserSessionCookieName}=${browserSessionValue}` } },
  );
  if (!detailResponse.ok) throw new Error(`CHECKPOINT_SESSION_HTTP_${detailResponse.status}`);
  const detail = ExecutionSessionDetailResponseSchema.parse(await detailResponse.json());
  const webUrl = value(options, "--web-url", "http://127.0.0.1:5173");
  const webResponse = await fetch(webUrl);
  if (!webResponse.ok) throw new Error(`CHECKPOINT_BROWSER_HTTP_${webResponse.status}`);
  process.stdout.write(`${JSON.stringify({
    checkpoint: "passed",
    service,
    sqliteQueue: "drained",
    postgresAndCanonicalApi: "queried",
    sessionId: detail.session.id,
    turns: detail.turns.length,
    agentRuns: detail.agentRuns.length,
    browser: webUrl,
    cli: "this checkpoint used the same /api/v1 Session detail contract",
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  rejectSecretArguments(args);
  if (command === "setup") return setup(args);
  if (command === "disconnect") return disconnect(args);
  if (command === "uninstall") return uninstall(args);
  if (command === "status") return status(args);
  if (command === "hook") return hook(args);
  if (command === "run") return run(args);
  if (command === "checkpoint") return checkpoint(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
  process.exitCode = 1;
});
