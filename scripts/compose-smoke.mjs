import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { request as playwrightRequest } from "@playwright/test";

const root = new URL("..", import.meta.url);
const projectName = `agent-observer-smoke-${process.pid}`;
const sessionId = `session-compose-${randomUUID()}`;
const eventId = randomUUID();

function report(phase, details = {}) {
  process.stdout.write(`${JSON.stringify({ phase, ...details })}\n`);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port assigned.");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(
        `${executable} ${args.join(" ")} exited ${code}\n${stdout}${stderr}`,
      );
      error.exitCode = code;
      reject(error);
    });
  });
}

async function jsonRequest(baseUrl, path, { expected = 200, ...init } = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => undefined);
  if (response.status !== expected) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return { body, response };
}

async function browserJsonRequest(browser, path, { expected = 200, ...init } = {}) {
  const response = await browser.fetch(path, init);
  const body = await response.json().catch(() => undefined);
  if (response.status() !== expected) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: expected ${expected}, got ${response.status()}: ${JSON.stringify(body)}`,
    );
  }
  return { body, response };
}

function redactCredentials(value) {
  return value
    .replace(
      /\b(bootstrap|device|analysis)_[A-Za-z0-9_-]{43,}\b/g,
      "$1_[REDACTED]",
    )
    .replace(
      /\benroll_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}\b/g,
      "enroll_[REDACTED]",
    );
}

async function waitForHealth(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // The container may still be replacing its listening socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Health did not recover within ${timeoutMs}ms.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [appPort, webPort] = await Promise.all([availablePort(), availablePort()]);
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const composeArgs = ["compose", "--project-name", projectName];
const { BOOTSTRAP_CODE: _ignoredBootstrapCode, ...hostEnvironment } = process.env;
const composeEnv = {
  ...hostEnvironment,
  APP_PORT: String(appPort),
  WEB_PORT: String(webPort),
  GOOGLE_WEB_CLIENT_ID: "compose-smoke.apps.googleusercontent.com",
  GOOGLE_AUTH_ALLOWED_ORIGINS: webBaseUrl,
};
let started = false;
let browser;

async function compose(...args) {
  return command("docker", [...composeArgs, ...args], { env: composeEnv });
}

async function cleanup() {
  await browser?.dispose().catch(() => undefined);
  if (!started) return;
  await compose("down", "--volumes", "--remove-orphans").catch(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
}

try {
  report("preflight");
  await command("docker", ["info", "--format", "{{.ServerVersion}}"]);
  await command("docker", ["compose", "version"]);
  await compose("config", "--quiet");

  // A unique project name guarantees this journey begins with empty volumes.
  started = true;
  await compose("down", "--volumes", "--remove-orphans");
  report("build-and-start", { appPort, webPort });
  await compose("up", "--build", "--wait");
  browser = await playwrightRequest.newContext({ baseURL: webBaseUrl });
  const appLogs = await compose("logs", "--no-color", "app");
  const bootstrapCode = appLogs.stdout.match(/bootstrap_[A-Za-z0-9_-]{43,}/)?.[0];
  assert(
    bootstrapCode,
    "The first packaged startup did not emit a redeemable Bootstrap code in app logs.",
  );

  report("health-and-contract");
  const health = await jsonRequest(appBaseUrl, "/api/v1/health");
  assert(
    health.body.status === "ok" && health.body.apiVersion === "v1",
    "The packaged API health contract drifted.",
  );
  const openApiBefore = await jsonRequest(appBaseUrl, "/api/v1/openapi.json");
  assert(openApiBefore.body.openapi === "3.0.3", "OpenAPI 3.0.3 was not served.");
  assert(
    openApiBefore.body.paths?.["/api/v1/device/source-event-batches"],
    "Packaged OpenAPI is missing the source-event ingestion route.",
  );
  const web = await fetch(webBaseUrl);
  const webHtml = await web.text();
  assert(web.ok && webHtml.includes('id="root"'), "Production web assets were not served.");
  const guide = await fetch(`${webBaseUrl}/guide.html`);
  const guideHtml = await guide.text();
  assert(
    guide.ok && /Loupe/i.test(guideHtml),
    "The packaged public setup guide was not served.",
  );
  const proxiedHealth = await jsonRequest(webBaseUrl, "/api/v1/health");
  assert(proxiedHealth.body.status === "ok", "The web /api reverse proxy is unhealthy.");
  const googleTransaction = await jsonRequest(
    webBaseUrl,
    "/api/v1/auth/google/transactions",
    {
      method: "POST",
      expected: 201,
      headers: { origin: webBaseUrl },
    },
  );
  assert(
    googleTransaction.body.clientId === composeEnv.GOOGLE_WEB_CLIENT_ID,
    "The packaged API did not expose its configured public Google client ID.",
  );

  report("public-browser-enrollment-ingest-query");
  const bootstrap = await browserJsonRequest(browser, "/api/v1/bootstrap/redeem", {
    method: "POST",
    expected: 201,
    data: {
      code: bootstrapCode,
      organization: { name: "Compose Smoke Organization" },
      administrator: { displayName: "Compose Administrator" },
    },
  });
  assert(bootstrap.body.member.role === "administrator", "Bootstrap did not authenticate the browser.");
  const callback = "http://127.0.0.1:43191/callback";
  const authorizationPath = `/api/v1/device-enrollment/authorize?deviceName=${encodeURIComponent("Compose Smoke Device")}&callback=${encodeURIComponent(callback)}&state=${randomUUID()}`;
  const authorizationPreview = await browser.get(authorizationPath);
  const authorizationPreviewHtml = await authorizationPreview.text();
  assert(
    authorizationPreview.ok() &&
      !authorizationPreviewHtml.includes('name="grant"'),
    "The packaged browser authorization preview was not safe or available.",
  );
  const authorization = await browser.post(authorizationPath);
  const authorizationHtml = await authorization.text();
  const enrollmentGrant = /name="grant" value="([^"]+)"/.exec(
    authorizationHtml,
  )?.[1];
  assert(
    authorization.ok() && enrollmentGrant,
    "The packaged browser authorization did not issue a Device enrollment handoff.",
  );
  const enrollment = await jsonRequest(
    appBaseUrl,
    "/api/v1/device-enrollments/redeem",
    {
      method: "POST",
      expected: 201,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: enrollmentGrant }),
    },
  );

  const rawPayload = {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    turn_id: "turn-compose-1",
    source: "startup",
    model: "gpt-compose-smoke",
  };
  const event = {
    schemaVersion: "1",
    id: eventId,
    deduplicationKey: `sha256:${createHash("sha256").update(eventId).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(rawPayload))
      .digest("hex")}`,
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5", event: "SessionStart" },
    parser: { name: "codex-agent-adapter", version: "1.0.0" },
    occurredAt: "2026-07-17T12:00:00.000Z",
    capturedAt: "2026-07-17T12:00:00.010Z",
    capturePath: "hook:SessionStart",
    rawPayload,
    canonicalObservations: [],
    adapter: { status: "adapted", capabilities: {} },
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  };
  const delivery = await jsonRequest(
    appBaseUrl,
    "/api/v1/device/source-event-batches",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${enrollment.body.credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batchId: randomUUID(), events: [event] }),
    },
  );
  assert(
    delivery.body.results?.[0]?.status === "accepted",
    "The packaged API did not accept the source event.",
  );
  const eventBefore = await browserJsonRequest(browser, `/api/v1/source-events/${eventId}`);
  assert(eventBefore.body.id === eventId, "Accepted source evidence was not queryable.");
  const activityBefore = await browserJsonRequest(
    browser,
    `/api/v1/organization/activity?q=${encodeURIComponent(sessionId)}`,
  );
  assert(
    activityBefore.body.items?.some((item) => item.id === sessionId),
    "The projected Session was not queryable before restart.",
  );

  report("restart-and-verify-persistence", { sessionId });
  await compose("restart", "app");
  await waitForHealth(appBaseUrl);
  const eventAfter = await browserJsonRequest(browser, `/api/v1/source-events/${eventId}`);
  assert(eventAfter.body.id === eventId, "Source evidence was lost across restart.");
  const activityAfter = await browserJsonRequest(
    browser,
    `/api/v1/organization/activity?q=${encodeURIComponent(sessionId)}`,
  );
  assert(
    activityAfter.body.items?.some((item) => item.id === sessionId),
    "The same Session was not retained across restart.",
  );
  const openApiAfter = await jsonRequest(appBaseUrl, "/api/v1/openapi.json");
  assert(
    JSON.stringify(openApiAfter.body) === JSON.stringify(openApiBefore.body),
    "The OpenAPI contract changed across packaged restart.",
  );

  report("replace-and-verify-upgrade", { sessionId });
  await compose(
    "up",
    "--build",
    "--wait",
    "--force-recreate",
    "--no-deps",
    "app",
    "web",
  );
  const activityAfterReplacement = await browserJsonRequest(
    browser,
    `/api/v1/organization/activity?q=${encodeURIComponent(sessionId)}`,
  );
  assert(
    activityAfterReplacement.body.items?.some((item) => item.id === sessionId),
    "The same Session was not retained after application image replacement.",
  );
  const eventAfterReplacement = await browserJsonRequest(
    browser,
    `/api/v1/source-events/${eventId}`,
  );
  assert(
    eventAfterReplacement.body.id === eventId,
    "Source evidence was lost after application image replacement.",
  );

  report("passed", { appBaseUrl, webBaseUrl, sessionId, eventId });
} catch (error) {
  const diagnostics = started
    ? await Promise.all([
        compose("ps", "--all").catch((failure) => ({ stdout: failure.message })),
        compose("logs", "--no-color", "--tail", "200").catch((failure) => ({
          stdout: failure.message,
        })),
      ])
    : [];
  report("failed", {
    error: redactCredentials(error instanceof Error ? error.message : String(error)),
    diagnostics: diagnostics.map(({ stdout, stderr }) =>
      redactCredentials(`${stdout ?? ""}${stderr ?? ""}`),
    ),
  });
  process.exitCode = 1;
} finally {
  await cleanup();
}
