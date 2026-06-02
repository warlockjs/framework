import { srcPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Path } from "../dev-server/path.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { getFilesFromDirectory } from "../dev-server/utils.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { exportMigrationsSQL, freshMigrate, listExecutedMigrations, migrationRunner, rollbackMigrations, runMigrations } from "@warlock.js/cascade";
import path from "path";
import { colors } from "@mongez/copper";
import dayjs from "dayjs";
//#region ../../@warlock.js/core/src/database/migrate-action.ts
async function listMigrationsAction() {
	const createdMigrations = await listExecutedMigrations();
	console.log(`\nTotal Executed Migrations: ${colors.green(createdMigrations.length)}\n`);
	if (createdMigrations.length === 0) {
		console.log(colors.gray("  No migrations have been executed yet.\n"));
		return;
	}
	for (const migration of createdMigrations) {
		const executedAt = dayjs(migration.executedAt).format("DD-MM-YYYY hh:mm:ss A");
		const createdAt = migration.createdAt ? dayjs(migration.createdAt).format("DD-MM-YYYY hh:mm:ss A") : null;
		console.log(`  ${colors.green("✔")} ${colors.cyanBright(migration.name)}`);
		console.log(`    ${colors.gray("Executed:")} ${colors.white(executedAt)}`);
		if (createdAt) console.log(`    ${colors.gray("Created:")}  ${colors.yellow(createdAt)}`);
		console.log("");
	}
}
async function allMigrationsFilesAction() {
	const files = (await migrationFiles()).map((path) => Path.toRelative(path));
	console.log(`Total Migration Files: ${colors.green(files.length)}`);
	for (const file of files) console.log(colors.yellowBright(file));
}
/**
* If path is provided, then run the migration runner against that file only
* If fresh is provided, then rollback all migrations and run all migrations
* If rollback is provided, then run the migration runner against all files in reverse order
*/
async function migrateAction(options) {
	const { fresh, path, rollback, all, list, sql, pendingOnly, compact } = options.options;
	if (list) return await listMigrationsAction();
	if (all) return await allMigrationsFilesAction();
	if (path) await loadMigrationFile(Path.toAbsolute(path));
	else await loadAllMigrations();
	if (fresh && rollback) {
		console.log(colors.redBright("You can't use --fresh and --rollback together"));
		process.exit(1);
	}
	if (rollback) {
		await rollbackMigrations({ all: true });
		return;
	}
	if (sql) {
		await exportMigrationsSQL({
			pendingOnly,
			compact
		});
		return;
	}
	if (fresh) {
		await freshMigrate();
		return;
	}
	await runMigrations();
}
async function loadMigrationFile(absPath) {
	const relativePath = Path.toRelative(absPath);
	const loadedModule = await filesOrchestrator.load(relativePath);
	if (!loadedModule?.default) throw new Error(`${Path.toRelative(absPath)} must have a default export`);
	const MigrationClass = loadedModule.default;
	if (!MigrationClass.migrationName) MigrationClass.migrationName = path.basename(absPath).split(".")[0].replace("-migration", "").replace("_migration", "");
	if (!MigrationClass.createdAt) {
		const timestampMatch = path.basename(absPath).match(/^(\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2})/);
		if (timestampMatch) MigrationClass.createdAt = timestampMatch[1];
	}
	migrationRunner.register(MigrationClass);
}
/**
*
* @returns List of absolute paths to migration files
*/
async function migrationFiles() {
	const migrationFiles = await getFilesFromDirectory(srcPath("app"), "*/models/*/migrations/*");
	const separateMigrationsFolderFIles = await getFilesFromDirectory(srcPath("app"), "*/migrations/*");
	return [...migrationFiles, ...separateMigrationsFolderFIles];
}
async function loadAllMigrations() {
	const configMigrations = warlockConfigManager.get("database")?.migrations || [];
	for (const MigrationClass of configMigrations) {
		if (!MigrationClass.migrationName) MigrationClass.migrationName = MigrationClass.name;
		migrationRunner.register(MigrationClass);
	}
	const migrations = await migrationFiles();
	for (const migrationFile of migrations) await loadMigrationFile(migrationFile);
}
//#endregion
export { migrateAction };

//# sourceMappingURL=migrate-action.mjs.map