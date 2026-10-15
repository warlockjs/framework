/**
 * Options for generating the next ID.
 */
export type GenerateIdOptions = {
  /** The table/collection name */
  table: string;
  /** Initial ID value for the first record (default: 1) */
  initialId?: number;
  /** Amount to increment by for each new record (default: 1) */
  incrementIdBy?: number;
};

/**
 * ID generator contract for auto-incrementing IDs in NoSQL databases.
 *
 * This service generates sequential integer IDs for NoSQL databases (like MongoDB)
 * that don't have native auto-increment support. It maintains a separate collection
 * that tracks the last generated ID for each table.
 *
 * **Note:** SQL databases (PostgreSQL, MySQL) use native AUTO_INCREMENT/SERIAL
 * and don't need this service.
 *
 * @example
 * ```typescript
 * // For MongoDB
 * const mongoDriver = new MongoDbDriver({ ...config, autoGenerateId: true });
 * const idGenerator = mongoDriver.getIdGenerator();
 *
 * // Generate next ID
 * const id = await idGenerator.generateNextId({
 *   table: "users",
 *   initialId: 1000,
 *   incrementIdBy: 1
 * });
 * console.log(id); // 1000 (first time), 1001 (second time), etc.
 *
 * // Get last ID for a table
 * const lastId = await idGenerator.getLastId("users"); // Returns 1001
 *
 * // Manually set last ID (useful for migrations)
 * await idGenerator.setLastId("users", 5000);
 * ```
 */
export interface IdGeneratorContract {
  /**
   * Generate the next ID for a table.
   *
   * This method:
   * 1. Atomically increments the counter in the tracking collection
   * 2. Returns the new ID
   * 3. Creates the counter document if it doesn't exist (using initialId)
   *
   * The operation is atomic to ensure uniqueness even in concurrent scenarios.
   *
   * @param options - Configuration for ID generation
   * @returns The generated ID
   *
   * @example
   * ```typescript
   * const id = await idGenerator.generateNextId({
   *   table: "users",
   *   initialId: 1000,
   *   incrementIdBy: 5
   * });
   * console.log(id); // 1000, 1005, 1010, etc.
   * ```
   */
  generateNextId(options: GenerateIdOptions): Promise<number>;

  /**
   * Reserve a contiguous block of `count` ids in a SINGLE atomic operation.
   *
   * This is the batch counterpart of {@link generateNextId}, intended for
   * multi-row inserts (`createMany`): instead of N separate counter round-trips
   * (one per row), the counter is advanced by `count * incrementIdBy` in one
   * atomic step and the whole block is handed back at once.
   *
   * Semantics:
   * - Returns the `count` reserved ids in ascending order. The FIRST id of the
   *   first-ever block for a table equals `initialId` (same anchor as
   *   {@link generateNextId}); subsequent blocks continue from the stored
   *   counter, so blocks never overlap — even across concurrent callers.
   * - Goal of "update the stored last id" is satisfied by the same atomic op:
   *   advancing the counter by `count * incrementIdBy` leaves the persisted
   *   counter equal to the block's LAST id, so {@link getLastId} stays
   *   consistent with no extra write. Do NOT pair this with {@link setLastId}.
   * - **Not transactional.** Like {@link generateNextId} (and SQL `SERIAL`),
   *   the counter write is standalone and durable immediately; if a surrounding
   *   transaction rolls back, the reserved block is consumed and left as a gap.
   *
   * Optional: drivers without a counter (SQL with native `AUTO_INCREMENT` /
   * `SERIAL`) do not implement this — callers must feature-detect it and fall
   * back to per-row {@link generateNextId}.
   *
   * @param options - `GenerateIdOptions` plus the block `count` (`>= 1`)
   * @returns The reserved ids in ascending order (length `count`)
   *
   * @example
   * ```typescript
   * // Reserve 100 ids in one atomic op for a bulk insert
   * const ids = await idGenerator.generateNextIds({ table: "users", count: 100 });
   * // ids[0] is the first, ids[99] the last; getLastId("users") === ids[99]
   * ```
   */
  generateNextIds?(options: GenerateIdOptions & { count: number }): Promise<number[]>;

  /**
   * Get the last generated ID for a table.
   *
   * Returns 0 if no IDs have been generated yet for this table.
   *
   * @param table - The table/collection name
   * @returns The last generated ID, or 0 if none exists
   *
   * @example
   * ```typescript
   * const lastId = await idGenerator.getLastId("users");
   * console.log(lastId); // 42
   * ```
   */
  getLastId(table: string): Promise<number>;

  /**
   * Set the last ID for a table.
   *
   * Useful for:
   * - Migrations: Setting a starting point for IDs
   * - Manual ID management: Adjusting counters after bulk operations
   * - Testing: Resetting ID sequences
   *
   * @param table - The table/collection name
   * @param id - The ID to set as the last generated ID
   *
   * @example
   * ```typescript
   * // Start IDs from 1000
   * await idGenerator.setLastId("users", 1000);
   *
   * // Next generated ID will be 1001
   * const nextId = await idGenerator.generateNextId({
   *   table: "users",
   *   incrementIdBy: 1
   * });
   * console.log(nextId); // 1001
   * ```
   */
  setLastId(table: string, id: number): Promise<void>;
}
