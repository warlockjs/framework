import { Context } from "@warlock.js/context";
import type { DataSource } from "../data-source/data-source";
type DataSourceContextValue = string | DataSource;
type DataSourceContextStore = {
    dataSource?: DataSourceContextValue;
};
/**
 * Database DataSource Context
 *
 * Manages the active database connection/data source using AsyncLocalStorage.
 * Extends the base Context class for consistent API.
 */
declare class DatabaseDataSourceContext extends Context<DataSourceContextStore> {
    /**
     * Get the current data source
     */
    getDataSource(): DataSourceContextValue | undefined;
    /**
     * Set the data source in context
     */
    setDataSource(dataSource: DataSourceContextValue): void;
    /**
     * Build the initial data source store with defaults
     */
    buildStore(): DataSourceContextStore;
}
export declare const databaseDataSourceContext: DatabaseDataSourceContext;
export {};
//# sourceMappingURL=database-data-source-context.d.ts.map