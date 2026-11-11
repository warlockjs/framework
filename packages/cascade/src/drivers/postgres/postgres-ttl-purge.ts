import { job, scheduler } from "@warlock.js/scheduler";
import type { PostgresDriver } from "./postgres-driver";

const TTL_PURGE_INTERVAL_MINUTES = 1;
const TTL_COMMENT_PREFIX = "warlock_ttl:";

/** Rows one purge statement deletes at most. */
const TTL_PURGE_BATCH_SIZE = 5000;

/**
 * Statements one purge run issues at most; a larger backlog is finished by
 * the next runs, so one run never holds the table for long.
 */
const TTL_PURGE_MAX_BATCHES_PER_RUN = 100;

/** Purges in progress, by job name: a run that would overlap is skipped. */
const runningPurges = new Set<string>();

let nextDriverId = 0;
const driverIds = new WeakMap<object, number>();
const driverJobs = new WeakMap<object, Set<string>>();

type PostgresTTLPurgeDriver = Pick<PostgresDriver, "dialect"> & {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

function getDriverId(driver: object): number {
  let id = driverIds.get(driver);

  if (id === undefined) {
    id = nextDriverId++;
    driverIds.set(driver, id);
  }

  return id;
}

/** Persist the retention rule with the index so a restarted process can restore its job. */
export function postgresTTLPurgeComment(
  table: string,
  column: string,
  expireAfterSeconds: number,
): string {
  return TTL_COMMENT_PREFIX + JSON.stringify({ table, column, expireAfterSeconds });
}

/**
 * Return the scheduler job name for one PostgreSQL TTL index.
 *
 * The driver id prevents two data sources with identically named tables from
 * replacing each other's purge jobs on the shared scheduler singleton.
 */
export function postgresTTLPurgeJobName(driver: object, table: string, column: string): string {
  return `cascade:postgres:${getDriverId(driver)}:ttl:${table}:${column}`;
}

/**
 * Delete rows which have outlived a PostgreSQL TTL index's retention period.
 *
 * Rows are deleted in batches of at most 5,000 per statement, up to 100
 * statements per run, so a large backlog (after downtime, or when TTL is
 * first added to a big table) never becomes one long transaction; whatever
 * is left is removed by the next runs. The expiry condition is repeated on
 * the outer statement, so only expired rows are ever deleted.
 *
 * Identifiers are produced by the dialect, while the retention interval stays
 * parameterized so a migration value can never become executable SQL.
 */
export async function purgeExpiredPostgresRows(
  driver: PostgresTTLPurgeDriver,
  table: string,
  column: string,
  expireAfterSeconds: number,
): Promise<void> {
  const quotedTable = driver.dialect.quoteIdentifier(table);
  const quotedColumn = driver.dialect.quoteIdentifier(column);
  const expired = `${quotedColumn} < NOW() - ($1 * INTERVAL '1 second')`;
  const sql =
    `DELETE FROM ${quotedTable} WHERE ${expired} AND ctid IN ` +
    `(SELECT ctid FROM ${quotedTable} WHERE ${expired} LIMIT $2)`;

  for (let batch = 0; batch < TTL_PURGE_MAX_BATCHES_PER_RUN; batch++) {
    const result = (await driver.query(sql, [expireAfterSeconds, TTL_PURGE_BATCH_SIZE])) as
      | { rowCount?: number | null }
      | undefined;

    if ((result?.rowCount ?? 0) < TTL_PURGE_BATCH_SIZE) return;
  }
}

/**
 * Register the in-process scheduler purge job for a PostgreSQL TTL index.
 *
 * The application owns the scheduler lifecycle: callers must start the shared
 * scheduler during bootstrap. Re-registering replaces a previous job for the
 * same driver/index so repeated migration setup cannot leak callbacks.
 */
export function registerPostgresTTLPurgeJob(
  driver: PostgresTTLPurgeDriver,
  table: string,
  column: string,
  expireAfterSeconds: number,
): void {
  const name = postgresTTLPurgeJobName(driver, table, column);

  scheduler.removeJob(name);
  scheduler.addJob(
    job(name, async () => {
      // A run still deleting a backlog when the next tick comes keeps going;
      // the new run is skipped instead of competing for the same rows.
      if (runningPurges.has(name)) return;

      runningPurges.add(name);

      try {
        await purgeExpiredPostgresRows(driver, table, column, expireAfterSeconds);
      } finally {
        runningPurges.delete(name);
      }
    }).everyMinutes(TTL_PURGE_INTERVAL_MINUTES),
  );
  let names = driverJobs.get(driver);
  if (!names) {
    names = new Set();
    driverJobs.set(driver, names);
  }
  names.add(name);
}

/** Remove the scheduler callback associated with a dropped PostgreSQL TTL index. */
export function unregisterPostgresTTLPurgeJob(driver: object, table: string, column: string): void {
  const name = postgresTTLPurgeJobName(driver, table, column);
  scheduler.removeJob(name);
  driverJobs.get(driver)?.delete(name);
}

/** Remove a driver's callbacks before its pool is closed. */
export function unregisterAllPostgresTTLPurgeJobs(driver: object): void {
  for (const name of driverJobs.get(driver) ?? []) scheduler.removeJob(name);
  driverJobs.delete(driver);
}

/** Restore registered retention rules from index comments on every connection. */
export async function loadPostgresTTLPurgeJobs(driver: PostgresTTLPurgeDriver): Promise<void> {
  const result = (await driver.query(
    `SELECT d.description FROM pg_catalog.pg_description d
      JOIN pg_catalog.pg_class c ON c.oid = d.objoid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'i' AND n.nspname = current_schema()
        AND d.description LIKE 'warlock_ttl:%'`,
  )) as { rows?: Array<{ description?: unknown }> };

  for (const row of result.rows ?? []) {
    if (typeof row.description !== "string" || !row.description.startsWith(TTL_COMMENT_PREFIX))
      continue;
    let rule: unknown;
    try {
      rule = JSON.parse(row.description.slice(TTL_COMMENT_PREFIX.length));
    } catch {
      continue;
    }
    if (!rule || typeof rule !== "object") continue;
    const { table, column, expireAfterSeconds } = rule as Record<string, unknown>;
    if (
      typeof table !== "string" ||
      table.length === 0 ||
      typeof column !== "string" ||
      column.length === 0 ||
      !Number.isSafeInteger(expireAfterSeconds) ||
      (expireAfterSeconds as number) < 0
    )
      continue;
    registerPostgresTTLPurgeJob(driver, table, column, expireAfterSeconds as number);
  }
}
