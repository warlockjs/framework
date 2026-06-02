import { command } from "../cli-command.mjs";
import { createDatabaseAction } from "../../database/create-database-action.mjs";
//#region ../../@warlock.js/core/src/cli/commands/create-database.command.ts
const createDatabaseCommand = command({
	name: "create-database <name>",
	alias: "cdb",
	description: "Create a new database",
	action: createDatabaseAction,
	preload: {
		config: ["database", "log"],
		env: true,
		connectors: ["database"]
	},
	options: [{
		text: "--connection, -c",
		description: "Database connection name",
		defaultValue: "default"
	}]
});
//#endregion
export { createDatabaseCommand };

//# sourceMappingURL=create-database.command.mjs.map