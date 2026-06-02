import { Model } from "../model/model.mjs";
import { RestorerContract, RestorerOptions, RestorerResult } from "../contracts/database-restorer.contract.mjs";

//#region ../../@warlock.js/cascade/src/restorer/database-restorer.d.ts
/**
 * Database restorer service that orchestrates model restoration.
 *
 * Handles the complete restoration pipeline:
 * 1. Strategy detection (trash vs soft delete)
 * 2. Record retrieval from trash table or soft-deleted records
 * 3. ID conflict resolution
 * 4. Event emission (restoring, restored)
 * 5. Driver execution (insert back to original table, remove from trash/clear deletedAt)
 *
 * @example
 * ```typescript
 * const restorer = new DatabaseRestorer(User);
 * const result = await restorer.restore(123);
 *
 * console.log(result.success); // true
 * console.log(result.strategy); // "trash" | "soft"
 * ```
 */
declare class DatabaseRestorer implements RestorerContract {
  /** Model constructor reference */
  private readonly ctor;
  /** Data source containing driver */
  private readonly dataSource;
  /** Database driver for executing queries */
  private readonly driver;
  /** Table/collection name */
  private readonly table;
  /** Primary key field name */
  private readonly primaryKey;
  /**
   * Create a new restorer instance for a model class.
   *
   * @param modelClass - The model class (static context)
   *
   * @example
   * ```typescript
   * const restorer = new DatabaseRestorer(User);
   * await restorer.restore(123);
   * ```
   */
  constructor(modelClass: typeof Model);
  /**
   * Restore a single deleted record by its ID.
   *
   * @param id - The primary key value of the record to restore
   * @param options - Restorer options
   * @returns Result containing success status, strategy used, and restored record
   * @throws {Error} If record not found in trash or soft-deleted records
   * @throws {Error} If ID conflict and onIdConflict is "fail"
   */
  restore(id: string | number, options?: RestorerOptions): Promise<RestorerResult>;
  /**
   * Restore all deleted records for the model's table.
   *
   * @param options - Restorer options
   * @returns Result containing success status, strategy used, and aggregate counts
   */
  restoreAll(options?: RestorerOptions): Promise<RestorerResult>;
  /**
   * Resolve the delete strategy.
   *
   * Priority: options → model static → data source default → "permanent"
   *
   * @param strategyOption - Optional strategy override from options
   * @returns The resolved delete strategy
   * @private
   */
  private resolveStrategy;
  /**
   * Fetch a record by ID based on the delete strategy.
   *
   * @param id - The primary key value
   * @param strategy - The delete strategy to use
   * @returns The record data, or null if not found
   * @private
   */
  private fetchRecordByStrategy;
  /**
   * Fetch all records based on the delete strategy.
   *
   * @param strategy - The delete strategy to use
   * @returns Array of record data
   * @private
   */
  private fetchAllRecordsByStrategy;
  /**
   * Handle ID conflict by checking if ID exists and assigning new one if needed.
   *
   * @param recordData - The record data to restore
   * @param originalId - The original ID value
   * @param onIdConflict - Conflict resolution strategy
   * @returns Record data with potentially new ID
   * @private
   */
  private handleIdConflict;
  /**
   * Check if an ID already exists in the target table.
   *
   * @param id - The ID to check
   * @returns True if ID exists, false otherwise
   * @private
   */
  private checkIdExists;
  /**
   * Assign a new ID to the record data.
   *
   * For MongoDB: Generates new ObjectId for `_id`, keeps `id` if it exists
   * For SQL: Removes `id` to let database auto-increment
   *
   * @param recordData - The record data
   * @returns Record data with new ID assigned
   * @private
   */
  private assignNewId;
  /**
   * Resolve the trash table/collection name.
   *
   * Priority:
   * 1. Model.trashTable (if set)
   * 2. Data source defaultTrashTable (e.g., "RecycleBin" for MongoDB)
   * 3. Default pattern: `{table}Trash`
   *
   * @returns The trash table/collection name
   * @private
   */
  private resolveTrashTable;
}
//#endregion
export { DatabaseRestorer };
//# sourceMappingURL=database-restorer.d.mts.map