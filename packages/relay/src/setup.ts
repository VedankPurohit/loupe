import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { browserSessionCookieName } from "@workspace/contracts";

export const lifecycleEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export interface RelayServiceSpec {
  label: string;
  programArguments: string[];
  environment: Record<string, string>;
  standardOutPath: string;
  standardErrorPath: string;
}

export interface RelayServiceManager {
  install(spec: RelayServiceSpec): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  remove(): Promise<void>;
  status(): Promise<"running" | "stopped" | "missing">;
}

interface FileSnapshot {
  path: string;
  existed: boolean;
  contentBase64: string;
  beforeHash: string;
  appliedHash: string;
}

export interface MacosSetupPreview {
  codexHome: string;
  stateDir: string;
  serverUrl: string;
  nodePath: string;
  relayCliPath: string;
  otlpPort: number;
  files: Array<{ path: string; action: "create" | "merge" }>;
  disclosures: string[];
  before: { config: string | null; hooks: string | null };
  proposed: { config: string; hooks: string };
}

export interface SetupState {
  version: 1;
  /** Actual installed Codex CLI version, or "unknown" when undetectable. */
  codexVersion?: string;
  codexHome: string;
  stateDir: string;
  serverUrl: string;
  deviceId: string;
  credential: string | null;
  fingerprintKey: string;
  policy: {
    version: number;
    ordinaryRedactionEnabled: boolean;
    demoCanaryEnabled: boolean;
  };
  files: FileSnapshot[];
  service: RelayServiceSpec;
}

const setupStateName = "setup-state.json";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function requireSecureServerUrl(value: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error("SERVER_URL_INVALID: server URL must use HTTP or HTTPS.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("SERVER_URL_INVALID: server URL must use HTTP or HTTPS.");
  }
  if (parsedUrl.protocol === "http:" && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error(
      "SERVER_URL_INSECURE: HTTPS is required unless the server is localhost, 127.0.0.1, or ::1.",
    );
  }
  return parsedUrl;
}

async function optionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function mergeConfig(existing: string | null, endpoint: string): string {
  const base = existing ?? "";
  if (/^\s*\[otel\]\s*$/m.test(base)) {
    throw new Error(
      "CODEX_CONFIG_CONFLICT: existing [otel] configuration must be merged manually before setup.",
    );
  }
  if (/^\s*hooks\s*=\s*/m.test(base) && !/^\s*hooks\s*=\s*true\s*$/m.test(base)) {
    throw new Error(
      "CODEX_CONFIG_CONFLICT: existing hooks feature is explicitly disabled.",
    );
  }
  const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
  const featureBlock = /^\s*\[features\]\s*$/m.test(base)
    ? /^\s*hooks\s*=\s*true\s*$/m.test(base)
      ? ""
      : "\n[features]\nhooks = true\n"
    : "\n[features]\nhooks = true\n";
  // A second [features] table would be invalid TOML. Insert the key directly
  // after the existing table header instead.
  const withFeature = /^\s*\[features\]\s*$/m.test(base) && featureBlock
    ? base.replace(/(^\s*\[features\]\s*$)/m, "$1\nhooks = true")
    : base + separator + featureBlock;
  return `${withFeature.endsWith("\n") ? withFeature : `${withFeature}\n`}\n# coding-agent-observability managed capture\n[otel]\nenvironment = "coding-agent-observability"\nlog_user_prompt = false\nexporter = { otlp-http = { endpoint = "${endpoint}/v1/logs", protocol = "json" } }\ntrace_exporter = { otlp-http = { endpoint = "${endpoint}/v1/traces", protocol = "json" } }\nmetrics_exporter = "none"\n`;
}

