import { colors } from "@mongez/copper";
import { dataSourceRegistry, dropAllTables } from "@warlock.js/cascade";
import { log } from "@warlock.js/logger";
import { confirm } from "../cli/commands/generate/utils/prompt";
import { CommandActionData } from "../cli/types";

export async function dropTablesAction(command: CommandActionData) {
  const { force } = command.options;

  if (force) {
    const { dropped } = await dropAllTables();
    log.success(
      "database",
      "drop",
      `Dropped ${colors.yellowBright(dropped)} tables successfully.`,
    );
    return;
  }

  // Preview phase — we keep direct driver access so we can show per-table
  // row counts before asking for confirmation. The actual drop still goes
  // through the Cascade Operations API.
  const driver = dataSourceRegistry.get().driver;
  const tables = await driver.blueprint.listTables();

  if (tables.length === 0) {
    log.warn("database", "drop", "No tables found in the database.");
    return;
  }

  log.info("database", "drop", `Found ${colors.yellowBright(tables.length)} tables:`);

  for (const table of tables) {
    const count = await driver.queryBuilder(table).count();
    console.log(`  - ${colors.cyan(table)}: ${colors.green(count)} rows`);
  }

  const confirmed = await confirm(
    `Are you sure you want to drop all ${colors.red(tables.length)} tables?`,
  );

  if (!confirmed) {
    log.info("database", "drop", "Operation cancelled.");
    return;
  }

  const { dropped } = await dropAllTables();

  log.success(
    "database",
    "drop",
    `Dropped ${colors.yellowBright(dropped)} tables successfully.`,
  );
}
