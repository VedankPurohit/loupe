import postgres from "postgres";

import { getE2eDatabaseConfig } from "./test-database.js";

export default async function globalTeardown() {
  const { adminDatabaseUrl, databaseName } = getE2eDatabaseConfig();
  const admin = postgres(adminDatabaseUrl, { max: 1 });
  try {
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
    );
    await admin.unsafe(`drop database if exists "${databaseName}"`);
  } finally {
    await admin.end();
  }
}