function mergeHooks(existing: string | null, command: string): string {
  let document: { hooks: Record<string, unknown[]> } = { hooks: {} };
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (!parsed || typeof parsed !== "object" || !("hooks" in parsed)) throw new Error();
      const hooks = (parsed as { hooks?: unknown }).hooks;
      if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error();
      document = parsed as { hooks: Record<string, unknown[]> };
    } catch {
      throw new Error("CODEX_HOOKS_CONFLICT: hooks.json is not a supported hooks object.");
    }
  }
  for (const event of lifecycleEvents) {
    const entries = document.hooks[event] ?? [];
    if (!Array.isArray(entries)) {
      throw new Error(`CODEX_HOOKS_CONFLICT: hooks.${event} must be an array.`);
    }
    const managed = { hooks: [{ type: "command", command, timeout: 10 }] };
    document.hooks[event] = [...entries, managed];
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function previewMacosSetup(options: {
  codexHome: string;
  stateDir: string;
  serverUrl?: string;
  nodePath: string;
  relayCliPath: string;
  otlpPort?: number;
}): Promise<MacosSetupPreview> {
  const serverUrl = options.serverUrl ?? "http://127.0.0.1:3000";
  const parsedUrl = requireSecureServerUrl(serverUrl);
  const configPath = join(options.codexHome, "config.toml");
  const hooksPath = join(options.codexHome, "hooks.json");
  const before = {
    config: await optionalText(configPath),
    hooks: await optionalText(hooksPath),
  };
  const otlpPort = options.otlpPort ?? 4318;
  const endpoint = `http://127.0.0.1:${otlpPort}`;
  const hookCommand = [
    shellQuote(options.nodePath),
    shellQuote(options.relayCliPath),
    "hook",
    "--state-dir",
    shellQuote(options.stateDir),
  ].join(" ");
  return {
    ...options,
    serverUrl: parsedUrl.toString().replace(/\/$/, ""),
    otlpPort,
    before,
    proposed: {
      config: mergeConfig(before.config, endpoint),
      hooks: mergeHooks(before.hooks, hookCommand),
    },
    files: [
      { path: configPath, action: before.config === null ? "create" : "merge" },
      { path: hooksPath, action: before.hooks === null ? "create" : "merge" },
      { path: join(options.stateDir, setupStateName), action: "create" },
    ],
    disclosures: [
      "Captured Codex content is visible to all Organization members.",
      `Capture is delivered to ${parsedUrl.toString().replace(/\/$/, "")}.`,
      "The ordinary high-confidence redaction is enabled by default; it is conservative, not comprehensive.",
      "The Demo redaction canary is disabled by default and is independent from ordinary redaction.",
      `Setup changes ${configPath}, ${hooksPath}, and ${join(options.stateDir, setupStateName)}.`,
      "Setup installs a per-user launchd service that starts at login and restarts after failure.",
    ],
  };
}

async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

const execFileAsync = promisify(execFile);

/**
 * Detects the installed Codex CLI version so captured evidence carries the
 * real producer version instead of an assumed one. Returns "unknown" when the
 * binary is missing or its output is unrecognizable; the adapter then
 * downgrades rather than fabricating validated fidelity.
 */
export async function detectCodexCliVersion(options?: {
  codexPath?: string;
}): Promise<string> {
  try {
    const { stdout } = await execFileAsync(options?.codexPath ?? "codex", ["--version"], {
      timeout: 10_000,
    });
    const match = stdout.match(/codex-cli\s+(\d+\.\d+\.\d+\S*)/);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function applyMacosSetup(options: {
  preview: MacosSetupPreview;
  enrollment: { credential: string; deviceId: string };
  serviceManager: RelayServiceManager;
  verifyDelivery: () => Promise<boolean>;
  codexVersion?: string;
}): Promise<void> {
  const { preview } = options;
  const paths = [join(preview.codexHome, "config.toml"), join(preview.codexHome, "hooks.json")];
  const current = await Promise.all(paths.map(optionalText));
  if (current[0] !== preview.before.config || current[1] !== preview.before.hooks) {
    throw new Error("SETUP_PREVIEW_STALE: Codex configuration changed after preview.");
  }
  await mkdir(preview.codexHome, { recursive: true });
  await mkdir(preview.stateDir, { recursive: true });
  await writeFile(paths[0], preview.proposed.config);
  await writeFile(paths[1], preview.proposed.hooks);
  const service: RelayServiceSpec = {
    label: "org.coding-agent-observability.relay",
    programArguments: [
      preview.nodePath,
      preview.relayCliPath,
      "run",
      "--state-dir",
      preview.stateDir,
      "--otlp-port",
      String(preview.otlpPort),
    ],
    environment: { NODE_NO_WARNINGS: "1" },
    standardOutPath: join(preview.stateDir, "relay.stdout.log"),
    standardErrorPath: join(preview.stateDir, "relay.stderr.log"),
  };
  const state: SetupState = {
    version: 1,
    codexVersion: options.codexVersion ?? (await detectCodexCliVersion()),
    codexHome: preview.codexHome,
    stateDir: preview.stateDir,
    serverUrl: preview.serverUrl,
    deviceId: options.enrollment.deviceId,
    credential: options.enrollment.credential,
    fingerprintKey: randomBytes(32).toString("base64url"),
    policy: {
      version: 1,
      ordinaryRedactionEnabled: true,
      demoCanaryEnabled: false,
    },
    files: paths.map((path, index) => ({
      path,
      existed: current[index] !== null,
      contentBase64: Buffer.from(current[index] ?? "").toString("base64"),
      beforeHash: digest(current[index] ?? ""),
      appliedHash: digest(index === 0 ? preview.proposed.config : preview.proposed.hooks),
    })),
    service,
  };
  await writePrivate(join(preview.stateDir, setupStateName), `${JSON.stringify(state, null, 2)}\n`);
  try {
    await options.serviceManager.install(service);
    await options.serviceManager.start();
    if (!(await options.verifyDelivery())) {
      throw new Error("SETUP_VERIFICATION_FAILED: relay test event was not acknowledged.");
    }
  } catch (error) {
    await uninstallMacosSetup({ stateDir: preview.stateDir, serviceManager: options.serviceManager });
    throw error;
  }
}

export async function readSetupState(stateDir: string): Promise<SetupState> {
  return JSON.parse(await readFile(join(stateDir, setupStateName), "utf8")) as SetupState;
}

export async function writeSetupState(state: SetupState): Promise<void> {
  await writePrivate(
    join(state.stateDir, setupStateName),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export async function disconnectMacosSetup(options: {
  stateDir: string;
  browserSession: string;
  serviceManager: RelayServiceManager;
  fetch?: typeof globalThis.fetch;
}): Promise<void> {
  await revokeMacosSetupCredential(options);
  await options.serviceManager.stop();
}

export async function revokeMacosSetupCredential(options: {
  stateDir: string;
  browserSession: string;
  fetch?: typeof globalThis.fetch;
}): Promise<void> {
  const state = await readSetupState(options.stateDir);
  requireSecureServerUrl(state.serverUrl);
  if (state.credential) {
    const response = await (options.fetch ?? globalThis.fetch)(
      `${state.serverUrl}/api/v1/devices/${encodeURIComponent(state.deviceId)}/revoke`,
      {
        method: "POST",
        headers: {
          cookie: `${browserSessionCookieName}=${options.browserSession}`,
        },
      },
    );
    if (response.status !== 204) {
      throw new Error(`DEVICE_REVOCATION_HTTP_${response.status}`);
    }
    state.credential = null;
    await writeSetupState(state);
  }
}

export async function uninstallMacosSetup(options: {
  stateDir: string;
  serviceManager: RelayServiceManager;
  beforeServiceStop?: () => Promise<void>;
}): Promise<void> {
  const state = await readSetupState(options.stateDir);
  const currentFiles = await Promise.all(
    state.files.map(async (snapshot) => ({ snapshot, current: await optionalText(snapshot.path) })),
  );
  for (const { snapshot, current } of currentFiles) {
    if (digest(current ?? "") !== snapshot.appliedHash) {
      throw new Error(
        `UNINSTALL_CONFIG_CHANGED: refusing to overwrite changes in ${snapshot.path}.`,
      );
    }
  }
  await options.beforeServiceStop?.();
  await options.serviceManager.stop();
  await options.serviceManager.remove();
  for (const { snapshot } of currentFiles) {
    if (snapshot.existed) {
      await writeFile(snapshot.path, Buffer.from(snapshot.contentBase64, "base64"));
    } else {
      await rm(snapshot.path, { force: true });
    }
  }
  await rm(options.stateDir, { recursive: true, force: true });
}
