import { exportMigrationsSQL, freshMigrate, runMigrations } from "../../operations/migrations.mjs";
import { loadMigrations } from "../load-migrations.mjs";
import { printRunSummary } from "../printers.mjs";
import { withCliConnection } from "../with-cli-connection.mjs";
import { defineCommand } from "citty";
//#region ../../@warlock.js/cascade/src/cli/commands/migrate.ts
/**
* `cascade migrate` — run all pending migrations against the configured
* data source. With `--fresh` rolls back everything first and re-runs;
* with `--sql` writes phase-ordered SQL files instead of executing.
*/
const migrateCommand = defineCommand({
	meta: {
		name: "migrate",
		description: "Run all pending migrations against the configured data source."
	},
	args: {
		fresh: {
			type: "boolean",
			alias: "f",
			description: "Roll back every executed migration first, then run them again.",
			default: false
		},
		sql: {
			type: "boolean",
			alias: "s",
			description: "Export migrations to phase-ordered SQL files instead of executing.",
			default: false
		},
		"pending-only": {
			type: "boolean",
			description: "When used with --sql, export only pending migrations.",
			default: false
		},
		compact: {
			type: "boolean",
			alias: "c",
			description: "When used with --sql, strip generated comments and blank lines.",
			default: false
		},
		path: {
			type: "string",
			alias: "p",
			description: "Glob pattern overriding the default ./migrations/**/*.{ts,js,mjs,cjs}."
		}
	},
	async run({ args }) {
		await withCliConnection(async () => {
			await loadMigrations(args.path);
			if (args.sql) {
				await exportMigrationsSQL({
					pendingOnly: Boolean(args["pending-only"]),
					compact: Boolean(args.compact)
				});
				return;
			}
			printRunSummary(args.fresh ? await freshMigrate() : await runMigrations());
		});
	}
});
//#endregion
export { migrateCommand };

//# sourceMappingURL=migrate.mjs.map