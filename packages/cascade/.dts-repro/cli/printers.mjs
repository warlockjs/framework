import { colors } from "@mongez/copper";
//#region ../../@warlock.js/cascade/src/cli/printers.ts
/**
* Format a `Date` as `DD-MM-YYYY HH:mm` in the local timezone, or `—` when
* the value is missing.
*/
function formatDate(date) {
	if (!date) return "—";
	return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
/**
* Print the executed-migrations table — one entry per migration row in the
* migrations table, with executed and (when available) created timestamps.
*
* @example
* const executed = await listExecutedMigrations();
* printExecutedMigrations(executed);
*/
function printExecutedMigrations(executed) {
	console.log(`\nTotal Executed Migrations: ${colors.green(String(executed.length))}\n`);
	if (executed.length === 0) {
		console.log(colors.gray("  No migrations have been executed yet.\n"));
		return;
	}
	for (const record of executed) {
		console.log(`  ${colors.green("✔")} ${colors.cyanBright(record.name)}`);
		console.log(`    ${colors.gray("Executed:")} ${colors.white(formatDate(record.executedAt))}`);
		if (record.createdAt) console.log(`    ${colors.gray("Created:")}  ${colors.yellow(formatDate(record.createdAt))}`);
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
function printRunSummary(results) {
	if (results.length === 0) return;
	const successful = results.filter((result) => result.success).length;
	const failed = results.length - successful;
	console.log("");
	if (failed === 0) {
		console.log(`${colors.green("✔")} ${colors.green(`${successful}/${results.length}`)} migrations completed.`);
		return;
	}
	console.log(`${colors.red("✗")} ${colors.red(`${failed}/${results.length}`)} migrations failed.`);
}
//#endregion
export { printExecutedMigrations, printRunSummary };

//# sourceMappingURL=printers.mjs.map