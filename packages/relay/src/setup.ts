import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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
  hookCommand: string;
  otlpPort: number;
  files: Array<{ path: string; action: "create" | "merge" | "install" }>;
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
  /** Exact command whose Codex hook trust must be re-verified on every setup run. */
  hookCommand?: string;
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
    hookCommand,
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
      { path: options.relayCliPath, action: "install" },
      {
        path: join(
          homedir(),
          "Library",
          "LaunchAgents",
          "org.coding-agent-observability.relay.plist",
        ),
        action: "install",
      },
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

interface HooksListResponse {
  data?: Array<{
    hooks?: Array<{
      eventName?: string;
      sourcePath?: string;
      command?: string | null;
      enabled?: boolean;
      trustStatus?: "managed" | "untrusted" | "trusted" | "modified";
    }>;
  }>;
}

export interface CodexHookTrustInspectionOptions {
  codexHome: string;
  cwd: string;
  expectedSourcePath: string;
  expectedCommand: string;
  codexPath?: string;
  timeoutMs?: number;
}

export async function inspectCodexHookTrust(
  options: CodexHookTrustInspectionOptions,
): Promise<"trusted" | "managed" | undefined> {
  const child = spawn(options.codexPath ?? "codex", ["app-server"], {
    env: { ...process.env, CODEX_HOME: options.codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  const responses = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    for (const pending of responses.values()) pending.reject(error);
    responses.clear();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf("\n");
      if (newline < 0) break;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof message.id !== "number") continue;
        const pending = responses.get(message.id);
        if (!pending) continue;
        responses.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(message.error.message ?? "Codex app-server request failed."),
          );
        } else {
          pending.resolve(message.result);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  child.on("error", fail);
  child.on("exit", (code) => {
    if (responses.size > 0) {
      fail(
        new Error(
          `Codex app-server exited with status ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    }
  });

  const request = (id: number, method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      responses.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const timer = setTimeout(
    () => fail(new Error("Codex app-server hook inspection timed out.")),
    options.timeoutMs ?? 10_000,
  );
  try {
    await request(1, "initialize", {
      clientInfo: {
        name: "coding_agent_observability",
        title: "Coding Agent Observability Setup",
        version: "1.0.0",
      },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    const result = (await request(2, "hooks/list", {
      cwds: [options.cwd],
    })) as HooksListResponse;
    const installedHooks = (result.data ?? []).flatMap((entry) => entry.hooks ?? []).filter(
      (hook) =>
        hook.sourcePath === options.expectedSourcePath &&
        hook.command === options.expectedCommand,
    );
    const safe =
      installedHooks.length === lifecycleEvents.length &&
      lifecycleEvents.every(
        (eventName) =>
          installedHooks.filter((hook) => hook.eventName === eventName).length === 1,
      ) &&
      installedHooks.every(
        (hook) =>
          hook.enabled === true &&
          (hook.trustStatus === "trusted" || hook.trustStatus === "managed"),
      );
    if (!safe) return undefined;
    return installedHooks.every((hook) => hook.trustStatus === "managed")
      ? "managed"
      : "trusted";
  } catch (error) {
    throw new Error(
      `CODEX_HOOK_TRUST_INSPECTION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    settled = true;
    clearTimeout(timer);
    responses.clear();
    child.kill();
  }
}

export async function verifyCodexHookTrust(
  options: CodexHookTrustInspectionOptions,
): Promise<boolean> {
  return (await inspectCodexHookTrust(options)) !== undefined;
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
  verifyHookTrust: () => Promise<boolean>;
  rollbackEnrollment: () => Promise<void>;
  installRuntime?: () => Promise<void>;
  codexVersion?: string;
}): Promise<void> {
  const { preview } = options;
  const paths = [join(preview.codexHome, "config.toml"), join(preview.codexHome, "hooks.json")];
  let current: Array<string | null> | undefined;
  let localFilesApplied = false;
  let stateRecorded = false;
  try {
    current = await Promise.all(paths.map(optionalText));
    if (current[0] !== preview.before.config || current[1] !== preview.before.hooks) {
      throw new Error("SETUP_PREVIEW_STALE: Codex configuration changed after preview.");
    }
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
      hookCommand: preview.hookCommand,
      fingerprintKey: randomBytes(32).toString("base64url"),
      policy: {
        version: 1,
        ordinaryRedactionEnabled: true,
        demoCanaryEnabled: false,
      },
      files: paths.map((path, index) => ({
        path,
        existed: current![index] !== null,
        contentBase64: Buffer.from(current![index] ?? "").toString("base64"),
        beforeHash: digest(current![index] ?? ""),
        appliedHash: digest(index === 0 ? preview.proposed.config : preview.proposed.hooks),
      })),
      service,
    };
    await mkdir(preview.codexHome, { recursive: true });
    await mkdir(preview.stateDir, { recursive: true });
    localFilesApplied = true;
    await writeFile(paths[0], preview.proposed.config);
    await writeFile(paths[1], preview.proposed.hooks);
    await writePrivate(join(preview.stateDir, setupStateName), `${JSON.stringify(state, null, 2)}\n`);
    stateRecorded = true;
    await options.installRuntime?.();
    await options.serviceManager.install(service);
    await options.serviceManager.start();
    if (!(await options.verifyHookTrust())) {
      throw new Error(
        "SETUP_HOOK_TRUST_REQUIRED: review and trust the installed hooks in Codex, then rerun setup.",
      );
    }
    if (!(await options.verifyDelivery())) {
      throw new Error("SETUP_VERIFICATION_FAILED: relay test event was not acknowledged.");
    }
  } catch (error) {
    let rollbackFailure: unknown;
    try {
      await options.rollbackEnrollment();
    } catch (rollbackError) {
      rollbackFailure = rollbackError;
    }
    if (stateRecorded) {
      try {
        await uninstallMacosSetup({ stateDir: preview.stateDir, serviceManager: options.serviceManager });
      } catch (rollbackError) {
        rollbackFailure ??= rollbackError;
      }
    } else if (localFilesApplied && current) {
      try {
        const applied = [preview.proposed.config, preview.proposed.hooks];
        for (let index = 0; index < paths.length; index += 1) {
          const onDisk = await optionalText(paths[index]!);
          if (onDisk === current[index]) continue;
          if (onDisk !== applied[index]) {
            throw new Error(
              `SETUP_ROLLBACK_CONFIG_CHANGED: refusing to overwrite concurrent changes in ${paths[index]}.`,
            );
          }
          if (current[index] === null) await rm(paths[index]!, { force: true });
          else await writeFile(paths[index]!, current[index]!);
        }
        await rm(join(preview.stateDir, setupStateName), { force: true });
      } catch (rollbackError) {
        rollbackFailure ??= rollbackError;
      }
    }
    if (rollbackFailure) {
      throw new Error(
        `SETUP_ROLLBACK_FAILED: setup failed (${error instanceof Error ? error.message : String(error)}); rollback failed (${rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure)}).`,
      );
    }
    throw error;
  }
}

/** Copies the bundled CLI away from a package cache or source checkout. */
export async function installRelayRuntime(options: {
  sourcePath: string;
  installedPath: string;
}): Promise<void> {
  await mkdir(dirname(options.installedPath), { recursive: true });
  await copyFile(options.sourcePath, options.installedPath);
  await chmod(options.installedPath, 0o700);
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

/**
 * Idempotent public setup seam. It proves the managed files are unchanged and
 * the exact installed hook command remains trusted before reporting success or
 * restarting a stopped per-user relay.
 */
export async function ensureMacosSetupHealthy(options: {
  stateDir: string;
  serviceManager: RelayServiceManager;
  verifyHookTrust: (state: SetupState) => Promise<boolean>;
  verifyDelivery: (state: SetupState) => Promise<boolean>;
}): Promise<"healthy" | "restarted"> {
  const state = await readSetupState(options.stateDir);
  if (!state.credential) {
    throw new Error(
      "SETUP_DISCONNECTED: uninstall the disconnected integration before enrolling again.",
    );
  }
  if (!state.hookCommand) {
    throw new Error(
      "SETUP_HOOK_TRUST_REQUIRED: installed state lacks exact hook trust metadata; uninstall and run setup again.",
    );
  }
  for (const snapshot of state.files) {
    const current = await optionalText(snapshot.path);
    if (digest(current ?? "") !== snapshot.appliedHash) {
      throw new Error(
        `SETUP_CONFIG_CHANGED: managed Codex configuration changed in ${snapshot.path}; restore or uninstall before setup.`,
      );
    }
  }
  if (!(await options.verifyHookTrust(state))) {
    throw new Error(
      "SETUP_HOOK_TRUST_REQUIRED: the installed hooks are modified, disabled, or untrusted; review Codex hook trust before retrying.",
    );
  }
  const running = (await options.serviceManager.status()) === "running";
  if (!running) {
    await options.serviceManager.install(state.service);
    await options.serviceManager.start();
  }
  if (!(await options.verifyDelivery(state))) {
    throw new Error(
      "SETUP_VERIFICATION_FAILED: relay delivery and Device diagnostics could not be reverified.",
    );
  }
  return running ? "healthy" : "restarted";
}

export async function disconnectMacosSetup(options: {
  stateDir: string;
  browserAuthorization: () => Promise<void>;
  serviceManager: RelayServiceManager;
}): Promise<void> {
  await options.browserAuthorization();
  const state = await readSetupState(options.stateDir);
  state.credential = null;
  await writeSetupState(state);
  await options.serviceManager.stop();
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
