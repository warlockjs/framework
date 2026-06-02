import { migrationRunner } from "../migration/migration-runner";
import type { MigrationRecord, MigrationResult } from "../migration/types";

/**
 * Options for exporting migrations as SQL files.
 */
export type ExportMigrationsSQLOptions = {
  /** Export only pending migrations. Default: false (exports all registered). */
  readonly pendingOnly?: boolean;
  /** Strip generated block comments and blank lines from the output. */
  readonly compact?: boolean;
};

/**
 * Options for rolling back migrations.
 */
export type RollbackMigrationsOptions = {
  /** Roll back every executed migration. Overrides `batches` when true. */
  readonly all?: boolean;
  /** Number of batches to roll back when `all` is not set. Default: 1. */
  readonly batches?: number;
};

/**
 * Run every pending migration registered on the migration runner.
 *
 * Caller is responsible for registering migration classes first via
 * `migrationRunner.register()` / `migrationRunner.registerMany()`. Returns one
 * result entry per executed migration.
 *
 * @example
 * migrationRunner.registerMany([CreateUsersTable, AddEmailIndex]);
 * const results = await runMigrations();
 */
export async function runMigrations(): Promise<MigrationResult[]> {
  return migrationRunner.runAll();
}

/**
 * Roll back executed migrations. By default rolls back the most recent batch;
 * pass `all: true` to undo every executed migration, or `batches: N` to undo
 * the last N batches.
 *
 * @example
 * await rollbackMigrations();              // last batch
 * await rollbackMigrations({ batches: 3 }); // last three batches
 * await rollbackMigrations({ all: true });  // everything
 */
export async function rollbackMigrations(
  options: RollbackMigrationsOptions = {},
): Promise<MigrationResult[]> {
  if (options.all) {
    return migrationRunner.rollbackAll();
  }

  const batches = options.batches ?? 1;

  return migrationRunner.rollbackBatches(batches);
}

/**
 * Roll back every executed migration, then run every registered migration.
 * Equivalent to `rollbackMigrations({ all: true })` followed by
 * `runMigrations()`.
 *
 * @example
 * await freshMigrate();
 */
export async function freshMigrate(): Promise<MigrationResult[]> {
  return migrationRunner.fresh();
}

/**
 * Export registered migrations as phase-ordered `.up.sql` and `.down.sql`
 * files under `<cwd>/database/sql/`.
 *
 * @example
 * await exportMigrationsSQL();
 * await exportMigrationsSQL({ pendingOnly: true, compact: true });
 */
export async function exportMigrationsSQL(
  options: ExportMigrationsSQLOptions = {},
): Promise<void> {
  return migrationRunner.exportSQL(options);
}

/**
 * Return the migration records persisted in the migrations table — one entry
 * per migration that has ever been executed against the configured data
 * source.
 *
 * @example
 * const executed = await listExecutedMigrations();
 * console.log(executed.map((record) => record.name));
 */
export async function listExecutedMigrations(): Promise<MigrationRecord[]> {
  return migrationRunner.getExecutedMigrations();
}
