import { listExecutedMigrations } from "../../operations/migrations.mjs";
import { printExecutedMigrations } from "../printers.mjs";
import { withCliConnection } from "../with-cli-connection.mjs";
import { defineCommand } from "citty";
//#region ../../@warlock.js/cascade/src/cli/commands/migrate-list.ts
/**
* `cascade migrate:list` — print every migration that has been executed
* against the configured data source. Reads the migrations table directly;
* does not load files from disk.
*/
const migrateListCommand = defineCommand({
	meta: {
		name: "migrate:list",
		description: "List every migration that has been executed against the data source."
	},
	async run() {
		await withCliConnection(async () => {
			printExecutedMigrations(await listExecutedMigrations());
		});
	}
});
//#endregion
export { migrateListCommand };

//# sourceMappingURL=migrate-list.mjs.map