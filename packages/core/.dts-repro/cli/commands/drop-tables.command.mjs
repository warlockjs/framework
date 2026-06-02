import { command } from "../cli-command.mjs";
import { dropTablesAction } from "../../database/drop-tables-action.mjs";
//#region ../../@warlock.js/core/src/cli/commands/drop-tables.command.ts
const dropTablesCommand = command({
	name: "drop.tables",
	description: "Drop all tables in the database",
	action: dropTablesAction,
	preload: {
		config: ["database", "log"],
		env: true,
		connectors: ["database", "logger"]
	},
	options: [{
		text: "--force, -f",
		description: "Drop tables without confirmation",
		type: "boolean"
	}]
});
//#endregion
export { dropTablesCommand };

//# sourceMappingURL=drop-tables.command.mjs.map