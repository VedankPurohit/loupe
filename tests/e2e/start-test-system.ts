import { spawn } from "node:child_process";

import postgres from "postgres";

import { getE2eDatabaseConfig } from "./test-database.js";

const { adminDatabaseUrl, databaseName, databaseUrl } = getE2eDatabaseConfig();
const admin = postgres(adminDatabaseUrl, { max: 1 });

async function dropDatabase() {
  await admin.unsafe(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
  );
  await admin.unsafe(`drop database if exists "${databaseName}"`);
}

await dropDatabase();
await admin.unsafe(`create database "${databaseName}"`);

const child = spawn("pnpm", ["dev"], {
  env: {
    ...process.env,
    BOOTSTRAP_CODE: "bootstrap_playwright_0123456789abcdefghijklmnopqrstuvwxyz",
    DATABASE_URL: databaseUrl,
  },
  stdio: "inherit",
});

let stopping = false;
async function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await dropDatabase();
  await admin.end();
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
child.on("exit", (code) => {
  if (!stopping) process.exit(code ?? 1);
});
