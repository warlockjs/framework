import { Model } from "../model/model.mjs";
import { WriterContract, WriterOptions, WriterResult } from "../contracts/database-writer.contract.mjs";

//#region ../../@warlock.js/cascade/src/writer/database-writer.d.ts
/**
 * Database writer service that orchestrates model persistence.
 *
 * Handles the complete save pipeline:
 * 1. Check for changes (skip if no changes and not new)
 * 2. Emit `saving` event (for data enrichment)
 * 3. Emit `validating` event
 * 4. Validate and cast data via @warlock.js/seal schema
 * 5. Emit `validated` event
 * 6. Generate ID (for new NoSQL records)
 * 7. Emit `creating`/`updating` events
 * 8. Execute insert or update via driver
 * 9. Merge returned data into model
 * 10. Reset dirty tracker and update `isNew` flag
 * 11. Emit `saved` and `created`/`updated` events
 *
 * @example
 * ```typescript
 * const user = new User({ name: "Alice", email: "alice@example.com" });
 * const writer = new DatabaseWriter(user);
 * await writer.save();
 *
 * console.log(user.get("id")); // 1 (auto-generated)
 * console.log(user.get("_id")); // ObjectId("...")
 *
 * // Update existing record
 * user.set("name", "Alice Smith");
 * await writer.save();
 * // Only updates the "name" field (partial update)
 *
 * // Silent save (no events)
 * await writer.save({ skipEvents: true });
 * ```
 */
declare class DatabaseWriter implements WriterContract {
  /** The model instance being persisted */
  private readonly model;
  /** Model constructor reference */
  private readonly ctor;
  /** Data source containing driver and ID generator */
  private readonly dataSource;
  /** Database driver for executing queries */
  private readonly driver;
  /** Table/collection name */
  private readonly table;
  /** Primary key field name */
  private readonly primaryKey;
  /** Validation schema (if defined) */
  private readonly schema?;
  /** Strict mode configuration */
  private readonly strictMode;
  /**
   * Create a new writer instance for a model.
   *
   * @param model - The model instance to persist
   *
   * @example
   * ```typescript
   * const user = new User({ name: "Alice" });
   * const writer = new DatabaseWriter(user);
   * await writer.save();
   * ```
   */
  constructor(model: Model);
  /**
   * Save the model instance to the database.
   *
   * @param options - Save options
   * @returns Result with success status, document, and metadata
   * @throws {ValidationError} If validation fails
   */
  save(options?: WriterOptions): Promise<WriterResult>;
  /**
   * Validate and cast model data using the schema.
   *
   * Updates the model's data in-place with validated/casted values.
   *
   * @param isInsert - Whether this is an insert operation
   * @param options - Save options
   * @throws {ValidationError} If validation fails
   * @private
   */
  private validateAndCast;
  /**
   * Perform an insert operation.
   *
   * @param options - Save options
   * @returns Insert result
   * @private
   */
  private performInsert;
  /**
   * Perform an update operation.
   *
   * @param options - Save options
   * @returns Update result
   * @private
   */
  private performUpdate;
  /**
   * Generate ID for the model if auto-generation is enabled.
   *
   * @private
   */
  generateNextId(): Promise<void>;
  /**
   * Build update operations from the model's dirty tracker.
   *
   * Handles both modified fields ($set) and removed fields ($unset).
   *
   * @returns Update operations for the driver
   * @private
   *
   * @example
   * ```typescript
   * // Model with changes
   * user.set("name", "Alice");
   * user.unset("tempField");
   *
   * const operations = this.buildUpdateOperations();
   * // {
   * //   $set: { name: "Alice" },
   * //   $unset: { tempField: 1 }
   * // }
   * ```
   */
  private buildUpdateOperations;
  /**
   * Resolve the initial ID from model configuration.
   *
   * Priority:
   * 1. Model.initialId (explicit value)
   * 2. Model.randomInitialId (random or function)
   * 3. Default: 1
   *
   * @returns The initial ID value
   * @private
   */
  private resolveInitialId;
  /**
   * Resolve the increment value from model configuration.
   *
   * Priority:
   * 1. Model.incrementIdBy (explicit value)
   * 2. Model.randomIncrement (random or function)
   * 3. Default: 1
   *
   * @returns The increment value
   * @private
   */
  private resolveIncrementBy;
  /**
   * Generate a random integer between min and max (inclusive).
   *
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns Random integer
   * @private
   */
  private randomInt;
  /**
   * Trigger sync operations after successful save.
   *
   * Emits a model.updated event that ModelSyncOperation listens to.
   * The sync is handled by registered sync operations, not directly here.
   *
   * @param changedFields - Fields that were changed (for filtering)
   * @private
   */
  private triggerSync;
}
//#endregion
export { DatabaseWriter };
//# sourceMappingURL=database-writer.d.mts.map