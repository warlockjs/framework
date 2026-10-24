import { dataSourceRegistry } from "@warlock.js/cascade";

export type ResetTestDatabaseOptions = {
  /** Data source name. Defaults to the default data source. */
  connection?: string;
  /** Tables or collections to leave alone. The migrations ledger is always kept. */
  except?: readonly string[];
  /** Truncate only these tables or collections. */
  only?: readonly string[];
};

const MIGRATIONS_LEDGER = "_migrations";

/**
 * Remove every row from the test database's tables or collections, keeping the
 * schema, indexes and the migrations ledger. Used for the per-file reset of a
 * worker-scoped runtime (`tests.resetDatabase`), and callable directly from
 * `tests.resetBetweenFiles` or a test.
 *
 * Point the worker at its own database first (see {@link workerDatabaseName});
 * truncating a database other workers use would delete their rows.
 *
 * @returns the names that were truncated
 *
 * @example
 * await resetTestDatabase({ except: ["countries"] });
 */
export async function resetTestDatabase(options: ResetTestDatabaseOptions = {}): Promise<string[]> {
  const driver = dataSourceRegistry.get(options.connection).driver;
  const keep = new Set([MIGRATIONS_LEDGER, ...(options.except ?? [])]);
  const only = options.only ? new Set(options.only) : undefined;
  const tables = (await driver.blueprint.listTables()).filter(
    (table) => !table.startsWith("system.") && !keep.has(table) && (!only || only.has(table)),
  );
  const truncateOptions = driver.name === "postgres" ? { cascade: true } : undefined;

  for (const table of tables) {
    await driver.truncateTable(table, truncateOptions);
  }

  return tables;
}

/**
 * The Vitest worker's 1-based pool id, or `1` outside Vitest. Stable for the
 * life of a worker, and distinct between workers that run at the same time.
 */
export function testWorkerId(): number {
  const id = Number(process.env.VITEST_POOL_ID);

  return Number.isInteger(id) && id > 0 ? id : 1;
}

/**
 * A database name private to this Vitest worker, such as `app_test_3`, so
 * workers that keep their runtime across files can truncate freely.
 *
 * @example
 * // src/config/database.ts
 * name: process.env.VITEST ? workerDatabaseName("app_test") : "app",
 */
export function workerDatabaseName(base: string): string {
  return `${base}_${testWorkerId()}`;
}
