import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { PostgresDriver } from "../../../src/drivers/postgres";
import type { PostgresQueryResult } from "../../../src/drivers/postgres/types";

/**
 * A harness for a Postgres server this process did NOT start.
 *
 * `startPostgresHarness` owns its container: it may drop whatever it is handed
 * and it stops the server on teardown. Neither is safe against a developer's
 * running instance, which may hold databases that matter. This harness is the
 * conservative counterpart, and the constraints are the point of the file:
 *
 * 1. It connects to ONE dedicated database, named by the caller. It never
 *    issues `CREATE DATABASE` or `DROP DATABASE` — creating the database is a
 *    deliberate act performed outside the test run.
 * 2. It drops only tables it is explicitly given, and every test here confines
 *    itself to a `local_mig_*` prefix.
 * 3. Teardown disconnects. It does not stop, restart, or otherwise touch the
 *    server.
 *
 * Connection settings come from the environment so that no credentials are
 * committed, and so pointing this at a different instance never requires an
 * edit to a test file.
 */
export type LocalPostgresHarnessOptions = {
  /** Data source name in the registry. Defaults to `"local-pg-test"`. */
  readonly dataSourceName?: string;
  /** Register as the default data source. Defaults to `true`. */
  readonly isDefault?: boolean;
  /** Log SQL. Defaults to `false`. */
  readonly logging?: boolean;
};

export type LocalPostgresHarness = {
  readonly driver: PostgresDriver;
  readonly dataSource: DataSource;
  /** Run raw parameterised SQL against the dedicated test database. */
  readonly query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<PostgresQueryResult<T>>;
  /** Drop the named tables if they exist. Pass only tables the test created. */
  readonly dropTables: (...tables: string[]) => Promise<void>;
  /** Disconnect and clear the registry. Does NOT stop the server. */
  readonly stop: () => Promise<void>;
};

/**
 * Read a required environment variable, failing loudly rather than defaulting.
 *
 * A default here would silently point the suite at some other database — most
 * likely `postgres` itself — and the whole purpose of this harness is that it
 * only ever touches one nominated throwaway database.
 */
function requireEnvironmentValue(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(
      `${key} is not set. The local Postgres suite refuses to guess a connection target; ` +
        `set ${key} (and its siblings) before running it.`,
    );
  }

  return value;
}

/**
 * Whether the local Postgres suite has been given somewhere to connect.
 *
 * Used to skip rather than fail on a machine that has no local server — the
 * suite is a proof for whoever has one, not a requirement for everyone.
 */
export function hasLocalPostgres(): boolean {
  return Boolean(process.env.LOCAL_PG_DATABASE && process.env.LOCAL_PG_USER);
}

export async function startLocalPostgresHarness(
  options: LocalPostgresHarnessOptions = {},
): Promise<LocalPostgresHarness> {
  const database = requireEnvironmentValue("LOCAL_PG_DATABASE");
  const user = requireEnvironmentValue("LOCAL_PG_USER");
  const password = requireEnvironmentValue("LOCAL_PG_PASSWORD");
  const host = process.env.LOCAL_PG_HOST ?? "127.0.0.1";
  const port = process.env.LOCAL_PG_PORT ?? "5432";

  const driver = new PostgresDriver({
    connectionString: `postgres://${user}:${password}@${host}:${port}/${database}`,
    database,
    logging: options.logging ?? false,
  });

  await driver.connect();

  // Assert we are where we think we are before anything writes. A misdirected
  // connection string is the one mistake that could reach a real database.
  const current = await driver.query<{ current_database: string }>("SELECT current_database()");
  const connectedTo = current.rows[0]?.current_database;

  if (connectedTo !== database) {
    await driver.disconnect();
    throw new Error(`Expected to connect to "${database}" but landed on "${connectedTo}".`);
  }

  const dataSource = new DataSource({
    name: options.dataSourceName ?? "local-pg-test",
    driver,
    isDefault: options.isDefault ?? true,
  });

  dataSourceRegistry.register(dataSource);

  return {
    driver,
    dataSource,
    query: (sql, params = []) => driver.query(sql, params),
    dropTables: async (...tables: string[]) => {
      for (const table of tables) {
        await driver.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      }
    },
    stop: async () => {
      await driver.disconnect();
      dataSourceRegistry.clear();
    },
  };
}
