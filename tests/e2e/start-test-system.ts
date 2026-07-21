import { spawn } from "node:child_process";
import { createServer } from "node:http";

import postgres from "postgres";

import { getE2eDatabaseConfig } from "./test-database.js";
import {
  googleFixturePublicJwk,
} from "./google-auth-fixture.js";

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

const googleJwksPort = Number(process.env.TEST_GOOGLE_JWKS_PORT ?? "3456");
const googleJwksServer = createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "public, max-age=300",
  });
  response.end(JSON.stringify({ keys: [googleFixturePublicJwk] }));
});
await new Promise<void>((resolve) =>
  googleJwksServer.listen(googleJwksPort, "127.0.0.1", resolve),
);

const child = spawn("pnpm", ["dev"], {
  env: {
    ...process.env,
    BOOTSTRAP_CODE: "bootstrap_playwright_0123456789abcdefghijklmnopqrstuvwxyz",
    DATABASE_URL: databaseUrl,
    PORT: process.env.TEST_SERVER_PORT ?? "3000",
    WEB_PORT: process.env.TEST_WEB_PORT ?? "5173",
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${process.env.TEST_SERVER_PORT ?? "3000"}`,
    GOOGLE_WEB_CLIENT_ID: "loupe-playwright.apps.googleusercontent.com",
    GOOGLE_AUTH_ALLOWED_ORIGINS: `http://127.0.0.1:${process.env.TEST_WEB_PORT ?? "5173"}`,
    GOOGLE_AUTH_DEVELOPMENT_JWKS_URL: `http://127.0.0.1:${googleJwksPort}/jwks`,
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
  await new Promise<void>((resolve, reject) =>
    googleJwksServer.close((error) => (error ? reject(error) : resolve())),
  );
  await admin.end();
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
child.on("exit", (code) => {
  if (!stopping) process.exit(code ?? 1);
});
