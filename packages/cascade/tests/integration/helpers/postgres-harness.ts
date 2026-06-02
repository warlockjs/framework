import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { PostgresDriver } from "../../../src/drivers/postgres";
import type { PostgresQueryResult } from "../../../src/drivers/postgres/types";

/**
 * Default Postgres image. Pinned to alpine for a small, fast pull. Matches the
 * image proven by `scripts/testcontainers-smoke.ts`.
 */
const DEFAULT_POSTGRES_IMAGE = "postgres:16-alpine";

/**
 * Options for spinning up a Postgres integration harness.
 */
export type PostgresHarnessOptions = {
  /** Docker image tag to run. Defaults to `postgres:16-alpine`. */
  image?: string;
  /** Name registered for the data source. Defaults to `"pg-test"`. */
  dataSourceName?: string;
  /** Whether the registered data source is the default one. Defaults to `true`. */
  isDefault?: boolean;
  /** Enable cascade's SQL query logging. Defaults to `false` (quiet test output). */
  logging?: boolean;
};

/**
 * A live Postgres test harness: a running container, a connected cascade
 * `PostgresDriver` + `DataSource` registered in the global registry, plus
 * helpers to run raw SQL and tear everything down.
 *
 * Every field is what an integration test actually touches — there is no hidden
 * lifecycle. Call `stop()` once in `afterAll`.
 */
export type PostgresHarness = {
  /** The started testcontainers Postgres instance. */
  container: StartedPostgreSqlContainer;
  /** The connected cascade PostgreSQL driver. */
  driver: PostgresDriver;
  /** The registered cascade data source wrapping the driver. */
  dataSource: DataSource;
  /**
   * Run a raw parameterized SQL statement against the live database. Use this
   * for DDL (CREATE TABLE) in test setup and for direct assertions that bypass
   * the model layer.
   */
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<PostgresQueryResult<T>>;
  /**
   * Drop the given tables (if they exist) so each test starts from a clean
   * slate. Pass the tables the test created; order does not matter because
   * `CASCADE` resolves dependencies.
   */
  dropTables: (...tables: string[]) => Promise<void>;
  /** Disconnect the driver, clear the registry, and stop the container. */
  stop: () => Promise<void>;
};

/**
 * Start a real Postgres container, connect a cascade data source to it, and
 * register that data source as the default so `Model` subclasses resolve to it
 * automatically.
 *
 * The first call is slow (~50s) because Docker pulls the image and boots the
 * server; subsequent runs reuse the cached image. Always pair it with `stop()`
 * in `afterAll`.
 *
 * @example
 * ```typescript
 * let harness: PostgresHarness;
 *
 * beforeAll(async () => {
 *   harness = await startPostgresHarness();
 *   await harness.query(`
 *     CREATE TABLE users (
 *       id SERIAL PRIMARY KEY,
 *       name TEXT NOT NULL,
 *       created_at TIMESTAMPTZ,
 *       updated_at TIMESTAMPTZ
 *     )
 *   `);
 * });
 *
 * afterAll(async () => {
 *   await harness.stop();
 * });
 *
 * class User extends Model {
 *   static table = "users";
 * }
 *
 * const user = await User.create({ name: "Alice" });
 * ```
 */
export async function startPostgresHarness(
  options: PostgresHarnessOptions = {},
): Promise<PostgresHarness> {
  const image = options.image ?? DEFAULT_POSTGRES_IMAGE;
  const dataSourceName = options.dataSourceName ?? "pg-test";
  const isDefault = options.isDefault ?? true;

  const container = await new PostgreSqlContainer(image)
    .withDatabase("cascade_test")
    .withUsername("cascade")
    .withPassword("cascade")
    .start();

  const driver = new PostgresDriver({
    connectionString: container.getConnectionUri(),
    database: container.getDatabase(),
    logging: options.logging ?? false,
  });

  await driver.connect();

  const dataSource = new DataSource({
    name: dataSourceName,
    driver,
    isDefault,
  });

  dataSourceRegistry.register(dataSource);

  const query = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    return driver.query<T>(sql, params);
  };

  const dropTables = async (...tables: string[]) => {
    for (const table of tables) {
      await driver.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  };

  const stop = async () => {
    await driver.disconnect();
    dataSourceRegistry.clear();
    await container.stop();
  };

  return { container, driver, dataSource, query, dropTables, stop };
}
