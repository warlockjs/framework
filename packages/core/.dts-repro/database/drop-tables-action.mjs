import { confirm } from "../cli/commands/generate/utils/prompt.mjs";
import { dataSourceRegistry, dropAllTables } from "@warlock.js/cascade";
import { log } from "@warlock.js/logger";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/database/drop-tables-action.ts
async function dropTablesAction(command) {
	const { force } = command.options;
	if (force) {
		const { dropped } = await dropAllTables();
		log.success("database", "drop", `Dropped ${colors.yellowBright(dropped)} tables successfully.`);
		return;
	}
	const driver = dataSourceRegistry.get().driver;
	const tables = await driver.blueprint.listTables();
	if (tables.length === 0) {
		log.warn("database", "drop", "No tables found in the database.");
		return;
	}
	log.info("database", "drop", `Found ${colors.yellowBright(tables.length)} tables:`);
	for (const table of tables) {
		const count = await driver.queryBuilder(table).count();
		console.log(`  - ${colors.cyan(table)}: ${colors.green(count)} rows`);
	}
	if (!await confirm(`Are you sure you want to drop all ${colors.red(tables.length)} tables?`)) {
		log.info("database", "drop", "Operation cancelled.");
		return;
	}
	const { dropped } = await dropAllTables();
	log.success("database", "drop", `Dropped ${colors.yellowBright(dropped)} tables successfully.`);
}
//#endregion
export { dropTablesAction };

//# sourceMappingURL=drop-tables-action.mjs.map