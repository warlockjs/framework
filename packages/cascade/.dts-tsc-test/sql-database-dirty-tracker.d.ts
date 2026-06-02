import { DatabaseDirtyTracker } from "./database-dirty-tracker";
/**
 * A dirty tracker designed for SQL databases where nested objects shouldn't be flattened.
 * Since SQL drivers (like Postgres) replace the entire JSON column when updated,
 * we keep the object intact instead of using dot-notation keys.
 */
export declare class SqlDatabaseDirtyTracker extends DatabaseDirtyTracker {
    /**
     * Overrides the default flattening behavior to keep the raw data structure.
     */
    protected flattenData(data: Record<string, unknown>): Record<string, unknown>;
}
//# sourceMappingURL=sql-database-dirty-tracker.d.ts.map