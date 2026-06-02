/**
 * PostgreSQL Blueprint
 *
 * Implements the DriverBlueprintContract for querying PostgreSQL
 * information schema metadata.
 *
 * @module cascade/drivers/postgres
 */
import type { DriverBlueprintContract, TableIndexInformation } from "../../contracts/driver-blueprint.contract";
import type { PostgresDriver } from "./postgres-driver";
/**
 * PostgreSQL Blueprint.
 *
 * Provides methods for introspecting the database schema
 * via PostgreSQL's information_schema and pg_catalog.
 *
 * @example
 * ```typescript
 * const blueprint = driver.blueprint;
 *
 * // Get all tables
 * const tables = await blueprint.listTables();
 *
 * // Get columns for a table
 * const columns = await blueprint.listColumns('users');
 * ```
 */
export declare class PostgresBlueprint implements DriverBlueprintContract {
    private readonly driver;
    /**
     * Create a new blueprint.
     *
     * @param driver - The PostgreSQL driver instance
     */
    constructor(driver: PostgresDriver);
    /**
     * Get all table names in the database.
     *
     * @returns Array of table names
     */
    listTables(): Promise<string[]>;
    /**
     * Get all indexes for a table.
     *
     * @param table - Table name
     * @returns Array of index information
     */
    listIndexes(table: string): Promise<TableIndexInformation[]>;
    /**
     * Get all column names for a table.
     *
     * @param table - Table name
     * @returns Array of column names
     */
    listColumns(table: string): Promise<string[]>;
    /**
     * Check if a table exists.
     *
     * @param table - Table name
     * @returns Whether the table exists
     */
    tableExists(table: string): Promise<boolean>;
}
//# sourceMappingURL=postgres-blueprint.d.ts.map