import type { MigrationRecord, MigrationResult } from "../migration/types";
/**
 * Print the executed-migrations table — one entry per migration row in the
 * migrations table, with executed and (when available) created timestamps.
 *
 * @example
 * const executed = await listExecutedMigrations();
 * printExecutedMigrations(executed);
 */
export declare function printExecutedMigrations(executed: readonly MigrationRecord[]): void;
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
export declare function printRunSummary(results: readonly MigrationResult[]): void;
//# sourceMappingURL=printers.d.ts.map