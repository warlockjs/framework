import { command } from "../cli-command.mjs";
import { seedCommandAction } from "../../database/seed-command-action.mjs";
//#region ../../@warlock.js/core/src/cli/commands/seed.command.ts
const seedCommand = command({
	action: seedCommandAction,
	name: "seed",
	description: "Run database seeds",
	preload: {
		config: true,
		env: true,
		bootstrap: true,
		connectors: [
			"database",
			"cache",
			"logger"
		]
	},
	options: [
		{
			text: "--fresh, -f",
			description: "Drop all tables records and run seeds",
			type: "boolean"
		},
		{
			text: "--list, -l",
			description: "Display the seeds list in order without execution",
			type: "boolean"
		},
		{
			text: "--transaction, -t",
			description: "Run seeds in a transaction",
			type: "boolean",
			defaultValue: true
		}
	]
});
//#endregion
export { seedCommand };

//# sourceMappingURL=seed.command.mjs.map