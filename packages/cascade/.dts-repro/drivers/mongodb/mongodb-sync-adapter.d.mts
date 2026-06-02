import { SyncAdapterContract, SyncInstruction } from "../../contracts/sync-adapter.contract.mjs";
import { MongoDbDriver } from "./mongodb-driver.mjs";

//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-sync-adapter.d.ts
/**
 * MongoDB implementation of the sync adapter.
 * Handles array updates using positional operators and arrayFilters.
 * Automatically participates in active transactions via the driver's session context.
 */
declare class MongoSyncAdapter implements SyncAdapterContract {
  private readonly driver;
  /**
   * Creates a new MongoDB sync adapter.
   *
   * @param driver - The MongoDB driver instance (provides session-aware operations)
   */
  constructor(driver: MongoDbDriver);
  /**
   * Executes a batch of sync instructions.
   *
   * @param instructions - Array of sync instructions
   * @returns Total number of documents affected
   */
  executeBatch(instructions: SyncInstruction[]): Promise<number>;
  /**
   * Executes a single sync instruction.
   * Uses the driver's updateMany to automatically participate in active transactions.
   *
   * @param instruction - The sync instruction
   * @returns Number of documents affected
   */
  executeOne(instruction: SyncInstruction): Promise<number>;
  /**
   * Executes an array update using MongoDB positional operators.
   * Uses the driver's updateMany to automatically participate in active transactions.
   *
   * @param instruction - The sync instruction with array info
   * @returns Number of documents affected
   */
  executeArrayUpdate(instruction: SyncInstruction): Promise<number>;
  /**
   * Checks if positional operator $ can be used.
   * Requires filter to already match the array element.
   *
   * @param instruction - The sync instruction
   * @returns True if positional operator can be used
   */
  private canUsePositionalOperator;
  /**
   * Executes array update using arrayFilters.
   * Uses the driver's updateMany with arrayFilters option to participate in transactions.
   *
   * @param instruction - The sync instruction
   * @returns Number of documents affected
   */
  private executeWithArrayFilters;
  /**
   * Builds an optimized filter to reduce the number of documents scanned.
   * Adds array existence check when filter doesn't already match array elements.
   *
   * @param originalFilter - The original filter from the instruction
   * @param arrayField - The array field path
   * @param identifierField - The identifier field within array elements
   * @returns Optimized filter
   */
  private buildOptimizedFilter;
  /**
   * Transforms update operation to use arrayFilters placeholder.
   *
   * @param update - Original update operation
   * @param arrayField - Array field path
   * @returns Transformed update operation
   */
  private transformUpdateForArrayFilters;
}
//#endregion
export { MongoSyncAdapter };
//# sourceMappingURL=mongodb-sync-adapter.d.mts.map