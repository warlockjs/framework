import { Migration } from "./migration.mjs";
import { DataSource } from "../data-source/data-source.mjs";
import { MigrationRecord, MigrationResult } from "./types.mjs";

//#region ../../@warlock.js/cascade/src/migration/migration-runner.d.ts
/**
 * Migration class type with static name property.
 */
type MigrationClass = (new () => Migration) & {
  migrationName: string;
  createdAt?: string;
};
/**
 * Options for migration execution.
 */
type ExecuteOptions = {
  /** Run in dry-run mode (no actual changes) */readonly dryRun?: boolean; /** Record to migrations table (default: true for batch, false for single) */
  readonly record?: boolean;
};
/**
 * Migration runner that executes migrations.
 *
 * This is a pure executor - it doesn't discover migrations.
 * Discovery is handled by the framework (e.g., @warlock.js/core CLI).
 *
 * The migration name is read from the static `name` property on the class,
 * which should be set by the CLI after importing:
 *
 * @example
 * ```typescript
 * // In CLI after importing:
 * const { default: MigrationClass } = await import("./create-users.migration.ts");
 * MigrationClass.migrationName ??= "create-users";
 *
 * // Then register or execute:
 * runner.register(MigrationClass);
 * // or
 * await runner.execute(MigrationClass);
 * ```
 *
 * @example
 * ```typescript
 * // Simple direct execution
 * await runner.execute(CreateUsersTable);
 * await runner.rollback(CreateUsersTable);
 *
 * // Registry pattern for batch operations
 * runner.register(CreateUsersTable);
 * runner.register(AddEmailIndex);
 * await runner.runAll();
 * await runner.rollbackAll();
 * ```
 */
