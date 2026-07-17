export const e2eDatabaseName = "agent_observer_playwright";

export function getE2eDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const adminDatabaseUrl =
    environment.TEST_DATABASE_ADMIN_URL ?? "postgresql://localhost/postgres";
  const databaseUrl = new URL(adminDatabaseUrl);
  databaseUrl.pathname = `/${e2eDatabaseName}`;

  return {
    adminDatabaseUrl,
    databaseName: e2eDatabaseName,
    databaseUrl: databaseUrl.toString(),
  };
}
