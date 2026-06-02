import { dataSourceRegistry } from "../data-source/data-source-registry.mjs";
import { SQLGrammar } from "./sql-grammar.mjs";
import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import fs from "fs";
import path from "path";
//#region ../../@warlock.js/cascade/src/migration/migration-runner.ts
/**
* Parse createdAt timestamp from custom format to Date.
* Supports both: MM-DD-YYYY_HH-MM-SS and DD-MM-YYYY_HH-MM-SS
* Intelligently detects format by checking if first value > 12 (must be day)
* Falls back to standard Date parsing for ISO strings.
*/
function parseCreatedAt(createdAt) {
	const match = createdAt.match(/^(\d{2})-(\d{2})-(\d{4})_(\d{2})-(\d{2})-(\d{2})$/);
	if (match) {
		const [, first, second, year, hour, minute, second_time] = match;
		const firstNum = parseInt(first);
		const secondNum = parseInt(second);
		let month, day;
		if (firstNum > 12) {
			day = firstNum;
			month = secondNum;
		} else if (secondNum > 12) {
			month = firstNum;
			day = secondNum;
		} else {
			month = firstNum;
			day = secondNum;
		}
		const date = new Date(parseInt(year), month - 1, day, parseInt(hour), parseInt(minute), parseInt(second_time));
		if (isNaN(date.getTime())) return;
		return date;
	}
	try {
		const date = new Date(createdAt);
		return isNaN(date.getTime()) ? void 0 : date;
	} catch {
		return;
	}
}
/**
* Comparator for sorting migration classes.
*
* Priority:
*   1. `createdAt` timestamp (older = earlier)
*   2. Alphabetical by migration name (last resort)
*/
function sortMigrations(a, b) {
	const aDate = a.createdAt ? parseCreatedAt(a.createdAt) : void 0;
	const bDate = b.createdAt ? parseCreatedAt(b.createdAt) : void 0;
	if (aDate && bDate) return aDate.getTime() - bDate.getTime();
	if (aDate) return -1;
	if (bDate) return 1;
	return a.migrationName.localeCompare(b.migrationName);
}
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
var MigrationRunner = class {
	/** Registered migrations */
	migrations = [];
	/** Data source to use */
	dataSource;
	/** Cached migration driver */
	cachedMigrationDriver;
	/** Table name for tracking migrations */
	migrationsTable;
	/** Whether to log operations */
	verbose;
	/**
	* Create a new migration runner.
	*
	* @param options - Runner options
	*/
	constructor(options = {}) {
		this.dataSource = options.dataSource;
		this.migrationsTable = options.migrationsTable ?? "_migrations";
		this.verbose = options.verbose ?? true;
	}
	/**
	* Set the data source.
	*/
	setDataSource(dataSource) {
		this.dataSource = dataSource;
		this.cachedMigrationDriver = void 0;
		return this;
	}
	/**
	* Get the data source.
	*/
	getDataSource() {
		if (!this.dataSource) this.dataSource = dataSourceRegistry.get();
		return this.dataSource;
	}
	/**
	* Get the migration driver.
	*/
	getMigrationDriver() {
		if (!this.cachedMigrationDriver) this.cachedMigrationDriver = this.getDataSource().driver.migrationDriver();
		return this.cachedMigrationDriver;
	}
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
	register(MigrationClass) {
		const name = MigrationClass.migrationName;
		if (!name) throw new Error("Migration class must have a static 'migrationName' property set. Set it in CLI after importing: MigrationClass.migrationName = \"filename\";");
		if (!this.migrations.some((m) => m.migrationName === name)) this.migrations.push(MigrationClass);
		return this;
	}
	/**
	* Register multiple migrations.
	*
	* @param migrations - Array of migration classes
	* @returns This runner for chaining
	*/
	registerMany(migrations) {
		for (const MigrationClass of migrations) this.register(MigrationClass);
		return this;
	}
	/**
	* Clear all registered migrations.
	*/
	clear() {
		this.migrations.length = 0;
		return this;
	}
	/**
	* Get all registered migration names.
	*/
	getRegisteredNames() {
		return this.migrations.map((m) => m.migrationName);
	}
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
	async run(MigrationClass, options = {}) {
		return this.runMigration(MigrationClass, "up", {
			dryRun: options.dryRun,
			record: options.record ?? false
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
	async rollback(MigrationClass, options = {}) {
		return this.runMigration(MigrationClass, "down", {
			dryRun: options.dryRun,
			record: options.record ?? false
		});
	}
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
	async runAll(options = {}) {
		const { dryRun = false, record = true } = options;
		const results = [];
		const pending = await this.getPendingMigrations();
		if (pending.length === 0) {
			log.warn("database", "migration", "Nothing to migrate.");
			return results;
		}
		log.info("database", "migration", `Found ${pending.length} pending migration(s). Generating SQL pool...`);
		const nextBatch = await this.getNextBatchNumber();
		const taggedStatements = [];
		const migrationsData = [];
		const extensionChecks = [];
		for (const MigrationClass of pending) {
			const migration = this.createMigrationInstance(MigrationClass);
			const name = MigrationClass.migrationName;
			await migration.up();
			const upStatements = migration.toSQL();
			migrationsData.push({
				MigrationClass,
				migration,
				name
			});
			for (const sql of upStatements) {
				const statementType = SQLGrammar.classify(sql);
				if (statementType === "CREATE_EXTENSION") {
					const ext = SQLGrammar.extractExtensionName(sql);
					if (ext) extensionChecks.push(this.informIfExtensionMissing(ext));
				}
				taggedStatements.push({
					sql,
					phase: SQLGrammar.phase(sql),
					statementType,
					createdAt: MigrationClass.createdAt,
					migrationName: name
				});
			}
		}
		await Promise.all(extensionChecks);
		const sortedStatements = SQLGrammar.sort(taggedStatements);
		if (dryRun) {
			log.info("database", "migration", "Dry run enabled. Would execute the following statements:");
			for (const statement of sortedStatements) {
				console.log(`-- [${statement.statementType}] Phase ${statement.phase} [${statement.migrationName}]`);
				console.log(statement.sql + ";\n");
			}
			return [];
		}
		const driver = this.getDataSource().driver;
		let transactionFailed = false;
		let errorMessage = "";
		/** The migration name that owns the SQL statement that threw. */
		let failingMigrationName;
		const startTime = Date.now();
		/**
		* Execute all sorted statements, capturing which migration owns the
		* statement that throws — so we report a precise culprit instead of
		* blaming every migration in the batch.
		*/
		const executeStatements = async () => {
			for (const statement of sortedStatements) try {
				await driver.query(statement.sql);
			} catch (err) {
				failingMigrationName = statement.migrationName;
				throw err;
			}
			if (record) for (const data of migrationsData) await this.recordMigration(data.name, nextBatch, data.MigrationClass.createdAt ? parseCreatedAt(data.MigrationClass.createdAt) : /* @__PURE__ */ new Date());
		};
		try {
			if (driver.transaction) await driver.transaction(executeStatements);
			else await executeStatements();
		} catch (err) {
			transactionFailed = true;
			errorMessage = err instanceof Error ? err.message : String(err);
		}
		const durationMs = Date.now() - startTime;
		for (const data of migrationsData) {
			const isCulprit = transactionFailed && data.name === failingMigrationName;
			const wasSkipped = transactionFailed && !isCulprit;
			results.push({
				name: data.name,
				table: data.migration.table,
				direction: "up",
				success: !transactionFailed,
				error: isCulprit ? errorMessage : void 0,
				durationMs: Math.round(durationMs / migrationsData.length),
				executedAt: /* @__PURE__ */ new Date()
			});
			if (isCulprit) log.error("database", "migration", `${colors.magenta(data.name)}: ✗ Failed: ${errorMessage}`);
			else if (wasSkipped) log.warn("database", "migration", `${colors.magenta(data.name)}: rolled back (batch transaction failed)`);
			else log.success("database", "migration", `Migrated: ${colors.magenta(data.name)} successfully`);
		}
		if (transactionFailed) {
			log.error("database", "migration", `Batch execution failed. Rollback performed if transactional.`);
			throw new Error("Migration batch failed: " + errorMessage);
		}
		const successCount = results.filter((r) => r.success).length;
		log.success("database", "migration", `Migration bulk phase execution complete: ${successCount}/${pending.length} migrations processed successfully.`);
		return results;
	}
	/**
	* Export migrations as phase-ordered SQL files in database/sql/ directory.
	* By default, it exports all registered migrations. Use `pendingOnly: true` to export only pending ones.
	*/
	async exportSQL(options = {}) {
		const migrationsToExport = options.pendingOnly ? await this.getPendingMigrations() : this.migrations;
		if (migrationsToExport.length === 0) {
			log.warn("database", "migration", "No migrations to export.");
			return;
		}
		log.info("database", "migration", `Exporting ${migrationsToExport.length} ${options.pendingOnly ? "pending " : ""}migration(s) to SQL files...`);
		const upStatements = [];
		const downStatements = [];
		for (const MigrationClass of migrationsToExport) {
			const migration = this.createMigrationInstance(MigrationClass);
			const name = MigrationClass.migrationName;
			await migration.up();
			for (const sql of migration.toSQL()) upStatements.push({
				sql,
				phase: SQLGrammar.phase(sql),
				statementType: SQLGrammar.classify(sql),
				createdAt: MigrationClass.createdAt,
				migrationName: name
			});
			await migration.down();
			for (const sql of migration.toSQL()) downStatements.push({
				sql,
				phase: SQLGrammar.phase(sql),
				statementType: SQLGrammar.classify(sql),
				createdAt: MigrationClass.createdAt,
				migrationName: name
			});
		}
		const sortedUp = SQLGrammar.sort(upStatements);
		const sortedDown = downStatements.reverse();
		const upSQLString = this.formatSQLForExport(sortedUp, options.compact);
		const downSQLString = this.formatSQLForExport(sortedDown, options.compact);
		const rootPath = process.cwd();
		const sqlDir = path.join(rootPath, "database", "sql");
		if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true });
		const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0];
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
	async rollbackLast(options = {}) {
		return this.rollbackBatches(1, options);
	}
	/**
	* Rollback N batches of migrations.
	*
	* @param batches - Number of batches to rollback
	* @param options - Execution options
	* @returns Results for each migration
	*/
	async rollbackBatches(batches, options = {}) {
		const dryRun = options.dryRun ?? false;
		const record = options.record ?? true;
		const results = [];
		const toRollback = await this.getMigrationsToRollback(batches);
		if (toRollback.length === 0) {
			log.warn("database", "migration", "Nothing to rollback.");
			return results;
		}
		log.info("database", "migration", `Rolling back ${toRollback.length} migration(s).`);
		for (const MigrationClass of toRollback) {
			const result = await this.runMigration(MigrationClass, "down", {
				dryRun,
				record
			});
			results.push(result);
			if (!result.success) break;
		}
		const successCount = results.filter((r) => r.success).length;
		log.success("database", "migration", `Rollback complete: ${successCount}/${toRollback.length} successful.`);
		return results;
	}
	/**
	* Rollback all executed migrations.
	*
	* @param options - Execution options
	* @returns Results for each migration
	*/
	async rollbackAll(options = {}) {
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
	async fresh(options = {}) {
		const rollbackResults = await this.rollbackAll(options);
		const runResults = await this.runAll(options);
		return [...rollbackResults, ...runResults];
	}
	/**
	* Get status of all registered migrations.
	*/
	async status() {
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
				batch: record?.batch ?? null
			};
		});
	}
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
	async informIfExtensionMissing(extension) {
		try {
			const migrationDriver = this.getMigrationDriver();
			if (!await migrationDriver.isExtensionAvailable(extension)) {
				const hr = "─".repeat(60);
				console.log(`\n${colors.yellow(hr)}`);
				console.log(colors.yellow(`  ⚠  Missing Database Extension: ${colors.bold(extension)}`));
				console.log(colors.yellow(hr));
				console.log();
				console.log(`  A pending migration requires the ${colors.cyan(extension)} extension,`);
				console.log(`  which is not installed on your database server.`);
				console.log();
				console.log(`  ${colors.bold("This means the physical database server is missing the extension package.")}`);
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
		} catch {}
	}
	/**
	* Run a single migration.
	*/
	async runMigration(MigrationClass, direction, options = {}) {
		const { dryRun = false, record = true } = options;
		const startTime = Date.now();
		let success = true;
		let error;
		const migration = new MigrationClass();
		const name = MigrationClass.migrationName;
		log.info("database", "migration", `${direction === "up" ? "Migrating" : "Rolling back"}: ${colors.magenta(name)}...`);
		try {
			if (!dryRun) {
				const driver = this.getMigrationDriver();
				migration.setDriver(driver);
				migration.setMigrationDefaults(this.getDataSource().migrationDefaults);
				const shouldUseTransaction = migration.transactional ?? this.getDataSource().migrations?.transactional ?? driver.getDefaultTransactional();
				if (direction === "up") await migration.up();
				else await migration.down();
				const sqlStatements = migration.toSQL();
				const databaseDriver = this.getDataSource().driver;
				if (shouldUseTransaction && databaseDriver.transaction) await databaseDriver.transaction(async () => {
					for (const sql of sqlStatements) await databaseDriver.query(sql);
					if (record) if (direction === "up") {
						const batch = options.batch ?? await this.getNextBatchNumber();
						await this.recordMigration(name, batch, MigrationClass.createdAt ? parseCreatedAt(MigrationClass.createdAt) : /* @__PURE__ */ new Date());
					} else await this.removeMigrationRecord(name);
				});
				else {
					for (const sql of sqlStatements) await databaseDriver.query(sql);
					if (record) if (direction === "up") {
						const batch = options.batch ?? await this.getNextBatchNumber();
						await this.recordMigration(name, batch, MigrationClass.createdAt ? parseCreatedAt(MigrationClass.createdAt) : /* @__PURE__ */ new Date());
					} else await this.removeMigrationRecord(name);
				}
			}
		} catch (err) {
			success = false;
			error = err instanceof Error ? err.message : String(err);
			log.error("database", "migration", `${colors.magenta(name)}: ✗ Failed: ${error}`);
			throw err;
		}
		const durationMs = Date.now() - startTime;
		if (success) log.success("database", "migration", `${direction == "up" ? "Migrated" : "Rolled back"}: ${colors.magenta(name)} successfully (${durationMs}ms)`);
		return {
			name,
			table: migration.table,
			direction,
			success,
			error,
			durationMs,
			executedAt: /* @__PURE__ */ new Date()
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
	createMigrationInstance(MigrationClass) {
		const migration = new MigrationClass();
		migration.setDriver(this.getMigrationDriver());
		migration.setMigrationDefaults(this.getDataSource().migrationDefaults);
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
	formatSQLForExport(statements, compact = false) {
		const lines = [];
		if (compact) {
			for (const stmt of statements) lines.push(`${stmt.sql};`);
			return lines.join("\n");
		}
		const grouped = /* @__PURE__ */ new Map();
		for (const stmt of statements) {
			const groupKey = `Phase ${stmt.phase} [${stmt.migrationName}]`;
			if (!grouped.has(groupKey)) grouped.set(groupKey, []);
			grouped.get(groupKey).push(stmt.sql);
		}
		for (const [groupKey, sqls] of grouped.entries()) {
			if (lines.length > 0) lines.push("");
			lines.push(`/* ${groupKey} */`);
			for (const sql of sqls) lines.push(`${sql};`);
		}
		return lines.join("\n");
	}
	/**
	* Get pending (not executed) registered migrations.
	*/
	async getPendingMigrations() {
		const executed = await this.getExecutedMigrations();
		const executedNames = new Set(executed.map((r) => r.name));
		return this.migrations.filter((m) => !executedNames.has(m.migrationName)).sort(sortMigrations);
	}
	/**
	* Get migrations to rollback.
	*/
	async getMigrationsToRollback(batches) {
		const executed = await this.getExecutedMigrations();
		if (executed.length === 0) return [];
		const batchNumbers = [...new Set(executed.map((r) => r.batch))].sort((a, b) => b - a).slice(0, batches);
		return executed.filter((r) => batchNumbers.includes(r.batch)).reverse().map((r) => this.migrations.find((m) => m.migrationName === r.name)).filter((m) => !!m).sort(sortMigrations);
	}
	/**
	* Get executed migration records.
	*/
	async getExecutedMigrations() {
		const driver = this.getDataSource().driver;
		try {
			await this.getMigrationDriver().ensureMigrationsTable(this.migrationsTable);
			return await driver.queryBuilder(this.migrationsTable).orderBy("batch", "asc").orderBy("name", "asc").get();
		} catch {
			return [];
		}
	}
	/**
	* Record a migration.
	*/
	async recordMigration(name, batch, createdAt) {
		const driver = this.getDataSource().driver;
		await this.getMigrationDriver().ensureMigrationsTable(this.migrationsTable);
		await driver.insert(this.migrationsTable, {
			name,
			batch,
			executedAt: /* @__PURE__ */ new Date(),
			createdAt
		});
	}
	/**
	* Remove a migration record.
	*/
	async removeMigrationRecord(name) {
		await this.getDataSource().driver.delete(this.migrationsTable, { name });
	}
	/**
	* Get next batch number.
	*/
	async getNextBatchNumber() {
		const executed = await this.getExecutedMigrations();
		if (executed.length === 0) return 1;
		return Math.max(...executed.map((r) => r.batch)) + 1;
	}
};
const migrationRunner = new MigrationRunner();
//#endregion
export { MigrationRunner, migrationRunner };

//# sourceMappingURL=migration-runner.mjs.map