declare class MigrationRunner {
  /** Registered migrations */
  readonly migrations: MigrationClass[];
  /** Data source to use */
  private dataSource?;
  /** Cached migration driver */
  private cachedMigrationDriver?;
  /** Table name for tracking migrations */
  private readonly migrationsTable;
  /** Whether to log operations */
  private readonly verbose;
  /**
   * Create a new migration runner.
   *
   * @param options - Runner options
   */
  constructor(options?: {
    dataSource?: DataSource;
    migrationsTable?: string;
    verbose?: boolean;
  });
  /**
   * Set the data source.
   */
  setDataSource(dataSource: DataSource): this;
  /**
   * Get the data source.
   */
  private getDataSource;
  /**
   * Get the migration driver.
   */
  private getMigrationDriver;
  /**
   * Register a migration.
   *
   * The migration name is read from `MigrationClass.migrationName`.
   *
   * @param MigrationClass - Migration class (must have static `name` set)
   * @param createdAt - Optional timestamp for ordering
   * @returns This runner for chaining
   *
   * @example
   * ```typescript
   * CreateUsersTable.migrationName = "2024-01-15_create-users";
   * runner.register(CreateUsersTable);
   * ```
   */
  register(MigrationClass: MigrationClass): this;
  /**
   * Register multiple migrations.
   *
   * @param migrations - Array of migration classes
   * @returns This runner for chaining
   */
  registerMany(migrations: MigrationClass[]): this;
  /**
   * Clear all registered migrations.
   */
  clear(): this;
  /**
   * Get all registered migration names.
   */
  getRegisteredNames(): string[];
  /**
   * Execute a single migration's up() method.
   *
   * @param MigrationClass - Migration class to execute
   * @param options - Execution options
   * @returns Migration result
   *
   * @example
   * ```typescript
   * await runner.execute(CreateUsersTable);
   * await runner.execute(AddEmailIndex, { dryRun: true });
   * ```
   */
  run(MigrationClass: MigrationClass, options?: ExecuteOptions): Promise<MigrationResult>;
  /**
   * Execute a single migration's down() method.
   *
   * @param MigrationClass - Migration class to rollback
   * @param options - Execution options
   * @returns Migration result
   *
   * @example
   * ```typescript
   * await runner.rollback(CreateUsersTable);
   * ```
   */
  rollback(MigrationClass: MigrationClass, options?: ExecuteOptions): Promise<MigrationResult>;
  /**
   * Run all pending registered migrations.
   *
   * Only runs migrations not already in the migrations table.
   *
   * @param options - Execution options
   * @returns Results for each migration
   *
   * @example
   * ```typescript
   * runner.register(CreateUsersTable);
   * runner.register(AddEmailIndex);
   * const results = await runner.runAll();
   * ```
   */
  runAll(options?: ExecuteOptions): Promise<MigrationResult[]>;
  /**
   * Export migrations as phase-ordered SQL files in database/sql/ directory.
   * By default, it exports all registered migrations. Use `pendingOnly: true` to export only pending ones.
   */
  exportSQL(options?: {
    pendingOnly?: boolean;
    compact?: boolean;
  }): Promise<void>;
  /**
   * Rollback the last batch of migrations.
   *
   * @param options - Execution options
   * @returns Results for each migration
   */
  rollbackLast(options?: ExecuteOptions): Promise<MigrationResult[]>;
  /**
   * Rollback N batches of migrations.
   *
   * @param batches - Number of batches to rollback
   * @param options - Execution options
   * @returns Results for each migration
   */
  rollbackBatches(batches: number, options?: ExecuteOptions): Promise<MigrationResult[]>;
  /**
   * Rollback all executed migrations.
   *
   * @param options - Execution options
   * @returns Results for each migration
   */
  rollbackAll(options?: ExecuteOptions): Promise<MigrationResult[]>;
  /**
   * Reset and re-run: rollback all then run all.
   *
   * @param options - Execution options
   * @returns Combined results
   */
  fresh(options?: ExecuteOptions): Promise<MigrationResult[]>;
  /**
   * Get status of all registered migrations.
   */
  status(): Promise<Array<{
    name: string;
    table: string;
    executed: boolean;
    batch: number | null;
  }>>;
  /**
   * Check whether a database extension is available and inform the developer
   * if it is not installed.
   *
   * Does NOT throw — execution proceeds normally. If the extension is truly
   * missing, the database will surface its own error with full context already
   * displayed to the developer.
   *
   * @example
   * await this.informIfExtensionMissing("vector");
   */
  private informIfExtensionMissing;
  /**
   * Run a single migration.
   */
  private runMigration;
  /**
   * Create, configure, and return a ready-to-use migration instance.
   *
   * Centralises the repeated "new + setDriver + setMigrationDefaults" boilerplate
   * that all batch/single execution paths need.
   *
   * @internal
   */
  private createMigrationInstance;
  /**
   * Format an ordered array of TaggedSQL into a human-readable SQL file string.
   *
   * Consecutive statements that belong to the same (phase, migration) group share
   * a single block comment at the top, avoiding the noisy per-statement repetition.
   *
   * Example output:
   * ```sql
   * /* Phase 3 [create-users] *\/
   * ALTER TABLE "users" ADD COLUMN "name" TEXT NOT NULL;
   * ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL;
   *
   * /* Phase 4 [create-users] *\/
   * CREATE UNIQUE INDEX ...;
   * ```
   *
   * @internal
   */
  private formatSQLForExport;
  /**
   * Get pending (not executed) registered migrations.
   */
  private getPendingMigrations;
  /**
   * Get migrations to rollback.
   */
  private getMigrationsToRollback;
  /**
   * Get executed migration records.
   */
  getExecutedMigrations(): Promise<MigrationRecord[]>;
  /**
   * Record a migration.
   */
  private recordMigration;
  /**
   * Remove a migration record.
   */
  private removeMigrationRecord;
  /**
   * Get next batch number.
   */
  private getNextBatchNumber;
}
declare const migrationRunner: MigrationRunner;
//#endregion
export { MigrationRunner, migrationRunner };
//# sourceMappingURL=migration-runner.d.mts.map