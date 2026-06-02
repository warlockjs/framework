import type { RemoverContract, RemoverOptions, RemoverResult } from "../contracts/database-remover.contract";
import type { Model } from "../model/model";
/**
 * Database remover service that orchestrates model deletion.
 *
 * Handles the complete deletion pipeline:
 * 1. Strategy resolution (options → model static → data source default)
 * 2. Validation (check if model is new, has primary key)
 * 3. Event emission (deleting, deleted)
 * 4. Driver execution (based on strategy: trash, permanent, or soft)
 * 5. Post-deletion cleanup (mark as new, reset state)
 *
 * @example
 * ```typescript
 * const user = await User.find(1);
 * const remover = new DatabaseRemover(user);
 * const result = await remover.destroy();
 *
 * console.log(result.success); // true
 * console.log(result.strategy); // "trash" | "permanent" | "soft"
 * ```
 */
export declare class DatabaseRemover implements RemoverContract {
    /** The model instance being deleted */
    private readonly model;
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
     * Create a new remover instance for a model.
     *
     * @param model - The model instance to delete
     *
     * @example
     * ```typescript
     * const user = await User.find(1);
     * const remover = new DatabaseRemover(user);
     * await remover.destroy();
     * ```
     */
    constructor(model: Model);
    /**
     * Destroy (delete) the model instance from the database.
     *
     * @param options - Remover options
     * @returns Result containing success status, strategy used, and metadata
     * @throws {Error} If model is new (not saved) or if deletion fails
     */
    destroy(options?: RemoverOptions): Promise<RemoverResult>;
    /**
     * Prepare the trash record by preserving all original fields and adding deletion metadata.
     *
     * Keeps all original fields intact for easy restoration and adds:
     * - `deletedAt`: Timestamp when the record was deleted
     * - `originalTable`: The table/collection the record came from (for filtering in restoreAll)
     *
     * **ID Handling:**
     * - MongoDB with `_id`: Keeps `_id` as-is (unique across database)
     * - MongoDB with auto-increment `id`: Keeps `id` as a regular field (not primary key)
     * - SQL: Keeps original `id` as a regular field (trash table uses its own auto-increment primary key)
     *
     * The trash table should use its own primary key structure:
     * - MongoDB: Uses `_id` (ObjectId) as primary key, original `id` is just a field
     * - SQL: Uses auto-increment `trashId` as primary key, original `id` is just a field
     *
     * @param documentData - The original document data
     * @returns Prepared trash record data with all original fields + deletedAt + originalTable
     * @private
     */
    private prepareTrashRecord;
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
    /**
     * Trigger sync operations after successful deletion.
     *
     * Emits a model.deleted event that ModelSyncOperation listens to.
     * The sync is handled by registered sync operations, not directly here.
     *
     * @private
     */
    private triggerSync;
}
//# sourceMappingURL=database-remover.d.ts.map