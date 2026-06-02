import { exportMigrationsSQL } from "../../operations/migrations.mjs";
import { loadMigrations } from "../load-migrations.mjs";
import { withCliConnection } from "../with-cli-connection.mjs";
import { defineCommand } from "citty";
//#region ../../@warlock.js/cascade/src/cli/commands/migrate-export-sql.ts
/**
* `cascade migrate:export-sql` — write phase-ordered `.up.sql` /
* `.down.sql` files for the registered migrations under
* `<cwd>/database/sql/`. No DB writes occur.
*/
const migrateExportSqlCommand = defineCommand({
	meta: {
		name: "migrate:export-sql",
		description: "Write phase-ordered SQL files for the registered migrations."
	},
	args: {
		"pending-only": {
			type: "boolean",
			description: "Export only pending migrations.",
			default: false
		},
		compact: {
			type: "boolean",
			alias: "c",
			description: "Strip generated comments and blank lines.",
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
			await exportMigrationsSQL({
				pendingOnly: Boolean(args["pending-only"]),
				compact: Boolean(args.compact)
			});
		});
	}
});
//#endregion
export { migrateExportSqlCommand };

//# sourceMappingURL=migrate-export-sql.mjs.map