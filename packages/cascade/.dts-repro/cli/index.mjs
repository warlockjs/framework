import { migrateCommand } from "./commands/migrate.mjs";
import { migrateExportSqlCommand } from "./commands/migrate-export-sql.mjs";
import { migrateListCommand } from "./commands/migrate-list.mjs";
import { migrateRollbackCommand } from "./commands/migrate-rollback.mjs";
import { defineCommand } from "citty";
//#region ../../@warlock.js/cascade/src/cli/index.ts
/**
* Root command for the standalone `cascade` CLI binary. Scope is restricted
* to migration operations — database management (`db:create` etc.) stays in
* the warlock-core CLI where the project context is available.
*
* Subcommands follow colon-style naming (`cascade migrate:list`) so each
* verb stays addressable as a single argv token.
*/
const main = defineCommand({
	meta: {
		name: "cascade",
		description: "Standalone Cascade ORM migration CLI."
	},
	subCommands: {
		migrate: migrateCommand,
		"migrate:list": migrateListCommand,
		"migrate:rollback": migrateRollbackCommand,
		"migrate:export-sql": migrateExportSqlCommand
	}
});
//#endregion
export { main };

//# sourceMappingURL=index.mjs.map