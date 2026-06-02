import { migrationRunner } from "../migration/migration-runner.mjs";
//#region ../../@warlock.js/cascade/src/operations/migrations.ts
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
async function runMigrations() {
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
async function rollbackMigrations(options = {}) {
	if (options.all) return migrationRunner.rollbackAll();
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
async function freshMigrate() {
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
async function exportMigrationsSQL(options = {}) {
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
async function listExecutedMigrations() {
	return migrationRunner.getExecutedMigrations();
}
//#endregion
export { exportMigrationsSQL, freshMigrate, listExecutedMigrations, rollbackMigrations, runMigrations };

//# sourceMappingURL=migrations.mjs.map