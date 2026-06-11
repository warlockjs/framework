import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { DataSource, dataSourceRegistry, PostgresDriver } from "@warlock.js/cascade";

const DEFAULT_POSTGRES_IMAGE = "postgres:16-alpine";

export type RawQueryResult<T> = {
  rows: T[];
  rowCount: number | null;
};

/**
 * A live Postgres test harness for `@warlock.js/access`, built on the PUBLIC
 * `@warlock.js/cascade` surface — a running container, a connected driver +
 * default data source (so models resolve to it), and a raw-SQL escape hatch.
 */
export type PostgresHarness = {
  container: StartedPostgreSqlContainer;
  driver: PostgresDriver;
  dataSource: DataSource;
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<RawQueryResult<T>>;
  stop: () => Promise<void>;
};

export async function startPostgresHarness(): Promise<PostgresHarness> {
  const container = await new PostgreSqlContainer(DEFAULT_POSTGRES_IMAGE)
    .withDatabase("access_test")
    .withUsername("access")
    .withPassword("access")
    .start();

  const driver = new PostgresDriver({
    connectionString: container.getConnectionUri(),
    database: container.getDatabase(),
    logging: false,
  });

  await driver.connect();

  const dataSource = new DataSource({ name: "pg-test", driver, isDefault: true });

  dataSourceRegistry.register(dataSource);

  const query = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    return driver.query<T>(sql, params) as Promise<RawQueryResult<T>>;
  };

  const stop = async () => {
    await driver.disconnect();
    dataSourceRegistry.clear();
    await container.stop();
  };

  return { container, driver, dataSource, query, stop };
}
