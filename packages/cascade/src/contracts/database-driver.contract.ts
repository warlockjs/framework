import type { ModelDefaults } from "../types";
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

  /**
   * Driver-specific model defaults.
   *
   * These defaults are applied to all models using this driver,
   * unless overridden by database config or model static properties.
   *
   * Examples:
   * - MongoDB: camelCase naming (createdAt, updatedAt)
   * - PostgreSQL: snake_case naming (created_at, updated_at)
   *
   * @example
   * ```typescript
   * // PostgreSQL driver
   * readonly modelDefaults: Partial<ModelDefaults> = {
   *   namingConvention: "snake_case",
   *   createdAtColumn: "created_at",
   *   updatedAtColumn: "updated_at",
   *   timestamps: true,
   * };
   * ```
   */
  readonly modelDefaults?: Partial<ModelDefaults>;

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

  /** Find one and update a single document that matches the provided filter and return the updated document */
  findOneAndUpdate<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T | null>;

  /**
   * Upsert (insert or update) a single document/row.
   *
   * If a document matching the filter exists, it will be updated.
   * If no document matches, a new one will be inserted.
   *
   * @param table - Target table/collection name
   * @param filter - Filter conditions to find existing document
   * @param document - Document data to insert or update
   * @param options - Driver-specific options (conflict columns for SQL, etc.)
   * @returns The upserted document
   *
   * @example
   * ```typescript
   * // PostgreSQL: upsert on unique email
   * await driver.upsert('users', { email: 'user@example.com' }, {
   *   email: 'user@example.com',
   *   name: 'John Doe',
   *   updatedAt: new Date()
   * }, { conflictColumns: ['email'] });
   *
   * // MongoDB: upsert by filter
   * await driver.upsert('users', { email: 'user@example.com' }, {
   *   email: 'user@example.com',
   *   name: 'John Doe'
   * });
   * ```
   */
  upsert<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    document: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T>;

  /**
   * Find one and delete a single document that matches the provided filter and return the deleted document.
   *
   * @param table - Target table/collection name
   * @param filter - Filter conditions
   * @param options - Optional delete options
   * @returns The deleted document or null if not found
   *
   * @example
   * ```typescript
   * const deleted = await driver.findOneAndDelete('users', { id: 1 });
   * if (deleted) {
   *   console.log('Deleted user:', deleted);
   * }
   * ```
   */
  findOneAndDelete<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
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

  // ============================================================
  // Database Lifecycle Operations
  // ============================================================

  /**
   * Create a new database.
   *
   * Used for multi-tenant scenarios where each tenant gets their own database.
   *
   * @param name - Database name to create
   * @param options - Driver-specific options (encoding, template, etc.)
   * @returns true if created, false if already exists
   *
   * @example
   * ```typescript
   * // Create a tenant database
   * const created = await driver.createDatabase("tenant_xyz");
   * if (created) {
   *   console.log("Database created successfully");
   * }
   * ```
   */
  createDatabase(name: string, options?: CreateDatabaseOptions): Promise<boolean>;

  /**
   * Drop a database.
   *
   * Use with caution - this permanently deletes the database and all its data.
   *
   * @param name - Database name to drop
   * @param options - Driver-specific options (force, etc.)
   * @returns true if dropped, false if didn't exist
   *
   * @example
   * ```typescript
   * // Remove a tenant database
   * await driver.dropDatabase("tenant_xyz");
   * ```
   */
  dropDatabase(name: string, options?: DropDatabaseOptions): Promise<boolean>;

  /**
   * Check if a database exists.
   *
   * @param name - Database name to check
   * @returns true if database exists
   *
   * @example
   * ```typescript
   * const exists = await driver.databaseExists("tenant_xyz");
   * if (!exists) {
   *   await driver.createDatabase("tenant_xyz");
   * }
   * ```
   */
  databaseExists(name: string): Promise<boolean>;

  /**
   * List all databases.
   *
   * @returns Array of database names
   */
  listDatabases(): Promise<string[]>;

  // ============================================================
  // Table Management Operations
  // ============================================================

  /**
   * Drop a table/collection.
   *
   * Throws an error if the table doesn't exist.
   *
   * @param name - Table/collection name to drop
   *
   * @example
   * ```typescript
   * await driver.dropTable("temp_data");
   * ```
   */
  dropTable(name: string): Promise<void>;

  /**
   * Drop a table/collection if it exists.
   *
   * Does not throw an error if the table doesn't exist.
   *
   * @param name - Table/collection name to drop
   *
   * @example
   * ```typescript
   * await driver.dropTableIfExists("temp_data");
   * ```
   */
  dropTableIfExists(name: string): Promise<void>;

  /**
   * Drop all tables/collections in the current database.
   *
   * Use with extreme caution - this permanently deletes all tables and data.
   * Typically used for `migrate:fresh` command or test suite resets.
   *
   * @example
   * ```typescript
   * // Reset entire database schema
   * await driver.dropAllTables();
   * await runMigrations();
   * ```
   */
  dropAllTables(): Promise<void>;
}

/**
 * Options for creating a database.
 */
export type CreateDatabaseOptions = {
  /** Database encoding (PostgreSQL: UTF8, LATIN1, etc.) */
  encoding?: string;
  /** Template database (PostgreSQL) */
  template?: string;
  /** Locale/collation settings */
  locale?: string;
  /** Owner of the new database */
  owner?: string;
};

/**
 * Options for dropping a database.
 */
export type DropDatabaseOptions = {
  /** Force drop even if there are active connections */
  force?: boolean;
  /** Skip error if database doesn't exist */
  ifExists?: boolean;
};
