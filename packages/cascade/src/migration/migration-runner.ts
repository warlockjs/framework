import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import type { MigrationDriverContract } from "../contracts/migration-driver.contract";
import type { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { type Migration } from "./migration";
import type { MigrationRecord, MigrationResult } from "./types";

/**
 * Migration class type with static name property.
 */
type MigrationClass = (new () => Migration) & {
  migrationName: string;
  order?: number;
  createdAt?: string;
};

/**
 * Options for migration execution.
 */
type ExecuteOptions = {
  /** Run in dry-run mode (no actual changes) */
  readonly dryRun?: boolean;
  /** Record to migrations table (default: true for batch, false for single) */
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
export class MigrationRunner {
  /** Registered migrations */
  public readonly migrations: MigrationClass[] = [];

  /** Data source to use */
  private dataSource?: DataSource;

  /** Cached migration driver */
  private cachedMigrationDriver?: MigrationDriverContract;

  /** Table name for tracking migrations */
  private readonly migrationsTable: string;

  /** Whether to log operations */
  private readonly verbose: boolean;

  /**
   * Create a new migration runner.
   *
   * @param options - Runner options
   */
  public constructor(
    options: {
      dataSource?: DataSource;
      migrationsTable?: string;
      verbose?: boolean;
    } = {},
  ) {
    this.dataSource = options.dataSource;
    this.migrationsTable = options.migrationsTable ?? "_migrations";
    this.verbose = options.verbose ?? true;
  }

  // ============================================================================
  // DATA SOURCE
  // ============================================================================

  /**
   * Set the data source.
   */
  public setDataSource(dataSource: DataSource): this {
    this.dataSource = dataSource;
    this.cachedMigrationDriver = undefined;
    return this;
  }

  /**
   * Get the data source.
   */
  private getDataSource(): DataSource {
    if (!this.dataSource) {
      this.dataSource = dataSourceRegistry.get();
    }
    return this.dataSource;
  }

  /**
   * Get the migration driver.
   */
  private getMigrationDriver(): MigrationDriverContract {
    if (!this.cachedMigrationDriver) {
      this.cachedMigrationDriver = this.getDataSource().driver.migrationDriver();
    }
    return this.cachedMigrationDriver;
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

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
  public register(MigrationClass: MigrationClass): this {
    const name = MigrationClass.migrationName;
    if (!name) {
      throw new Error(
        `Migration class must have a static 'migrationName' property set. ` +
          `Set it in CLI after importing: MigrationClass.migrationName = "filename";`,
      );
    }
    // Avoid duplicates
    if (!this.migrations.some((m) => m.migrationName === name)) {
      this.migrations.push(MigrationClass);
    }

    return this;
  }

  /**
   * Register multiple migrations.
   *
   * @param migrations - Array of migration classes
   * @returns This runner for chaining
   */
  public registerMany(migrations: MigrationClass[]): this {
    for (const MigrationClass of migrations) {
      this.register(MigrationClass);
    }
    return this;
  }

  /**
   * Clear all registered migrations.
   */
  public clear(): this {
    this.migrations.length = 0;
    return this;
  }

  /**
   * Get all registered migration names.
   */
  public getRegisteredNames(): string[] {
    return this.migrations.map((m) => m.migrationName);
  }

  // ============================================================================
  // SINGLE EXECUTION
  // ============================================================================

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
  public async run(
    MigrationClass: MigrationClass,
    options: ExecuteOptions = {},
  ): Promise<MigrationResult> {
    return this.runMigration(MigrationClass, "up", {
      dryRun: options.dryRun,
      record: options.record ?? false,
    });
  }

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
  public async rollback(
    MigrationClass: MigrationClass,
    options: ExecuteOptions = {},
  ): Promise<MigrationResult> {
    return this.runMigration(MigrationClass, "down", {
      dryRun: options.dryRun,
      record: options.record ?? false,
    });
  }

  // ============================================================================
  // BATCH EXECUTION (REGISTERED MIGRATIONS)
  // ============================================================================

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
  public async runAll(options: ExecuteOptions = {}): Promise<MigrationResult[]> {
    const { dryRun = false, record = true } = options;

    const results: MigrationResult[] = [];

    // Get pending migrations
    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      log.warn("database", "migration", "Nothing to migrate.");
      return results;
    }

    log.info("database", "migration", `Found ${pending.length} pending migration(s).`);
    const nextBatch = await this.getNextBatchNumber();

    for (const MigrationClass of pending) {
      const result = await this.runMigration(MigrationClass, "up", {
        dryRun,
        record,
        batch: nextBatch,
      });
      results.push(result);

      if (!result.success) {
        break; // Stop on first error
      }
    }

    const successCount = results.filter((r) => r.success).length;
    log.success(
      "database",
      "migration",
      `Migration complete: ${successCount}/${pending.length} successful.`,
    );

    return results;
  }

  /**
   * Rollback the last batch of migrations.
   *
   * @param options - Execution options
   * @returns Results for each migration
   */
  public async rollbackLast(options: ExecuteOptions = {}): Promise<MigrationResult[]> {
    return this.rollbackBatches(1, options);
  }

  /**
   * Rollback N batches of migrations.
   *
   * @param batches - Number of batches to rollback
   * @param options - Execution options
   * @returns Results for each migration
   */
  public async rollbackBatches(
    batches: number,
    options: ExecuteOptions = {},
  ): Promise<MigrationResult[]> {
    const dryRun = options.dryRun ?? false;
    const record = options.record ?? true;
    const results: MigrationResult[] = [];

    const toRollback = await this.getMigrationsToRollback(batches);

    if (toRollback.length === 0) {
      log.warn("database", "migration", "Nothing to rollback.");
      return results;
    }

    log.info("database", "migration", `Rolling back ${toRollback.length} migration(s).`);

    for (const MigrationClass of toRollback) {
      const result = await this.runMigration(MigrationClass, "down", {
        dryRun,
        record,
      });
      results.push(result);

      if (!result.success) {
        break;
      }
    }

    const successCount = results.filter((r) => r.success).length;
    log.success(
      "database",
      "migration",
      `Rollback complete: ${successCount}/${toRollback.length} successful.`,
    );

    return results;
  }

  /**
   * Rollback all executed migrations.
   *
   * @param options - Execution options
   * @returns Results for each migration
   */
  public async rollbackAll(options: ExecuteOptions = {}): Promise<MigrationResult[]> {
    const executed = await this.getExecutedMigrations();
    if (executed.length === 0) {
      log.warn("database", "migration", "Nothing to rollback.");
      return [];
    }

    const maxBatch = Math.max(...executed.map((r) => r.batch));
    return this.rollbackBatches(maxBatch, options);
  }

  /**
   * Reset and re-run: rollback all then run all.
   *
   * @param options - Execution options
   * @returns Combined results
   */
  public async fresh(options: ExecuteOptions = {}): Promise<MigrationResult[]> {
    const rollbackResults = await this.rollbackAll(options);
    const runResults = await this.runAll(options);
    return [...rollbackResults, ...runResults];
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  /**
   * Get status of all registered migrations.
   */
  public async status(): Promise<
    Array<{
      name: string;
      table: string;
      executed: boolean;
      batch: number | null;
    }>
  > {
    const executed = await this.getExecutedMigrations();
    const executedMap = new Map(executed.map((r) => [r.name, r]));

    return this.migrations.map((MigrationClass) => {
      const instance = new MigrationClass();
      const name = MigrationClass.migrationName;
      const record = executedMap.get(name);
      return {
        name,
        table: instance.table,
        executed: !!record,
        batch: record?.batch ?? null,
      };
    });
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Run a single migration.
   */
  private async runMigration(
    MigrationClass: MigrationClass,
    direction: "up" | "down",
    options: {
      dryRun?: boolean;
      record?: boolean;
      batch?: number;
    } = {},
  ): Promise<MigrationResult> {
    const { dryRun = false, record = true } = options;
    const startTime = Date.now();
    let success = true;
    let error: string | undefined;

    const migration = new MigrationClass();
    const name = MigrationClass.migrationName;

    log.info(
      "database",
      "migration",
      `${direction === "up" ? "Migrating" : "Rolling back"}: ${colors.magenta(name)}...`,
    );

    try {
      if (!dryRun) {
        const driver = this.getMigrationDriver();
        migration.setDriver(driver);

        if (direction === "up") {
          await migration.up();
        } else {
          await migration.down();
        }

        await migration.execute();

        if (record) {
          if (direction === "up") {
            const batch = options.batch ?? (await this.getNextBatchNumber());
            await this.recordMigration(
              name,
              batch,
              MigrationClass.createdAt ? new Date(MigrationClass.createdAt) : undefined,
            );
          } else {
            await this.removeMigrationRecord(name);
          }
        }
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      log.error("database", "migration", `${colors.magenta(name)}: ✗ Failed: ${error}`);
    }

    const durationMs = Date.now() - startTime;

    if (success) {
      log.success(
        "database",
        "migration",
        `${direction == "up" ? "Migrated" : "Rolled back"} ${colors.magenta(name)}: successfully (${durationMs}ms)`,
      );
    }

    return {
      name,
      table: migration.table,
      direction,
      success,
      error,
      durationMs,
      executedAt: new Date(),
    };
  }

  /**
   * Get pending (not executed) registered migrations.
   */
  private async getPendingMigrations(): Promise<MigrationClass[]> {
    const executed = await this.getExecutedMigrations();
    const executedNames = new Set(executed.map((r) => r.name));
    const migrations = this.migrations.filter((m) => !executedNames.has(m.migrationName));

    return migrations.sort((a, b) => {
      if (a.order && b.order) {
        return a.order - b.order;
      }

      return a.migrationName.localeCompare(b.migrationName);
    });
  }

  /**
   * Get migrations to rollback.
   */
  private async getMigrationsToRollback(batches: number): Promise<MigrationClass[]> {
    const executed = await this.getExecutedMigrations();
    if (executed.length === 0) return [];

    const batchNumbers = [...new Set(executed.map((r) => r.batch))]
      .sort((a, b) => b - a)
      .slice(0, batches);

    const toRollback = executed.filter((r) => batchNumbers.includes(r.batch)).reverse();

    const migrations = toRollback
      .map((r) => this.migrations.find((m) => m.migrationName === r.name))
      .filter((m): m is MigrationClass => !!m);

    return migrations.sort((a, b) => {
      if (a.order && b.order) {
        return a.order - b.order;
      }

      return a.migrationName.localeCompare(b.migrationName);
    });
  }

  /**
   * Get executed migration records.
   */
  public async getExecutedMigrations(): Promise<MigrationRecord[]> {
    const driver = this.getDataSource().driver;

    try {
      const queryBuilder = driver.queryBuilder<MigrationRecord>(this.migrationsTable);
      return await queryBuilder.orderBy("batch", "asc").orderBy("name", "asc").get();
    } catch {
      return [];
    }
  }

  /**
   * Record a migration.
   */
  private async recordMigration(name: string, batch: number, createdAt?: Date): Promise<void> {
    const driver = this.getDataSource().driver;
    const migrationDriver = this.getMigrationDriver();

    // Ensure migrations table exists
    await migrationDriver.ensureMigrationsTable(this.migrationsTable);

    await driver.insert(this.migrationsTable, {
      name,
      batch,
      executedAt: new Date(),
      createdAt,
    });
  }

  /**
   * Remove a migration record.
   */
  private async removeMigrationRecord(name: string): Promise<void> {
    const driver = this.getDataSource().driver;
    await driver.delete(this.migrationsTable, { name });
  }

  /**
   * Get next batch number.
   */
  private async getNextBatchNumber(): Promise<number> {
    const executed = await this.getExecutedMigrations();
    if (executed.length === 0) return 1;
    return Math.max(...executed.map((r) => r.batch)) + 1;
  }
}

export const migrationRunner = new MigrationRunner();
