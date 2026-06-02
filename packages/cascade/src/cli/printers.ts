import { colors } from "@mongez/copper";
import type { MigrationRecord, MigrationResult } from "../migration/types";

/**
 * Format a `Date` as `DD-MM-YYYY HH:mm` in the local timezone, or `—` when
 * the value is missing.
 */
function formatDate(date: Date | null | undefined): string {
  if (!date) {
    return "—";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}`;
}

/**
 * Print the executed-migrations table — one entry per migration row in the
 * migrations table, with executed and (when available) created timestamps.
 *
 * @example
 * const executed = await listExecutedMigrations();
 * printExecutedMigrations(executed);
 */
export function printExecutedMigrations(executed: readonly MigrationRecord[]): void {
  console.log(`\nTotal Executed Migrations: ${colors.green(String(executed.length))}\n`);

  if (executed.length === 0) {
    console.log(colors.gray("  No migrations have been executed yet.\n"));
    return;
  }

  for (const record of executed) {
    console.log(`  ${colors.green("✔")} ${colors.cyanBright(record.name)}`);
    console.log(`    ${colors.gray("Executed:")} ${colors.white(formatDate(record.executedAt))}`);

    if (record.createdAt) {
      console.log(`    ${colors.gray("Created:")}  ${colors.yellow(formatDate(record.createdAt))}`);
    }

    console.log("");
  }
}

/**
 * Print a one-line summary after a run/rollback. The migration runner already
 * logs per-migration progress through `@warlock.js/logger`; this adds a final
 * tally so success/failure is immediately visible at the bottom of the
 * output.
 *
 * @example
 * const results = await runMigrations();
 * printRunSummary(results);
 */
export function printRunSummary(results: readonly MigrationResult[]): void {
  if (results.length === 0) {
    return;
  }

  const successful = results.filter((result) => result.success).length;
  const failed = results.length - successful;

  console.log("");

  if (failed === 0) {
    console.log(
      `${colors.green("✔")} ${colors.green(`${successful}/${results.length}`)} migrations completed.`,
    );
    return;
  }

  console.log(
    `${colors.red("✗")} ${colors.red(`${failed}/${results.length}`)} migrations failed.`,
  );
}
