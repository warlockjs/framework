import { MigrationDefaults } from "../../types.mjs";
import { TableIndexInformation } from "../../contracts/driver-blueprint.contract.mjs";
import { ColumnDefinition, ForeignKeyDefinition, FullTextIndexOptions, GeoIndexOptions, IndexDefinition, MigrationDriverContract, VectorIndexOptions } from "../../contracts/migration-driver.contract.mjs";
import { MongoDbDriver } from "./mongodb-driver.mjs";

//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-migration-driver.d.ts
/**
 * MongoDB-specific migration driver implementation.
 *
 * Key behaviors:
 * - Column operations are **no-ops** (MongoDB is schema-less)
 * - Index operations use native `createIndex()`
 * - Foreign keys are **no-ops** (MongoDB has no FK constraints)
 * - TTL indexes supported natively
 * - Vector indexes use Atlas Search (when available)
 * - Schema validation uses `collMod` command
 *
 * @example
 * ```typescript
 * const migrationDriver = new MongoMigrationDriver(mongoDriver);
 * await migrationDriver.createIndex("users", {
 *   columns: ["email"],
 *   unique: true,
 * });
 * ```
 */
declare class MongoMigrationDriver implements MigrationDriverContract {
  readonly driver: MongoDbDriver;
  /** Active transaction session (if any) */
  private session?;
  /**
   * Create a new MongoDB migration driver.
   *
   * @param driver - The MongoDB driver instance
   */
  constructor(driver: MongoDbDriver);
  /**
   * Get the MongoDB database instance.
   */
  private get db();
  /**
   * Get session options for operations.
   */
  private get sessionOptions();
  /**
   * Create a new collection.
   *
   * MongoDB creates collections lazily on first insert, but this method
   * creates them explicitly for migrations that need to add indexes or
   * schema validation.
   */
  createTable(table: string): Promise<void>;
  /**
   * Create table if not exists
   */
  createTableIfNotExists(table: string): Promise<void>;
  /**
   * Drop an existing collection.
   *
   * @throws Error if collection doesn't exist
   */
  dropTable(table: string): Promise<void>;
  /**
   * Drop collection if it exists (no error if missing).
   */
  dropTableIfExists(table: string): Promise<void>;
  /**
   * Rename a collection.
   */
  renameTable(from: string, to: string): Promise<void>;
  /**
   * Truncate a collection — remove all documents.
   *
   * @param table - Collection name
   */
  truncateTable(table: string): Promise<void>;
  /**
   * Check if a collection exists.
   */
  tableExists(table: string): Promise<boolean>;
  /**
   * List all columns in a collection.
   *
   * MongoDB is schema-less, so this returns an empty array.
   * For actual schema inspection, would need to sample documents.
   */
  listColumns(_table: string): Promise<ColumnDefinition[]>;
  /**
   * List all collections in the current database.
   */
  listTables(): Promise<string[]>;
  /**
   * Ensure the migrations tracking collection exists.
   *
   * MongoDB creates collections lazily, but we can create explicitly
   * and add a unique index on the name field.
   *
   * @param tableName - Name of the migrations collection
   */
  ensureMigrationsTable(tableName: string): Promise<void>;
  /**
   * Add a column (no-op for MongoDB).
   *
   * MongoDB is schema-less, so columns don't need to be declared.
   */
  addColumn(_table: string, _column: ColumnDefinition): Promise<void>;
  /**
   * Drop a column by running $unset on all documents.
   *
   * This actually removes the field from all documents in the collection.
   */
  dropColumn(table: string, column: string): Promise<void>;
  /**
   * Drop multiple columns by running $unset on all documents.
   */
  dropColumns(table: string, columns: string[]): Promise<void>;
  /**
   * Rename a column by running $rename on all documents.
   */
  renameColumn(table: string, from: string, to: string): Promise<void>;
  /**
   * Modify a column definition (no-op for MongoDB).
   *
   * MongoDB is schema-less, so column types don't need to be modified.
   */
  modifyColumn(_table: string, _column: ColumnDefinition): Promise<void>;
  /**
   * Create standard timestamp columns (created_at, updated_at).
   *
   * MongoDB implementation is a no-op since timestamps are handled
   * at the application level via Model hooks.
   *
   * @param _table - Collection name (unused)
   */
  createTimestampColumns(_table: string): Promise<void>;
  /**
   * Create an index on one or more columns.
   *
   * **Note**: Expression-based indexes, INCLUDE clause, and concurrent creation
   * are PostgreSQL-specific features and are silently ignored by MongoDB.
   */
  createIndex(table: string, index: IndexDefinition): Promise<void>;
  /**
   * Drop an index by name or columns.
   *
   * @param indexNameOrColumns - Index name (string) or columns array
   */
  dropIndex(table: string, indexNameOrColumns: string | string[]): Promise<void>;
  /**
   * Create a unique index/constraint.
   */
  createUniqueIndex(table: string, columns: string[], name?: string): Promise<void>;
  /**
   * Drop a unique index by finding its name from columns.
   */
  dropUniqueIndex(table: string, columns: string[]): Promise<void>;
  /**
   * Create a full-text search index.
   *
   * MongoDB uses "text" index type for full-text search.
   */
  createFullTextIndex(table: string, columns: string[], options?: FullTextIndexOptions): Promise<void>;
  /**
   * Drop a full-text search index.
   */
  dropFullTextIndex(table: string, name: string): Promise<void>;
  /**
   * Create a geo-spatial index.
   */
  createGeoIndex(table: string, column: string, options?: GeoIndexOptions): Promise<void>;
  /**
   * Drop a geo-spatial index.
   */
  dropGeoIndex(table: string, column: string): Promise<void>;
  /**
   * Create a vector search index for AI embeddings.
   *
   * Note: This requires MongoDB Atlas with Vector Search enabled.
   * For self-hosted MongoDB, this will create a regular index on the field.
   */
  createVectorIndex(table: string, column: string, options: VectorIndexOptions): Promise<void>;
  /**
   * Drop a vector search index.
   */
  dropVectorIndex(table: string, column: string): Promise<void>;
  /**
   * Create a TTL (time-to-live) index for automatic document expiration.
   */
  createTTLIndex(table: string, column: string, expireAfterSeconds: number): Promise<void>;
  /**
   * Drop a TTL index.
   */
  dropTTLIndex(table: string, column: string): Promise<void>;
  /**
   * List all indexes on a collection.
   *
   * @param table - Collection name
   * @returns Array of index metadata
   */
  listIndexes(table: string): Promise<TableIndexInformation[]>;
  /**
   * Add a foreign key constraint (no-op for MongoDB).
   *
   * MongoDB doesn't support foreign key constraints.
   * Use application-level validation or DBRefs instead.
   */
  addForeignKey(_table: string, _foreignKey: ForeignKeyDefinition): Promise<void>;
  /**
   * Drop a foreign key constraint (no-op for MongoDB).
   */
  dropForeignKey(_table: string, _name: string): Promise<void>;
  /**
   * Add a primary key constraint (no-op for MongoDB).
   *
   * MongoDB always has _id as the primary key.
   */
  addPrimaryKey(_table: string, _columns: string[]): Promise<void>;
  /**
   * Drop the primary key constraint (no-op for MongoDB).
   */
  dropPrimaryKey(_table: string): Promise<void>;
  /**
   * Add a CHECK constraint (no-op for MongoDB).
   *
   * MongoDB doesn't support CHECK constraints.
   * Use schema validation instead.
   */
  addCheck(_table: string, _name: string, _expression: string): Promise<void>;
  /**
   * Drop a CHECK constraint (no-op for MongoDB).
   */
  dropCheck(_table: string, _name: string): Promise<void>;
  /**
   * Set JSON schema validation rules on a collection.
   *
   * Uses MongoDB's validator feature to enforce document structure.
   *
   * @example
   * ```typescript
   * await driver.setSchemaValidation("users", {
   *   bsonType: "object",
   *   required: ["name", "email"],
   *   properties: {
   *     name: { bsonType: "string" },
   *     email: { bsonType: "string" },
   *   },
   * });
   * ```
   */
  setSchemaValidation(table: string, schema: object): Promise<void>;
  /**
   * Remove schema validation rules from a collection.
   */
  removeSchemaValidation(table: string): Promise<void>;
  /**
   * Begin a database transaction.
   *
   * Uses the driver's transaction mechanism.
   */
  beginTransaction(): Promise<void>;
  /**
   * Commit the current transaction.
   */
  commit(): Promise<void>;
  /**
   * Rollback the current transaction.
   */
  rollback(): Promise<void>;
  /**
   * MongoDB supports transactions (requires replica set).
   */
  supportsTransactions(): boolean;
  /**
   * Get the default transactional behavior for MongoDB.
   *
   * MongoDB DDL operations (createCollection, createIndex, etc.) cannot
   * be wrapped in transactions, even with replica sets. Transactions only
   * work for document CRUD operations.
   *
   * @returns false (MongoDB DDL is not transactional)
   */
  getDefaultTransactional(): boolean;
  /**
   * Get the default UUID generation expression for MongoDB.
   *
   * MongoDB does not use SQL-level UUID defaults — UUID generation
   * is handled at the application level. Always returns `undefined`.
   *
   * @param _migrationDefaults - Ignored (MongoDB handles UUIDs at app level)
   * @returns undefined
   */
  getUuidDefault(_migrationDefaults?: MigrationDefaults): undefined;
  /**
   * Check if a database extension is available (no-op for MongoDB).
   *
   * @param _extension - Extension name
   */
  isExtensionAvailable(_extension: string): Promise<boolean>;
  /**
   * Get the official documentation or installation URL for a database extension.
   *
   * @param _extension - Extension name
   */
  getExtensionDocsUrl(_extension: string): string | undefined;
  /**
   * Execute raw operations with direct database access.
   *
   * @param callback - Callback receiving the MongoDB Db instance
   * @returns Result from callback
   *
   * @example
   * ```typescript
   * await driver.raw(async (db) => {
   *   await db.collection("users").updateMany({}, { $set: { active: true } });
   * });
   * ```
   */
  raw<T>(callback: (connection: unknown) => Promise<T>): Promise<T>;
}
//#endregion
export { MongoMigrationDriver };
//# sourceMappingURL=mongodb-migration-driver.d.mts.map