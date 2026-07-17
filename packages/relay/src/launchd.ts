import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RelayServiceManager, RelayServiceSpec } from "./setup.js";

type RunLaunchctl = (...args: string[]) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plist(spec: RelayServiceSpec): string {
  const argumentsXml = spec.programArguments
    .map((argument) => `    <string>${xml(argument)}</string>`)
    .join("\n");
  const environmentXml = Object.entries(spec.environment)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(spec.standardOutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(spec.standardErrorPath)}</string>
</dict>
</plist>
`;
}

export class LaunchdServiceManager implements RelayServiceManager {
  readonly plistPath: string;
  readonly #uid: number;
  readonly #run: RunLaunchctl;
  #label = "org.coding-agent-observability.relay";

  constructor(options: {
    homeDir: string;
    uid?: number;
    run?: RunLaunchctl;
  }) {
    this.#uid = options.uid ?? process.getuid?.() ?? 0;
    this.plistPath = join(
      options.homeDir,
      "Library",
      "LaunchAgents",
      "org.coding-agent-observability.relay.plist",
    );
    this.#run = options.run ?? (async (...args) => execFileAsync("launchctl", args));
  }

  #domain(): string {
    return `gui/${this.#uid}`;
  }

  #serviceTarget(): string {
    return `${this.#domain()}/${this.#label}`;
  }

  async install(spec: RelayServiceSpec): Promise<void> {
    this.#label = spec.label;
    await mkdir(join(this.plistPath, ".."), { recursive: true });
    await writeFile(this.plistPath, plist(spec), { mode: 0o644 });
  }

  async start(): Promise<void> {
    await this.#run("bootstrap", this.#domain(), this.plistPath);
    await this.#run("kickstart", "-k", this.#serviceTarget());
  }

  async stop(): Promise<void> {
    if ((await this.status()) !== "running") return;
    try {
      await this.#run("bootout", this.#serviceTarget());
    } catch (error) {
      if ((await this.status()) === "running") throw error;
    }
  }

  async remove(): Promise<void> {
    await rm(this.plistPath, { force: true });
  }

  async status(): Promise<"running" | "stopped" | "missing"> {
    try {
      await this.#run("print", this.#serviceTarget());
      return "running";
    } catch {
      try {
        const { access } = await import("node:fs/promises");
        await access(this.plistPath);
        return "stopped";
      } catch {
        return "missing";
      }
    }
  }
}
