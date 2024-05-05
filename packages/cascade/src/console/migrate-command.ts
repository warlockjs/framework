import { command } from "@warlock.js/core";
import { listMigrations, migrate } from "../migration/migrate";
import { connectToDatabase } from "./../utils";

export function registerMigrationCommand() {
  return command("migrate")
    .description("Generate Database Migrations")
    .option("-f, --fresh", "Drop all migrations and generate fresh migrations")
    .option("-l, --list", "List all migrations")
    .action(({ options }) => {
      connectToDatabase();
      if (options.list) {
        return listMigrations();
      }

      migrate(options.fresh);
    });
}
