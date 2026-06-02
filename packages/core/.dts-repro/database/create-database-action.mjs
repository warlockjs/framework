import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import { createDatabase } from "@warlock.js/cascade";
import { log } from "@warlock.js/logger";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/database/create-database-action.ts
async function createDatabaseAction(command) {
	const name = command.args[0];
	const { connection = "default" } = command.options;
	const connectionName = connection === "default" || connection === true ? void 0 : String(connection);
	let databaseName = name;
	if (!databaseName) {
		if (connection === "default") databaseName = config.get("database")?.database;
	}
	if (!databaseName) {
		log.error("database", "create", "Database name is required. Please provide a name or configure it in the database config.");
		return;
	}
	log.info("database", "create", `Creating database ${colors.cyan(databaseName)}...`);
	try {
		const { created } = await createDatabase(databaseName, { connection: connectionName });
		if (created) log.success("database", "create", `Database ${colors.green(databaseName)} created successfully.`);
		else log.warn("database", "create", `Database ${colors.yellow(databaseName)} already exists.`);
	} catch (error) {
		log.error("database", "create", `Failed to create database ${colors.red(databaseName)}: ${error.message}`);
	}
}
//#endregion
export { createDatabaseAction };

//# sourceMappingURL=create-database-action.mjs.map