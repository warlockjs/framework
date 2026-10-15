/**
 * PostgreSQL Sync Adapter
 *
 * Implements the SyncAdapterContract for batch update operations
 * on embedded/denormalized data in PostgreSQL.
 *
 * @module cascade/drivers/postgres
 */
import type { SyncAdapterContract, SyncInstruction } from "../../contracts/sync-adapter.contract";
import type { PostgresDriver } from "./postgres-driver";
/**
 * PostgreSQL Sync Adapter.
 *
 * Handles batch updates for embedded/denormalized data stored
 * in JSONB columns. In a normalized SQL world, this is less common
 * than in MongoDB, but still useful for JSONB documents.
 *
 * @example
 * ```typescript
 * const syncAdapter = driver.syncAdapter();
 *
 * // Update embedded user data in posts
 * await syncAdapter.executeBatch([
 *   {
 *     targetTable: 'posts',
 *     filter: { 'author.id': 123 },
 *     update: { 'author.name': 'New Name' },
 *     // ... other fields
 *   }
 * ]);
 * ```
 */
export declare class PostgresSyncAdapter implements SyncAdapterContract {
    private readonly driver;
    /**
     * Create a new sync adapter.
     *
     * @param driver - The PostgreSQL driver instance
     */
    constructor(driver: PostgresDriver);
    /**
     * Execute a batch of sync instructions.
     *
     * @param instructions - Array of sync instructions
     * @returns Total number of affected rows
     */
    executeBatch(instructions: SyncInstruction[]): Promise<number>;
    /**
     * Execute a single sync instruction.
     *
     * @param instruction - Sync instruction
     * @returns Number of affected rows
     */
    executeOne(instruction: SyncInstruction): Promise<number>;
    /**
     * Execute an array update instruction with positional operators.
     *
     * @param instruction - Sync instruction with array update info
     * @returns Number of affected rows
     */
    executeArrayUpdate(instruction: SyncInstruction): Promise<number>;
    /**
     * Execute an update on JSONB fields.
     *
     * @param table - Table name
     * @param filter - Row filter
     * @param update - Fields to update
     * @returns Number of affected rows
     */
    private executeJsonbUpdate;
    /**
     * Execute an update on elements within a JSONB array.
     *
     * @param table - Table name
     * @param filter - Row filter
     * @param arrayField - JSONB array column
     * @param arrayFilter - Filter to match array elements
     * @param update - Fields to update on matched elements
     * @returns Number of affected rows
     */
    private executeArrayElementUpdate;
}
//# sourceMappingURL=postgres-sync-adapter.d.ts.map