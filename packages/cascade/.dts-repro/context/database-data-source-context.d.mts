import { DataSource } from "../data-source/data-source.mjs";
import { Context } from "@warlock.js/context";

//#region ../../@warlock.js/cascade/src/context/database-data-source-context.d.ts
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
declare const databaseDataSourceContext: DatabaseDataSourceContext;
//#endregion
export { databaseDataSourceContext };
//# sourceMappingURL=database-data-source-context.d.mts.map