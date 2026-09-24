import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import fs from "fs";
import path from "path";
import type { MigrationDriverContract } from "../contracts/migration-driver.contract";
import type { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { type Migration, type MigrationContract } from "./migration";
import { sortMigrations, sortMigrationsForRollback } from "./migration-order";
import { parseCreatedAt } from "./parse-created-at";
import { SQLGrammar } from "./sql-grammar";
import type { MigrationRecord, MigrationResult, TaggedSQL } from "./types";

/**
 * Migration class type with static name property.
 */
type MigrationClass = (new () => Migration) & {
  migrationName: string;
  createdAt?: string;
};

/**
 * What a caller may hand to {@link MigrationRunner.register}.
 *
 * Looser than {@link MigrationClass} in exactly one way: `migrationName` may be
 * absent. That is the documented workflow — the CLI imports a migration file and
 * sets the name from the filename afterwards — and `register()` enforces it at
 * runtime, throwing a message that says so. Once past that check the name IS
 * present, which is why everything stored and read downstream uses the stricter
 * type. Requiring it on the INPUT made the runner reject the very classes the
 * public `MigrationConstructor` describes.
 *
 * It constructs a MigrationContract rather than the abstract Migration class for the
 * same reason: `typeof Migration` is abstract and cannot satisfy `new () => Migration`,
 * and the public MigrationConstructor is declared against the contract. The runner only
 * ever uses contract members on what it registers.
 */
type RegisterableMigration = (new () => MigrationContract) & {
  migrationName?: string;
  createdAt?: string;
};

/**
 * Resolved instance data for a single pending migration.
 * @internal
 */
type MigrationData = {
  MigrationClass: MigrationClass;
  migration: Migration;
  name: string;
  /** Data source this migration runs against (its own, else the runner's). */
  dataSource: DataSource;
  /** Serialized `up()` statements (empty for direct-execution drivers). */
  statements: string[];
  /** Whether the migration runs inside a transaction. */
  transactional: boolean;
  /** Driver has no SQL dialect (MongoDB): executed through `runMigration`. */
  direct: boolean;
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

  /** Cached migration drivers, one per data source */
  private readonly migrationDrivers = new Map<DataSource, MigrationDriverContract>();

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
    this.migrationDrivers.clear();
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
  private getMigrationDriver(
    dataSource: DataSource = this.getDataSource(),
  ): MigrationDriverContract {
    let driver = this.migrationDrivers.get(dataSource);
    if (!driver) {
      driver = dataSource.driver.migrationDriver();
      this.migrationDrivers.set(dataSource, driver);
    }
    return driver;
  }

  /**
   * Resolve a migration's declared data source (name or instance).
   * Falls back to the runner's own data source when it declares none.
   */
  private resolveDataSource(declared?: string | DataSource): DataSource {
    if (!declared) return this.getDataSource();
    if (typeof declared === "string") return dataSourceRegistry.get(declared);
    return declared;
  }

  /** Data source a registered migration class runs against. */
  private sourceOf(MigrationClass: MigrationClass): DataSource {
    return this.resolveDataSource(new MigrationClass().dataSource);
  }

  /** Distinct data sources across the registered migrations (runner's own included). */
  private getSources(): DataSource[] {
    const sources = new Set<DataSource>([this.getDataSource()]);
    for (const MigrationClass of this.migrations) {
      sources.add(this.sourceOf(MigrationClass));
    }
    return [...sources];
  }

  /**
   * Resolve whether a migration runs in a transaction:
   * 1. migration-level flag (instance, else the static from `Migration.create/alter`)
   * 2. `CONCURRENTLY` statements cannot run in a transaction block
   * 3. data-source config
   * 4. driver default
   */
  private resolveTransactional(
    MigrationClass: MigrationClass,
    migration: Migration,
    dataSource: DataSource,
    statements: string[] = [],
  ): boolean {
    const explicit =
      migration.transactional ?? (MigrationClass as { transactional?: boolean }).transactional;

    if (explicit !== undefined) return explicit;

    if (statements.some((sql) => /\bCONCURRENTLY\b/i.test(sql))) return false;

    return (
      dataSource.migrations?.transactional ??
      this.getMigrationDriver(dataSource).getDefaultTransactional()
    );
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
  public register(MigrationClass: RegisterableMigration): this {
    const name = MigrationClass.migrationName;
    if (!name) {
      throw new Error(
        `Migration class must have a static 'migrationName' property set. ` +
          `Set it in CLI after importing: MigrationClass.migrationName = "filename";`,
      );
    }
    // Avoid duplicates
    if (!this.migrations.some((m) => m.migrationName === name)) {
      // `name` is proven present by the throw above, so this satisfies the stricter
      // stored type that every reader downstream relies on.
      this.migrations.push(MigrationClass as MigrationClass);
    }

    return this;
  }

  /**
   * Register multiple migrations.
   *
   * @param migrations - Array of migration classes
   * @returns This runner for chaining
   */
  public registerMany(migrations: RegisterableMigration[]): this {
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

    // Next batch number per data source: each source has its own migrations table.
    const sources = new Set<DataSource>();
    const migrationsData: MigrationData[] = [];

    log.info("database", "migration", `Found ${pending.length} pending migration(s).`);

    // 1. Resolve each migration's data source and transactional mode, and collect
    //    its SQL. Drivers without SQL serialization (MongoDB) are executed
    //    directly through the migration driver instead.
    //    Extension checks fire concurrently as CREATE EXTENSION statements are met.
    const extensionChecks: Promise<void>[] = [];

    for (const MigrationClass of pending) {
      const migration = this.createMigrationInstance(MigrationClass);
      const name = MigrationClass.migrationName;
      const dataSource = this.resolveDataSource(migration.dataSource);
      sources.add(dataSource);

      if (dataSource.driver.supportsSqlSerialization === false) {
        migrationsData.push({
          MigrationClass,
          migration,
          name,
          dataSource,
          statements: [],
          transactional: false,
          direct: true,
        });
        continue;
      }

      migration.setDriver(this.getMigrationDriver(dataSource));
      migration.setMigrationDefaults(dataSource.migrationDefaults);

      await migration.up();
      const statements = migration.toSQL();

      migrationsData.push({
        MigrationClass,
        migration,
        name,
        dataSource,
        statements,
        transactional:
          !!dataSource.driver.transaction &&
          this.resolveTransactional(MigrationClass, migration, dataSource, statements),
        direct: false,
      });

      for (const sql of statements) {
        if (SQLGrammar.classify(sql) === "CREATE_EXTENSION") {
          const ext = SQLGrammar.extractExtensionName(sql);
          if (ext) extensionChecks.push(this.informIfExtensionMissing(ext, dataSource));
        }
      }
    }

    // 2. Resolve all extension checks before any SQL is executed.
    await Promise.all(extensionChecks);

    // 3. Dry run: print statements in migration order (authored order kept; no
    //    global phase sort, which would reorder add-column → backfill → NOT NULL).
    if (dryRun) {
      log.info("database", "migration", "Dry run enabled. Would execute the following statements:");
      for (const data of migrationsData) {
        for (const sql of data.statements) {
          console.log(
            `-- [${SQLGrammar.classify(sql)}] Phase ${SQLGrammar.phase(sql)} [${data.name}]`,
          );
          console.log(sql + ";\n");
        }
      }
      return [];
    }

    const batches = new Map<DataSource, number>();
    for (const dataSource of sources) {
      batches.set(dataSource, await this.getNextBatchNumber(dataSource));
    }

    // 4. Split into runs: consecutive transactional migrations on the same data
    //    source share one transaction; every other migration (non-transactional
    //    or direct) runs alone.
    const runs: MigrationData[][] = [];
    for (const data of migrationsData) {
      const last = runs[runs.length - 1];
      const lastFirst = last?.[0];
      if (
        data.transactional &&
        last &&
        lastFirst?.transactional &&
        lastFirst.dataSource === data.dataSource
      ) {
        last.push(data);
      } else {
        runs.push([data]);
      }
    }

    for (const run of runs) {
      const first = run[0];
      if (!first) continue;
      const dataSource = first.dataSource;
      const nextBatch = batches.get(dataSource)!;
      const startTime = Date.now();

      if (first.direct) {
        const result = await this.runMigration(first.MigrationClass, "up", {
          dryRun,
          record,
          batch: nextBatch,
        });
        results.push(result);
        if (!result.success) break;
        continue;
      }

      const driver = dataSource.driver;
      let failed = false;
      let errorMessage = "";
      /** The migration that owns the SQL statement that threw. */
      let failingMigrationName: string | undefined;

      const executeRun = async (): Promise<void> => {
        for (const data of run) {
          for (const sql of data.statements) {
            try {
              await driver.query(sql);
            } catch (err) {
              failingMigrationName = data.name;
              throw err;
            }
          }

          // A non-transactional migration is recorded right after it applied.
          // Transactional ones are recorded inside the shared transaction.
          if (record) {
            await this.recordMigration(
              data.name,
              nextBatch,
              data.MigrationClass.createdAt
                ? parseCreatedAt(data.MigrationClass.createdAt)
                : new Date(),
              dataSource,
            );
          }
        }
      };

      try {
        if (first.transactional && driver.transaction) {
          await driver.transaction(executeRun);
        } else {
          await executeRun();
        }
      } catch (err) {
        failed = true;
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      const durationMs = Date.now() - startTime;

      // Only the migration that owns the failing statement is marked failed;
      // the rest of its run is reported as rolled back.
      for (const data of run) {
        const isCulprit = failed && data.name === failingMigrationName;
        const wasSkipped = failed && !isCulprit;

        results.push({
          name: data.name,
          table: data.migration.table,
          direction: "up",
          success: !failed,
          error: isCulprit ? errorMessage : undefined,
          durationMs: Math.round(durationMs / run.length),
          executedAt: new Date(),
        });

        if (isCulprit) {
          log.error(
            "database",
            "migration",
            `${colors.magenta(data.name)}: ✗ Failed: ${errorMessage}`,
          );
        } else if (wasSkipped) {
          log.warn(
            "database",
            "migration",
            `${colors.magenta(data.name)}: rolled back (batch transaction failed)`,
          );
        } else {
          log.success(
            "database",
            "migration",
            `Migrated: ${colors.magenta(data.name)} successfully`,
          );
        }
      }

      if (failed) {
        log.error(
          "database",
          "migration",
          `Batch execution failed. Rollback performed if transactional.`,
        );
        throw new Error("Migration batch failed: " + errorMessage);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    log.success(
      "database",
      "migration",
      `Migration execution complete: ${successCount}/${pending.length} migrations processed successfully.`,
    );

    return results;
  }

  /**
   * Export migrations as phase-ordered SQL files in database/sql/ directory.
   * By default, it exports all registered migrations. Use `pendingOnly: true` to export only pending ones.
   */
  public async exportSQL(options: { pendingOnly?: boolean; compact?: boolean } = {}): Promise<void> {
    if (this.getDataSource().driver.supportsSqlSerialization === false) {
      throw new Error(
        "SQL export is not supported on this data source — its driver has no SQL dialect. " +
          "Migrations on this driver execute native commands through the migration driver instead.",
      );
    }

    const migrationsToExport = options.pendingOnly
      ? await this.getPendingMigrations()
      : this.migrations;

    if (migrationsToExport.length === 0) {
      log.warn("database", "migration", "No migrations to export.");
      return;
    }

    log.info(
      "database",
      "migration",
      `Exporting ${migrationsToExport.length} ${options.pendingOnly ? "pending " : ""}migration(s) to SQL files...`,
    );

    const upStatements: TaggedSQL[] = [];
    const downStatements: TaggedSQL[] = [];

    for (const MigrationClass of migrationsToExport) {
      const migration = this.createMigrationInstance(MigrationClass);
      const name = MigrationClass.migrationName;

      // Collect up SQL
      await migration.up();
      for (const sql of migration.toSQL()) {
        upStatements.push({
          sql,
          phase: SQLGrammar.phase(sql),
          statementType: SQLGrammar.classify(sql),
          createdAt: MigrationClass.createdAt,
          migrationName: name,
        });
      }

      // Collect down SQL (reuse same instance — toSQL() cleared pendingOps)
      await migration.down();
      for (const sql of migration.toSQL()) {
        downStatements.push({
          sql,
          phase: SQLGrammar.phase(sql),
          statementType: SQLGrammar.classify(sql),
          createdAt: MigrationClass.createdAt,
          migrationName: name,
        });
      }
    }

    const sortedUp = SQLGrammar.sort(upStatements);
    // Down SQL: reverse order (undo in reverse dependency order)
    const sortedDown = downStatements.reverse();

    const upSQLString = this.formatSQLForExport(sortedUp, options.compact);
    const downSQLString = this.formatSQLForExport(sortedDown, options.compact);

    const rootPath = process.cwd();
    const sqlDir = path.join(rootPath, "database", "sql");

    if (!fs.existsSync(sqlDir)) {
      fs.mkdirSync(sqlDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0];
    const upPath = path.join(sqlDir, `migration_${timestamp}.up.sql`);
    const downPath = path.join(sqlDir, `migration_${timestamp}.down.sql`);

    fs.writeFileSync(upPath, upSQLString);
    fs.writeFileSync(downPath, downSQLString);

    log.success("database", "migration", `Exported to:\n- ${upPath}\n- ${downPath}`);
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
    // Batch numbers are per data source; rolling back "all" is every batch of each.
    return this.rollbackBatches(Number.POSITIVE_INFINITY, options);
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
    const executedBySource = new Map<DataSource, Map<string, MigrationRecord>>();

    for (const dataSource of this.getSources()) {
      const executed = await this.getExecutedMigrations(dataSource);
      executedBySource.set(dataSource, new Map(executed.map((r) => [r.name, r])));
    }

    return this.migrations.map((MigrationClass) => {
      const instance = new MigrationClass();
      const name = MigrationClass.migrationName;
      const record = executedBySource.get(this.sourceOf(MigrationClass))?.get(name);
      return {
        name,
        table: instance.table,
        executed: !!record,
        batch: record?.batch ?? null,
      };
    });
  }

  // ============================================================================
  // EXTENSION PRE-FLIGHT
  // ============================================================================

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
  private async informIfExtensionMissing(
    extension: string,
    dataSource: DataSource = this.getDataSource(),
  ): Promise<void> {
    try {
      const migrationDriver = this.getMigrationDriver(dataSource);
      const isAvailable = await migrationDriver.isExtensionAvailable(extension);

      if (!isAvailable) {
        const hr = "─".repeat(60);
        console.log(`\n${colors.yellow(hr)}`);
        console.log(colors.yellow(`  ⚠  Missing Database Extension: ${colors.bold(extension)}`));
        console.log(colors.yellow(hr));
        console.log();
        console.log(`  A pending migration requires the ${colors.cyan(extension)} extension,`);
        console.log(`  which is not installed on your database server.`);
        console.log();
        console.log(
          `  ${colors.bold("This means the physical database server is missing the extension package.")}`,
        );
        console.log(`  You cannot simply run CREATE EXTENSION until the package is installed`);
        console.log(`  on the host machine or Docker container.`);
        console.log();

        const docsUrl = migrationDriver.getExtensionDocsUrl(extension);
        if (docsUrl) {
          console.log(`  ${colors.bold("Or follow the installation guide:")}`);
          console.log(`    ${colors.cyan(docsUrl)}`);
        }
        console.log(`\n${colors.yellow(hr)}\n`);
      }
    } catch {
      // If the check itself fails, silently skip — don't break the migration.
    }
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
        // The migration runs against its declared data source (default: the runner's)
        // and is recorded in THAT source's migrations table.
        const dataSource = this.resolveDataSource(migration.dataSource);
        const driver = this.getMigrationDriver(dataSource);
        migration.setDriver(driver);
        migration.setMigrationDefaults(dataSource.migrationDefaults);

        // ============================================================================
        // TRANSACTION RESOLUTION (3-tier hierarchy)
        // ============================================================================
        // 1. Migration-level explicit override (instance or static)
        // 2. CONCURRENTLY statements (cannot run in a transaction block)
        // 3. Config-level global override
        // 4. Driver default (PostgreSQL: true, MongoDB: false)
        // Resolved below, once the statements are known.

        // ============================================================================
        // EXECUTE WITH OR WITHOUT TRANSACTION
        // ============================================================================

        // Collect the requested direction's operations
        if (direction === "up") {
          await migration.up();
        } else {
          await migration.down();
        }

        const databaseDriver = dataSource.driver;

        // SQL-capable drivers serialize the queued operations to SQL strings;
        // drivers without SQL serialization (MongoDB) keep them queued and
        // execute them directly through the migration driver.
        const directExecution = databaseDriver.supportsSqlSerialization === false;
        const sqlStatements = directExecution ? [] : migration.toSQL();
        const shouldUseTransaction = this.resolveTransactional(
          MigrationClass,
          migration,
          dataSource,
          sqlStatements,
        );

        const applyMigration = async (): Promise<void> => {
          if (directExecution) {
            await migration.execute();
            return;
          }

          // Execute generated SQL statements sequentially (no phase-sorting here since it's single execution)
          for (const sql of sqlStatements) {
            await databaseDriver.query(sql);
          }
        };

        if (shouldUseTransaction && databaseDriver.transaction) {
          // Transactional execution
          await databaseDriver.transaction(async () => {
            await applyMigration();

            // Record migration tracking
            if (record) {
              if (direction === "up") {
                const batch = options.batch ?? (await this.getNextBatchNumber(dataSource));
                await this.recordMigration(
                  name,
                  batch,
                  MigrationClass.createdAt ? parseCreatedAt(MigrationClass.createdAt) : new Date(),
                  dataSource,
                );
              } else {
                await this.removeMigrationRecord(name, dataSource);
              }
            }
          });
        } else {
          // Non-transactional execution
          await applyMigration();

          if (record) {
            if (direction === "up") {
              const batch = options.batch ?? (await this.getNextBatchNumber(dataSource));
              await this.recordMigration(
                name,
                batch,
                MigrationClass.createdAt ? parseCreatedAt(MigrationClass.createdAt) : new Date(),
                dataSource,
              );
            } else {
              await this.removeMigrationRecord(name, dataSource);
            }
          }
        }
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      log.error("database", "migration", `${colors.magenta(name)}: ✗ Failed: ${error}`);
      throw err;
    }

    const durationMs = Date.now() - startTime;

    if (success) {
      log.success(
        "database",
        "migration",
        `${direction == "up" ? "Migrated" : "Rolled back"}: ${colors.magenta(name)} successfully (${durationMs}ms)`,
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
   * Create, configure, and return a ready-to-use migration instance.
   *
   * Centralises the repeated "new + setDriver + setMigrationDefaults" boilerplate
   * that all batch/single execution paths need.
   *
   * @internal
   */
  private createMigrationInstance(MigrationClass: MigrationClass): Migration {
    const migration = new MigrationClass();
    const dataSource = this.resolveDataSource(migration.dataSource);
    migration.setDriver(this.getMigrationDriver(dataSource));
    migration.setMigrationDefaults(dataSource.migrationDefaults);
    return migration;
  }

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
  private formatSQLForExport(statements: TaggedSQL[], compact: boolean = false): string {
    const lines: string[] = [];

    if (compact) {
      // Just output raw statements, no grouping, no blank lines
      for (const stmt of statements) {
        lines.push(`${stmt.sql};`);
      }
      return lines.join("\n");
    }

    // Group statements by their phase and migration name
    const grouped = new Map<string, string[]>();

    for (const stmt of statements) {
      const groupKey = `Phase ${stmt.phase} [${stmt.migrationName}]`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(stmt.sql);
    }

    // Format each group
    for (const [groupKey, sqls] of grouped.entries()) {
      if (lines.length > 0) lines.push(""); // blank line between groups
      lines.push(`/* ${groupKey} */`);
      for (const sql of sqls) {
        lines.push(`${sql};`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get pending (not executed) registered migrations, in the order they would
   * execute.
   *
   * ⚠️ "Registered" is load-bearing. This filters `this.migrations`, which is
   * populated only by `register()` / `registerMany()`. A caller that has not
   * registered anything gets `[]` — indistinguishable from a database with
   * nothing pending. Anything reporting this set to a human MUST register
   * migrations first, or it will print a confident all-clear over an unknown.
   *
   * @see listPendingMigrations
   */
  public async getPendingMigrations(): Promise<MigrationClass[]> {
    // "Executed" is judged in each migration's own data source's migrations table.
    const executedNames = new Map<DataSource, Set<string>>();
    for (const dataSource of this.getSources()) {
      const executed = await this.getExecutedMigrations(dataSource);
      executedNames.set(dataSource, new Set(executed.map((r) => r.name)));
    }

    const migrations = this.migrations.filter(
      (m) => !executedNames.get(this.sourceOf(m))?.has(m.migrationName),
    );

    return migrations.sort(sortMigrations);
  }

  /**
   * Get migrations to rollback, newest-first.
   *
   * A rollback must undo migrations in the exact inverse of the order `up`
   * applied them, or a `down()` will hit schema its predecessor already
   * removed — dropping a table before dropping the column added to it, say.
   *
   * The sort has to be explicitly **descending**. Reversing the executed list
   * is not enough: `getExecutedMigrations` orders by `batch, name`, so the
   * input is alphabetical rather than chronological, and reversing it only
   * yields reverse-alphabetical order. (Sorting *ascending* here — which is
   * what this method used to do after a `.reverse()` — silently restored the
   * forward `up` order and made the reverse dead code.)
   */
  private async getMigrationsToRollback(batches: number): Promise<MigrationClass[]> {
    const migrations: MigrationClass[] = [];

    // Batches are numbered per data source (each has its own migrations table).
    for (const dataSource of this.getSources()) {
      const executed = await this.getExecutedMigrations(dataSource);
      if (executed.length === 0) continue;

      const batchNumbers = [...new Set(executed.map((r) => r.batch))]
        .sort((a, b) => b - a)
        .slice(0, batches);

      for (const record of executed) {
        if (!batchNumbers.includes(record.batch)) continue;

        const MigrationClass = this.migrations.find(
          (m) => m.migrationName === record.name && this.sourceOf(m) === dataSource,
        );
        if (MigrationClass) migrations.push(MigrationClass);
      }
    }

    return migrations.sort(sortMigrationsForRollback);
  }

  /**
   * Get executed migration records.
   */
  public async getExecutedMigrations(
    dataSource: DataSource = this.getDataSource(),
  ): Promise<MigrationRecord[]> {
    const driver = dataSource.driver;

    try {
      const migrationDriver = this.getMigrationDriver(dataSource);

      // Ensure migrations table exists
      await migrationDriver.ensureMigrationsTable(this.migrationsTable);

      const queryBuilder = driver.queryBuilder<MigrationRecord>(this.migrationsTable);
      return await queryBuilder.orderBy("batch", "asc").orderBy("name", "asc").get();
    } catch {
      return [];
    }
  }

  /**
   * Record a migration.
   */
  private async recordMigration(
    name: string,
    batch: number,
    createdAt?: Date,
    dataSource: DataSource = this.getDataSource(),
  ): Promise<void> {
    const driver = dataSource.driver;
    const migrationDriver = this.getMigrationDriver(dataSource);

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
  private async removeMigrationRecord(
    name: string,
    dataSource: DataSource = this.getDataSource(),
  ): Promise<void> {
    const driver = dataSource.driver;
    await driver.delete(this.migrationsTable, { name });
  }

  /**
   * Get next batch number.
   */
  private async getNextBatchNumber(
    dataSource: DataSource = this.getDataSource(),
  ): Promise<number> {
    const executed = await this.getExecutedMigrations(dataSource);
    if (executed.length === 0) return 1;
    return Math.max(...executed.map((r) => r.batch)) + 1;
  }
}

export const migrationRunner = new MigrationRunner();
