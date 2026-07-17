import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getE2eDatabaseConfig } from "../../../tests/e2e/test-database.js";

describe("Playwright PostgreSQL configuration", () => {
  it("preserves a non-default administrative connection for setup and teardown", () => {
    const config = getE2eDatabaseConfig({
      TEST_DATABASE_ADMIN_URL:
        "postgresql://test_operator:secret@db.example.test:5544/postgres?sslmode=require&application_name=ticket01",
    });

    expect(config).toEqual({
      adminDatabaseUrl:
        "postgresql://test_operator:secret@db.example.test:5544/postgres?sslmode=require&application_name=ticket01",
      databaseName: "agent_observer_playwright",
      databaseUrl:
        "postgresql://test_operator:secret@db.example.test:5544/agent_observer_playwright?sslmode=require&application_name=ticket01",
    });
  });

  it("supports the documented Node 22 runtime line", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { engines?: { node?: string } };

    expect(packageJson.engines?.node).toBe(">=22.22.3 <23");
  });
});
