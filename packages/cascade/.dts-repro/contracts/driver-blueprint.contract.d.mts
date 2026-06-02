//#region ../../@warlock.js/cascade/src/contracts/driver-blueprint.contract.d.ts
interface DriverBlueprintContract {
  /**
   * Get tables list
   */
  listTables(): Promise<string[]>;
  /**
   * Get all indexes of the given table
   */
  listIndexes(table: string): Promise<TableIndexInformation[]>;
  /**
   * Get all tables of the database
   */
  listTables(): Promise<string[]>;
  /**
   * Get all columns of the given table
   */
  listColumns(table: string): Promise<string[]>;
  /**
   * Check if the given table exists
   */
  tableExists(table: string): Promise<boolean>;
}
type TableIndexInformation = {
  /**
   * Index name
   */
  name: string;
  /**
   * Index columns
   */
  columns?: string[];
  /**
   * Index type
   */
  type?: string;
  /**
   * Index unique
   */
  unique: boolean;
  /**
   * Index partial
   */
  partial: boolean;
  /**
   * Index options
   */
  options: Record<string, any>;
};
//#endregion
export { DriverBlueprintContract, TableIndexInformation };
//# sourceMappingURL=driver-blueprint.contract.d.mts.map