import { migrateDatabase } from "@workspace/database";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. See README.md for the native PostgreSQL quickstart.",
  );
}

await migrateDatabase(databaseUrl);

const app = await buildApp({
  bootstrapCode: process.env.BOOTSTRAP_CODE,
  databaseUrl,
  onBootstrapCode: (code) => {
    process.stdout.write(
      `\nBootstrap code (shown once; redeem it in the browser):\n${code}\n\n`,
    );
  },
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
await app.listen({ host, port });
process.stdout.write(`Server listening at http://${host}:${port}\n`);
