import { randomUUID } from "node:crypto";

import postgres from "postgres";

export function createTestDatabase(prefix: string) {
  const adminDatabaseUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://localhost/postgres";
  const databaseName = `${prefix.slice(0, 28)}_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(adminDatabaseUrl);
  databaseUrl.pathname = `/${databaseName}`;

  const admin = postgres(adminDatabaseUrl, { max: 1 });

  return {
    admin,
    databaseName,
    databaseUrl: databaseUrl.toString(),
    async create() {
      await admin.unsafe(`create database "${databaseName}"`);
    },
    async drop() {
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    },
  };
}
