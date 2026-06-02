//#region ../../@warlock.js/cascade/src/operations/database.d.ts
/**
 * Selects which data source the operation runs against. Shared between every
 * function in this module — kept internal because it carries no semantic
 * beyond "look up by registry name".
 */
type DataSourceSelector = {
  /** Data source name from the registry. Omit to use the default source. */readonly connection?: string;
};
/**
 * Result of {@link createDatabase}.
 */
type CreateDatabaseResult = {
  /** True if a new database was created; false if it already existed. */readonly created: boolean; /** The database name that was passed to the operation. */
  readonly name: string;
};
/**
 * Result of {@link dropAllTables}.
 */
type DropAllTablesResult = {
  /** Names of tables that were dropped, in the order returned by the driver. */readonly tables: string[]; /** Count of dropped tables (equal to `tables.length`). */
  readonly dropped: number;
};
/**
 * Create a database on the configured data source. Returns `created: false`
 * when the database already exists — drivers are responsible for the
 * idempotency check.
 *
 * @example
 * await createDatabase("analytics");
 * await createDatabase("analytics", { connection: "warehouse" });
 */
declare function createDatabase(name: string, options?: DataSourceSelector): Promise<CreateDatabaseResult>;
/**
 * Drop every table on the configured data source. Lists tables first so the
 * caller receives the names that were affected — useful for printing,
 * confirmation prompts, or audit logging at the call site.
 *
 * @example
 * const { tables, dropped } = await dropAllTables();
 * console.log(`Dropped ${dropped} tables: ${tables.join(", ")}`);
 */
declare function dropAllTables(options?: DataSourceSelector): Promise<DropAllTablesResult>;
//#endregion
export { CreateDatabaseResult, DropAllTablesResult, createDatabase, dropAllTables };
//# sourceMappingURL=database.d.mts.map