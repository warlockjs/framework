import { DriverBlueprintContract } from "./driver-blueprint.contract";
import type { MigrationDriverContract } from "./migration-driver.contract";
import type { QueryBuilderContract } from "./query-builder.contract";
import type { SyncAdapterContract } from "./sync-adapter.contract";

/** Supported driver lifecycle events. */
export type DriverEvent = "connected" | "disconnected" | string;

/** Listener signature for driver lifecycle events. */
export type DriverEventListener = (...args: unknown[]) => void;

/** Representation of an opened transaction. */
export interface DriverTransactionContract<TContext = unknown> {
  /** Driver-specific transaction context (session, connection, ...). */
  context: TContext;
  /** Commit the transaction. */
  commit(): Promise<void>;
  /** Rollback the transaction. */
  rollback(): Promise<void>;
}

/** Result returned after insert operations. */
export type InsertResult<TDocument = unknown> = {
  document: TDocument;
};

/** Result returned after update operations. */
export type UpdateResult = {
  modifiedCount: number;
};

/**
 * Database-agnostic update operations.
 *
 * Drivers translate these to their native syntax:
 * - MongoDB: Used as-is (e.g., `{ $set: { age: 31 } }`)
 * - SQL: Translated to SET/NULL statements (e.g., `SET age = 31`)
 *
 * @example
 * ```typescript
 * // Set fields
 * { $set: { age: 31, name: "Alice" } }
 *
 * // Remove fields (MongoDB: delete, SQL: SET NULL)
 * { $unset: { tempField: 1 } }
 *
 * // Increment numeric fields
 * { $inc: { views: 1, likes: 5 } }
 *
 * // Combined operations
 * {
 *   $set: { status: "active" },
 *   $unset: { tempData: 1 },
 *   $inc: { loginCount: 1 }
 * }
 * ```
 */
export type UpdateOperations = {
  /** Set field values */
  $set?: Record<string, unknown>;
  /** Remove/unset fields (MongoDB: delete field, SQL: SET NULL) */
  $unset?: Record<string, 1 | true>;
  /** Increment numeric fields */
  $inc?: Record<string, number>;
  /** Decrement numeric fields */
  $dec?: Record<string, number>;
  /** Push to arrays (NoSQL only, SQL drivers may ignore) */
  $push?: Record<string, unknown>;
  /** Pull from arrays (NoSQL only, SQL drivers may ignore) */
  $pull?: Record<string, unknown>;
};

/**
 * Unified driver contract used by the model layer.
 */
export interface DriverContract {
  /**
   * The name of the driver.
   *
   * Used for identification, logging, and debugging.
   *
   * @example "mongodb", "postgres", "mysql"
   */
  readonly name: string;

  /**
   * Database blueprint (Information Schema)
   */
  readonly blueprint: DriverBlueprintContract;

  /** Whether the underlying connection is currently established. */
  readonly isConnected: boolean;

  /** Establish the underlying database connection/pool. */
  connect(): Promise<void>;
  /** Close the underlying database connection/pool. */
  disconnect(): Promise<void>;

  /**
   * Serialize the given data
   */
  serialize(data: Record<string, unknown>): Record<string, unknown>;

  /**
   * Deserialize the given data
   */
  deserialize(data: Record<string, unknown>): Record<string, unknown>;

  /** Register event listeners (connected/disconnected/custom). */
  on(event: DriverEvent, listener: DriverEventListener): void;

  /** Insert a single document/row into the given table. */
  insert(
    table: string,
    document: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<InsertResult>;

  /** Insert multiple documents/rows into the given table. */
  insertMany(
    table: string,
    documents: Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): Promise<InsertResult[]>;

  /** Update documents/rows matching the filter. */
  update(
    table: string,
    filter: Record<string, unknown>,
    update: UpdateOperations,
    options?: Record<string, unknown>,
  ): Promise<UpdateResult>;

  /** Update many documents/rows matching the filter. */
  updateMany(
    table: string,
    filter: Record<string, unknown>,
    update: UpdateOperations,
    options?: Record<string, unknown>,
  ): Promise<UpdateResult>;

  /** Replace a single document that matches the provided filter. */
  replace<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    document: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T | null>;

  /** Delete a single document that matches the provided filter. */
  delete(
    table: string,
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<number>;

  /** Delete documents/rows matching the filter. */
  deleteMany(
    table: string,
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<number>;

  /**
   * Remove all records from a table/collection.
   *
   * This is a destructive operation that deletes all documents/rows.
   * Use with caution, especially in production environments.
   *
   * @param table - Table/collection name to truncate
   * @param options - Driver-specific options
   * @returns Number of records deleted
   *
   * @example
   * ```typescript
   * // Clear all users
   * await driver.truncateTable("users");
   *
   * // Use in seeders for test data cleanup
   * await driver.truncateTable("test_data");
   * ```
   */
  truncateTable(table: string, options?: Record<string, unknown>): Promise<number>;

  /** Obtain a query builder for custom querying. */
  queryBuilder<T = unknown>(table: string): QueryBuilderContract<T>;

  /** Start a new transaction scope. */
  beginTransaction(): Promise<DriverTransactionContract>;

  /** Perform atomic updates matching the filter. */
  atomic(
    table: string,
    filter: Record<string, unknown>,
    operations: UpdateOperations,
    options?: Record<string, unknown>,
  ): Promise<UpdateResult>;

  /** Access the sync adapter used for bulk denormalized updates. */
  syncAdapter(): SyncAdapterContract;

  /** Access the migration driver for schema operations. */
  migrationDriver(): MigrationDriverContract;
}
