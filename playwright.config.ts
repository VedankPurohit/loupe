import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.TEST_WEB_PORT ?? "5173";
const serverPort = process.env.TEST_SERVER_PORT ?? "3000";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // The harness provisions exactly one server and one bootstrap-once database
  // (tests/e2e/start-test-system.ts), so specs share global state. fullyParallel
  // only serializes within a file; a single worker serializes across files too,
  // preventing cross-spec Organization/bootstrap collisions.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec tsx tests/e2e/start-test-system.ts",
    reuseExistingServer: false,
    timeout: 60_000,
    url: `http://127.0.0.1:${serverPort}/api/v1/health`,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
