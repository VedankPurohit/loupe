import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const root = new URL("../", import.meta.url);
const execFileAsync = promisify(execFile);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("the packaged web build includes the public guide", async () => {
  const dockerfile = await read("Dockerfile");

  assert.match(
    dockerfile,
    /^COPY apps\/web\/public apps\/web\/public$/m,
    "the container build must copy Vite public assets before building the web app",
  );
});

test("Compose passes provider-neutral public Google authentication configuration", async () => {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "config", "--format", "json"],
    {
      cwd: root,
      env: {
        ...process.env,
        GOOGLE_WEB_CLIENT_ID: "public-client-id.apps.googleusercontent.com",
        GOOGLE_AUTH_ALLOWED_ORIGINS: "http://127.0.0.1:8080",
      },
    },
  );
  const configuration = JSON.parse(stdout);
  const environment = configuration.services.app.environment;

  assert.equal(
    environment.GOOGLE_WEB_CLIENT_ID,
    "public-client-id.apps.googleusercontent.com",
  );
  assert.equal(
    environment.GOOGLE_AUTH_ALLOWED_ORIGINS,
    "http://127.0.0.1:8080",
  );
  assert.equal(environment.GOOGLE_CLIENT_SECRET, undefined);

  const {
    GOOGLE_AUTH_ALLOWED_ORIGINS: _ignoredAllowedOrigins,
    ...environmentWithoutGoogleOrigin
  } = process.env;
  const derived = await execFileAsync(
    "docker",
    ["compose", "config", "--format", "json"],
    {
      cwd: root,
      env: { ...environmentWithoutGoogleOrigin, WEB_PORT: "9090" },
    },
  );
  assert.equal(
    JSON.parse(derived.stdout).services.app.environment
      .GOOGLE_AUTH_ALLOWED_ORIGINS,
    "http://127.0.0.1:9090",
  );
});

test("the Vercel build seam renders a same-origin API rewrite and SPA fallback", async () => {
  const outputName = `test-output-${process.pid}`;
  const outputDirectory = fileURLToPath(new URL(`../.vercel/${outputName}`, import.meta.url));
  try {
    await execFileAsync(
      process.execPath,
      [
        "scripts/build-vercel-frontend.mjs",
        "--test-output-name",
        outputName,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          LOUPE_API_ORIGIN: "https://api.loupe.invalid",
        },
      },
    );
    const configuration = JSON.parse(
      await readFile(join(outputDirectory, "config.json"), "utf8"),
    );

    assert.deepEqual(configuration, {
      version: 3,
      routes: [
        {
          src: "^/api/(.*)$",
          dest: "https://api.loupe.invalid/api/$1",
        },
        { handle: "filesystem" },
        { src: "^/.*$", dest: "/index.html" },
      ],
    });
    await readFile(join(outputDirectory, "static", "index.html"), "utf8");
    await readFile(join(outputDirectory, "static", "guide.html"), "utf8");
    const vercelProject = JSON.parse(await read("vercel.json"));
    assert.equal(vercelProject.buildCommand, "pnpm build:vercel");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("the deferred production guide names every unfulfilled launch requirement", async () => {
  const guide = await read("docs/deferred-production-deployment.md");

  for (const requirement of [
    "stable owned domains",
    "managed PostgreSQL",
    "HTTPS",
    "separate production Google Cloud project",
    "public homepage and privacy policy",
    "backups",
    "launch operations",
  ]) {
    assert.match(guide, new RegExp(requirement, "i"));
  }
  assert.match(guide, /deployment and provider\s+selection remain deferred/i);
});

test("the production investigation guide describes the evidence-ledger contract", async () => {
  const guide = await read("docs/production-investigation-interface.md");

  assert.doesNotMatch(guide, /activity field|execution topology/i);
  assert.match(guide, /Organization activity/);
  assert.match(guide, /Session ledger/);
  assert.match(guide, /evidence inspector/i);
  assert.match(guide, /Open Memory/i);
});

test("the Compose smoke journey covers public auth configuration and browser-authorized enrollment", async () => {
  const smokeJourney = await read("scripts/compose-smoke.mjs");

  assert.match(smokeJourney, /\/api\/v1\/auth\/google\/transactions/);
  assert.match(smokeJourney, /\/guide\.html/);
  assert.match(smokeJourney, /\/api\/v1\/device-enrollment\/authorize/);
  assert.doesNotMatch(smokeJourney, /\/api\/v1\/device-enrollment-grants/);
  assert.doesNotMatch(smokeJourney, /set-cookie|browserCookie/);
});
