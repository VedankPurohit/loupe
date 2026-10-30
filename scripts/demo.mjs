#!/usr/bin/env node
// One-command demo mode for first-time evaluators.
//
// Resets a dedicated, disposable PostgreSQL database, launches the full stack
// with the hard-gated demo auto-login enabled, bootstraps a seeded "OpenAI"
// Organization through the real public API, imports both Example packs, and
// opens the browser already signed in. No Google credentials, no Bootstrap
// code to copy, no forms. This path is for trying Loupe out, not development.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiOrigin = "http://127.0.0.1:3000";
const webOrigin = "http://127.0.0.1:5173";
const demoDatabaseName = "agent_observer_demo";
const organizationName = "OpenAI";
const administratorDisplayName = "Demo Administrator";
const examplePacks = ["starter-v1", "rich-v1"];

const adminDatabaseUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://localhost/postgres";
const demoDatabaseUrl = new URL(adminDatabaseUrl);
demoDatabaseUrl.pathname = `/${demoDatabaseName}`;

const log = (message) => process.stdout.write(`\n[demo] ${message}\n`);
const fail = (message) => {
  process.stderr.write(`\n[demo] ${message}\n`);
  process.exit(1);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isPortBusy(origin) {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function resetDemoDatabase() {
  log(`Resetting the disposable demo database "${demoDatabaseName}" (fresh every run)...`);
  const admin = postgres(adminDatabaseUrl, { max: 1 });
  try {
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${demoDatabaseName}' and pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`drop database if exists "${demoDatabaseName}"`);
    await admin.unsafe(`create database "${demoDatabaseName}"`);
  } finally {
    await admin.end();
  }
}

async function waitForHealth() {
  log("Building packages, running migrations, and starting the server...");
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiOrigin}/api/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(1500);
  }
  throw new Error("Server did not become healthy in time.");
}

async function waitForWeb() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${webOrigin}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error("Vite web application did not become reachable in time.");
}

async function bootstrapAndSeed(bootstrapCode) {
  log(`Creating the seeded "${organizationName}" Organization...`);
  const redeem = await fetch(`${apiOrigin}/api/v1/bootstrap/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: bootstrapCode,
      organization: { name: organizationName },
      administrator: { displayName: administratorDisplayName },
    }),
  });
  if (redeem.status !== 201) {
    throw new Error(
      `Bootstrap redemption failed (${redeem.status}): ${await redeem.text()}`,
    );
  }
  const cookie = (redeem.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";", 1)[0])
    .find((entry) => entry.startsWith("browser_session="));
  if (!cookie) throw new Error("Bootstrap redemption did not return a session cookie.");

  for (const version of examplePacks) {
    log(`Importing the "${version}" Example pack...`);
    const imported = await fetch(
      `${apiOrigin}/api/v1/administration/example-packs/${version}/import`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    if (!imported.ok) {
      throw new Error(
        `Importing "${version}" failed (${imported.status}): ${await imported.text()}`,
      );
    }
    const { counts } = await imported.json();
    log(
      `Imported "${version}": ${counts.sessions} Sessions, ${counts.turns} Turns, ${counts.members} members.`,
    );
  }
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Best effort; the URL is always printed below.
  }
}

async function main() {
  if (await isPortBusy(apiOrigin)) {
    fail(
      `Port 3000 is already in use. Stop any running dev server first ` +
        `(check: lsof -iTCP:3000 -sTCP:LISTEN), then re-run pnpm demo.`,
    );
  }

  await resetDemoDatabase();

  const bootstrapCode = `bootstrap_${randomBytes(36).toString("base64url")}`;
  const loginUrl = `${apiOrigin}/api/v1/dev/demo-login`;

  const child = spawn("pnpm", ["dev"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: demoDatabaseUrl.toString(),
      DEMO_MODE: "1",
      // Surfaces demo mode to the web app so the "Include clearly labelled
      // Seeded examples" view defaults on and the seeded data is visible
      // immediately instead of hiding behind the toggle.
      VITE_DEMO_MODE: "1",
      // Open a fully-populated showcase Session by default (model, tokens, cost
      // estimate, tools, repository) instead of the newest, sparser Session.
      VITE_DEMO_SESSION_ID: "seeded-rich-v1-ledger-a11y-00",
      DEMO_WEB_URL: `${webOrigin}/`,
      BOOTSTRAP_CODE: bootstrapCode,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: "3000",
    },
  });

  let shuttingDown = false;
  const stop = (signal) => {
    shuttingDown = true;
    if (!child.killed) child.kill(signal ?? "SIGTERM");
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("exit", (code) => {
    if (!shuttingDown) process.exit(code ?? 0);
  });

  try {
    await waitForHealth();
    await bootstrapAndSeed(bootstrapCode);
    await waitForWeb();
  } catch (error) {
    process.stderr.write(
      `\n[demo] Setup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stderr.write(
      `[demo] Leaving the server running so you can inspect the error above. Press Ctrl-C to stop.\n`,
    );
    return;
  }

  openBrowser(loginUrl);
  log(
    `Demo ready. You are signed in to "${organizationName}" as an Administrator.\n` +
      `        If the browser did not open, visit: ${loginUrl}\n` +
      `        Seeded example Sessions are shown once you enable the\n` +
      `        "Include clearly labelled Seeded examples" toggle.\n` +
      `        Press Ctrl-C to stop the demo.`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
