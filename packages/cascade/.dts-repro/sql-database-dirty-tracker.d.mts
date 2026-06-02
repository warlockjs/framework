import { DatabaseDirtyTracker } from "./database-dirty-tracker.mjs";

//#region ../../@warlock.js/cascade/src/sql-database-dirty-tracker.d.ts
/**
 * A dirty tracker designed for SQL databases where nested objects shouldn't be flattened.
 * Since SQL drivers (like Postgres) replace the entire JSON column when updated,
 * we keep the object intact instead of using dot-notation keys.
 */
declare class SqlDatabaseDirtyTracker extends DatabaseDirtyTracker {
  /**
   * Overrides the default flattening behavior to keep the raw data structure.
   */
  protected flattenData(data: Record<string, unknown>): Record<string, unknown>;
}
//#endregion
export { SqlDatabaseDirtyTracker };
//# sourceMappingURL=sql-database-dirty-tracker.d.mts.map