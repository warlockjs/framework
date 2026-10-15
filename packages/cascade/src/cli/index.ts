import { defineCommand } from "citty";
import { migrateCommand } from "./commands/migrate";
import { migrateExportSqlCommand } from "./commands/migrate-export-sql";
import { migrateListCommand } from "./commands/migrate-list";
import { migrateRollbackCommand } from "./commands/migrate-rollback";

/**
 * Root command for the standalone `cascade` CLI binary. Scope is restricted
 * to migration operations — database management (`db:create` etc.) stays in
 * the warlock-core CLI where the project context is available.
 *
 * Subcommands follow colon-style naming (`cascade migrate:list`) so each
 * verb stays addressable as a single argv token.
 */
export const main = defineCommand({
  meta: {
    name: "cascade",
    description: "Standalone Cascade ORM migration CLI.",
  },
  subCommands: {
    migrate: migrateCommand,
    "migrate:list": migrateListCommand,
    "migrate:rollback": migrateRollbackCommand,
    "migrate:export-sql": migrateExportSqlCommand,
  },
});
