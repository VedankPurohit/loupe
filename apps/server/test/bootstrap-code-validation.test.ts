import { describe, expect, it } from "vitest";

import { migrateDatabase } from "@workspace/database";

import { buildApp } from "../src/app.js";
import { createTestDatabase } from "./test-database.js";

describe.sequential("injected Bootstrap-code startup validation", () => {
  it.each(["", "x"])(
    "rejects an insufficient production credential before persistence (%j)",
    async (bootstrapCode) => {
      const testDatabase = createTestDatabase("bootstrap_validation");
      let app: Awaited<ReturnType<typeof buildApp>> | undefined;

      try {
        await testDatabase.create();
        await migrateDatabase(testDatabase.databaseUrl);

        let startupError: unknown;
        try {
          app = await buildApp({
            bootstrapCode,
            databaseUrl: testDatabase.databaseUrl,
          });
        } catch (error) {
          startupError = error;
        }
        expect(startupError).toMatchObject({
          message:
            'BOOTSTRAP_CODE must start with "bootstrap_" and contain at least 43 URL-safe characters after the prefix.',
        });

        let generatedCode: string | undefined;
        app = await buildApp({
          databaseUrl: testDatabase.databaseUrl,
          onBootstrapCode: (code) => {
            generatedCode = code;
          },
        });
        expect(generatedCode).toMatch(/^bootstrap_[A-Za-z0-9_-]{43}$/);
      } finally {
        await app?.close();
        await testDatabase.drop();
      }
    },
  );
});
