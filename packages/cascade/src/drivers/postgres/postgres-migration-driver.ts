/**
 * PostgreSQL Migration Driver
 *
 * Implements the MigrationDriverContract for PostgreSQL DDL operations.
 * Provides methods for creating/dropping tables, columns, indexes,
 * and constraints.
 *
 * @module cascade/drivers/postgres
 */

import { databaseTransactionContext } from "../../context/database-transaction-context";
import type {
  ColumnDefinition,
  ForeignKeyDefinition,
  FullTextIndexOptions,
  GeoIndexOptions,
  IndexDefinition,
  MigrationDriverContract,
  VectorIndexOptions,
} from "../../contracts/migration-driver.contract";
import type { PostgresDriver } from "./postgres-driver";

/**
 * PostgreSQL Migration Driver.
 *
 * Handles database schema operations for PostgreSQL including:
 * - Table creation and deletion
 * - Column management
 * - Index creation (B-tree, GIN, GiST, etc.)
 * - Constraint management (foreign keys, unique, etc.)
 *
 * @example
 * ```typescript
 * const migrationDriver = driver.migrationDriver();
 *
 * // Create a table
 * await migrationDriver.createTable('users');
 *
 * // Add columns
 * await migrationDriver.addColumn('users', {
 *   name: 'email',
 *   type: 'string',
 *   length: 255,
 *   nullable: false
 * });
 *
 * // Create unique index
 * await migrationDriver.createUniqueIndex('users', ['email']);
 * ```
 */
export class PostgresMigrationDriver implements MigrationDriverContract {
  /**
   * Active transaction client (if any).
   */
  private get transactionClient(): unknown {
    return databaseTransactionContext.getSession();
  }

  /**
   * Create a new migration driver.
   *
   * @param driver - The PostgreSQL driver instance
   */
  public constructor(private readonly driver: PostgresDriver) {}

  // ============================================================================
  // TABLE OPERATIONS
  // ============================================================================

  /**
   * Create a new table with a default id column.
   *
   * @param table - Table name
   */
  public async createTable(table: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    // Create empty table - columns are added via addColumn operations
    await this.execute(`CREATE TABLE ${quotedTable} ()`);
  }

  /**
   * Create table if it doesn't exist.
   *
   * @param table - Table name
   */
  public async createTableIfNotExists(table: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    // Create empty table if not exists - columns are added via addColumn operations
    await this.execute(`CREATE TABLE IF NOT EXISTS ${quotedTable} ()`);
  }

  /**
   * Drop an existing table.
   *
   * @param table - Table name
   */
  public async dropTable(table: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    await this.execute(`DROP TABLE ${quotedTable}`);
  }

  /**
   * Drop table if it exists.
   *
   * @param table - Table name
   */
  public async dropTableIfExists(table: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    await this.execute(`DROP TABLE IF EXISTS ${quotedTable}`);
  }

  /**
   * Rename a table.
   *
   * @param from - Current table name
   * @param to - New table name
   */
  public async renameTable(from: string, to: string): Promise<void> {
    const quotedFrom = this.driver.dialect.quoteIdentifier(from);
    const quotedTo = this.driver.dialect.quoteIdentifier(to);
    await this.execute(`ALTER TABLE ${quotedFrom} RENAME TO ${quotedTo}`);
  }

  /**
   * Check if a table exists.
   *
   * @param table - Table name
   * @returns Whether the table exists
   */
  public async tableExists(table: string): Promise<boolean> {
    const result = await this.driver.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [table],
    );
    return result.rows[0]?.exists ?? false;
  }

  /**
   * Ensure the migrations tracking table exists.
   *
   * Creates the table with proper schema if it doesn't exist.
   *
   * @param tableName - Name of the migrations table
   */
  public async ensureMigrationsTable(tableName: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(tableName);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS ${quotedTable} (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL UNIQUE,
        "batch" INTEGER NOT NULL,
        "executedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMP WITH TIME ZONE
      )
    `);
  }

  // ============================================================================
  // COLUMN OPERATIONS
  // ============================================================================

  /**
   * Add a column to an existing table.
   *
   * @param table - Table name
   * @param column - Column definition
   */
  public async addColumn(table: string, column: ColumnDefinition): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(column.name);

    // For auto-increment integers, use SERIAL/BIGSERIAL instead of INTEGER/BIGINT
    let sqlType: string;
    if (column.autoIncrement) {
      if (column.type === "bigInteger") {
        sqlType = "BIGSERIAL";
      } else {
        sqlType = "SERIAL";
      }
    } else {
      sqlType = this.driver.dialect.getSqlType(column.type, {
        length: column.length,
        precision: column.precision,
        scale: column.scale,
      });
    }

    let sql = `ALTER TABLE ${quotedTable} ADD COLUMN ${quotedColumn} ${sqlType}`;

    // SERIAL/BIGSERIAL are always NOT NULL, so skip for those
    if (!column.autoIncrement && column.nullable === false) {
      sql += " NOT NULL";
    }

    if (column.defaultValue !== undefined) {
      if (typeof column.defaultValue === "string") {
        sql += ` DEFAULT '${column.defaultValue}'`;
      } else if (typeof column.defaultValue === "boolean") {
        sql += ` DEFAULT ${column.defaultValue ? "TRUE" : "FALSE"}`;
      } else {
        sql += ` DEFAULT ${column.defaultValue}`;
      }
    }

    // Handle primary key
    if (column.primary) {
      sql += " PRIMARY KEY";
    }

    // Handle unique constraint
    if (column.unique) {
      sql += " UNIQUE";
    }

    await this.execute(sql);
  }

  /**
   * Drop a column from a table.
   *
   * @param table - Table name
   * @param column - Column name
   */
  public async dropColumn(table: string, column: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(column);
    await this.execute(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedColumn}`);
  }

  /**
   * Drop multiple columns from a table.
   *
   * @param table - Table name
   * @param columns - Column names
   */
  public async dropColumns(table: string, columns: string[]): Promise<void> {
    for (const column of columns) {
      await this.dropColumn(table, column);
    }
  }

  /**
   * Rename a column.
   *
   * @param table - Table name
   * @param from - Current column name
   * @param to - New column name
   */
  public async renameColumn(table: string, from: string, to: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedFrom = this.driver.dialect.quoteIdentifier(from);
    const quotedTo = this.driver.dialect.quoteIdentifier(to);
    await this.execute(`ALTER TABLE ${quotedTable} RENAME COLUMN ${quotedFrom} TO ${quotedTo}`);
  }

  /**
   * Modify an existing column.
   *
   * @param table - Table name
   * @param column - New column definition
   */
  public async modifyColumn(table: string, column: ColumnDefinition): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(column.name);
    const sqlType = this.driver.dialect.getSqlType(column.type, {
      length: column.length,
      precision: column.precision,
      scale: column.scale,
    });

    // PostgreSQL requires separate ALTER statements for type and nullability
    await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} TYPE ${sqlType}`);

    if (column.nullable === false) {
      await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} SET NOT NULL`);
    } else if (column.nullable === true) {
      await this.execute(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} DROP NOT NULL`);
    }

    if (column.defaultValue !== undefined) {
      const defaultVal =
        typeof column.defaultValue === "string" ? `'${column.defaultValue}'` : column.defaultValue;
      await this.execute(
        `ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedColumn} SET DEFAULT ${defaultVal}`,
      );
    }
  }

  // ============================================================================
  // INDEX OPERATIONS
  // ============================================================================

  /**
   * Create an index on one or more columns.
   *
   * @param table - Table name
   * @param index - Index definition
   */
  public async createIndex(table: string, index: IndexDefinition): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const indexName = index.name ?? `idx_${table}_${index.columns.join("_")}`;
    const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
    const uniqueKeyword = index.unique ? "UNIQUE " : "";

    const columns = index.columns.map((col, i) => {
      const quotedCol = this.driver.dialect.quoteIdentifier(col);
      const direction = index.directions?.[i]?.toUpperCase() ?? "";
      return direction ? `${quotedCol} ${direction}` : quotedCol;
    });

    let sql = `CREATE ${uniqueKeyword}INDEX ${quotedIndexName} ON ${quotedTable} (${columns.join(", ")})`;

    // Add partial index condition
    if (index.where && Object.keys(index.where).length > 0) {
      const conditions = Object.entries(index.where)
        .map(([key, value]) => {
          const quotedKey = this.driver.dialect.quoteIdentifier(key);
          return typeof value === "string"
            ? `${quotedKey} = '${value}'`
            : `${quotedKey} = ${value}`;
        })
        .join(" AND ");
      sql += ` WHERE ${conditions}`;
    }

    await this.execute(sql);
  }

  /**
   * Drop an index.
   *
   * @param table - Table name
   * @param indexNameOrColumns - Index name or columns
   */
  public async dropIndex(table: string, indexNameOrColumns: string | string[]): Promise<void> {
    let indexName: string;

    if (typeof indexNameOrColumns === "string") {
      indexName = indexNameOrColumns;
    } else {
      indexName = `idx_${table}_${indexNameOrColumns.join("_")}`;
    }

    const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
    await this.execute(`DROP INDEX IF EXISTS ${quotedIndexName}`);
  }

  /**
   * Create a unique index.
   *
   * @param table - Table name
   * @param columns - Columns to include
   * @param name - Optional index name
   */
  public async createUniqueIndex(table: string, columns: string[], name?: string): Promise<void> {
    await this.createIndex(table, { columns, unique: true, name });
  }

  /**
   * Drop a unique index.
   *
   * @param table - Table name
   * @param columns - Columns in the index
   */
  public async dropUniqueIndex(table: string, columns: string[]): Promise<void> {
    await this.dropIndex(table, columns);
  }

  // ============================================================================
  // SPECIALIZED INDEXES
  // ============================================================================

  /**
   * Create a full-text search index using GIN.
   *
   * @param table - Table name
   * @param columns - Columns to index
   * @param options - Full-text options
   */
  public async createFullTextIndex(
    table: string,
    columns: string[],
    options?: FullTextIndexOptions,
  ): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const indexName = options?.name ?? `idx_${table}_fulltext_${columns.join("_")}`;
    const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);
    const language = options?.language ?? "english";

    const tsvectors = columns.map((col) => {
      const weight = options?.weights?.[col] ?? "A";
      return `setweight(to_tsvector('${language}', COALESCE(${this.driver.dialect.quoteIdentifier(col)}, '')), '${weight}')`;
    });

    await this.execute(
      `CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING GIN ((${tsvectors.join(" || ")}))`,
    );
  }

  /**
   * Drop a full-text search index.
   *
   * @param table - Table name
   * @param name - Index name
   */
  public async dropFullTextIndex(table: string, name: string): Promise<void> {
    await this.dropIndex(table, name);
  }

  /**
   * Create a geo-spatial index using GiST.
   *
   * @param table - Table name
   * @param column - Geo column
   * @param options - Geo index options
   */
  public async createGeoIndex(
    table: string,
    column: string,
    options?: GeoIndexOptions,
  ): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(column);
    const indexName = options?.name ?? `idx_${table}_geo_${column}`;
    const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);

    await this.execute(
      `CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING GIST (${quotedColumn})`,
    );
  }

  /**
   * Drop a geo-spatial index.
   *
   * @param table - Table name
   * @param column - Geo column
   */
  public async dropGeoIndex(table: string, column: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_geo_${column}`);
  }

  /**
   * Create a vector search index (requires pgvector extension).
   *
   * @param table - Table name
   * @param column - Vector column
   * @param options - Vector index options
   */
  public async createVectorIndex(
    table: string,
    column: string,
    options: VectorIndexOptions,
  ): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(column);
    const indexName = options.name ?? `idx_${table}_vector_${column}`;
    const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);

    // Map similarity to pgvector operator class
    const opClass =
      options.similarity === "euclidean"
        ? "vector_l2_ops"
        : options.similarity === "dotProduct"
          ? "vector_ip_ops"
          : "vector_cosine_ops";

    const lists = options.lists ?? 100;

    await this.execute(
      `CREATE INDEX ${quotedIndexName} ON ${quotedTable} USING ivfflat (${quotedColumn} ${opClass}) WITH (lists = ${lists})`,
    );
  }

  /**
   * Drop a vector search index.
   *
   * @param table - Table name
   * @param column - Vector column
   */
  public async dropVectorIndex(table: string, column: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_vector_${column}`);
  }

  /**
   * Create a TTL index (not natively supported in PostgreSQL).
   *
   * Note: PostgreSQL doesn't have native TTL indexes like MongoDB.
   * This creates a partial index and requires a scheduled job for cleanup.
   *
   * @param table - Table name
   * @param column - Date column
   * @param expireAfterSeconds - Expiration time in seconds
   */
  public async createTTLIndex(
    table: string,
    column: string,
    expireAfterSeconds: number,
  ): Promise<void> {
    // Create a partial index for expired rows (for efficient cleanup queries)
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(column);
    const indexName = `idx_${table}_ttl_${column}`;
    const quotedIndexName = this.driver.dialect.quoteIdentifier(indexName);

    await this.execute(
      `CREATE INDEX ${quotedIndexName} ON ${quotedTable} (${quotedColumn}) WHERE ${quotedColumn} < NOW() - INTERVAL '${expireAfterSeconds} seconds'`,
    );

    // Note: User must set up a scheduled job (pg_cron, etc.) to:
    // DELETE FROM table WHERE column < NOW() - INTERVAL 'X seconds'
  }

  /**
   * Drop a TTL index.
   *
   * @param table - Table name
   * @param column - Column with TTL index
   */
  public async dropTTLIndex(table: string, column: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_ttl_${column}`);
  }

  // ============================================================================
  // CONSTRAINTS
  // ============================================================================

  /**
   * Add a foreign key constraint.
   *
   * @param table - Table name
   * @param foreignKey - Foreign key definition
   */
  public async addForeignKey(table: string, foreignKey: ForeignKeyDefinition): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumn = this.driver.dialect.quoteIdentifier(foreignKey.column);
    const quotedRefTable = this.driver.dialect.quoteIdentifier(foreignKey.referencesTable);
    const quotedRefColumn = this.driver.dialect.quoteIdentifier(foreignKey.referencesColumn);

    const constraintName =
      foreignKey.name ?? `fk_${table}_${foreignKey.column}_${foreignKey.referencesTable}`;
    const quotedConstraint = this.driver.dialect.quoteIdentifier(constraintName);

    let sql = `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${quotedConstraint} FOREIGN KEY (${quotedColumn}) REFERENCES ${quotedRefTable} (${quotedRefColumn})`;

    if (foreignKey.onDelete) {
      sql += ` ON DELETE ${this.mapForeignKeyAction(foreignKey.onDelete)}`;
    }

    if (foreignKey.onUpdate) {
      sql += ` ON UPDATE ${this.mapForeignKeyAction(foreignKey.onUpdate)}`;
    }

    await this.execute(sql);
  }

  /**
   * Drop a foreign key constraint.
   *
   * @param table - Table name
   * @param name - Constraint name
   */
  public async dropForeignKey(table: string, name: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedConstraint = this.driver.dialect.quoteIdentifier(name);
    await this.execute(`ALTER TABLE ${quotedTable} DROP CONSTRAINT ${quotedConstraint}`);
  }

  /**
   * Add a primary key constraint.
   *
   * @param table - Table name
   * @param columns - Primary key columns
   */
  public async addPrimaryKey(table: string, columns: string[]): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const quotedColumns = columns.map((c) => this.driver.dialect.quoteIdentifier(c)).join(", ");
    const constraintName = `pk_${table}`;
    const quotedConstraint = this.driver.dialect.quoteIdentifier(constraintName);

    await this.execute(
      `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${quotedConstraint} PRIMARY KEY (${quotedColumns})`,
    );
  }

  /**
   * Drop the primary key constraint.
   *
   * @param table - Table name
   */
  public async dropPrimaryKey(table: string): Promise<void> {
    const quotedTable = this.driver.dialect.quoteIdentifier(table);
    const constraintName = `pk_${table}`;
    const quotedConstraint = this.driver.dialect.quoteIdentifier(constraintName);

    await this.execute(`ALTER TABLE ${quotedTable} DROP CONSTRAINT ${quotedConstraint}`);
  }

  // ============================================================================
  // SCHEMA VALIDATION (NOT APPLICABLE FOR PostgreSQL)
  // ============================================================================

  /**
   * Set schema validation (no-op for PostgreSQL).
   *
   * PostgreSQL uses column constraints instead.
   */
  public async setSchemaValidation(_table: string, _schema: object): Promise<void> {
    // No-op: PostgreSQL doesn't have MongoDB-style schema validation
    // Use CHECK constraints instead
  }

  /**
   * Remove schema validation (no-op for PostgreSQL).
   */
  public async removeSchemaValidation(_table: string): Promise<void> {
    // No-op
  }

  // ============================================================================
  // TRANSACTIONS
  // ============================================================================

  /**
   * Begin a transaction.
   */
  public async beginTransaction(): Promise<void> {
    await this.execute("BEGIN");
  }

  /**
   * Commit the current transaction.
   */
  public async commit(): Promise<void> {
    await this.execute("COMMIT");
  }

  /**
   * Rollback the current transaction.
   */
  public async rollback(): Promise<void> {
    await this.execute("ROLLBACK");
  }

  /**
   * Whether transactions are supported.
   */
  public supportsTransactions(): boolean {
    return true;
  }

  // ============================================================================
  // RAW ACCESS
  // ============================================================================

  /**
   * Execute raw operations with direct driver access.
   *
   * @param callback - Callback receiving the driver
   */
  public async raw<T>(callback: (connection: unknown) => Promise<T>): Promise<T> {
    return callback(this.driver);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Execute a SQL statement.
   *
   * @param sql - SQL to execute
   * @param params - Query parameters
   */
  private async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.driver.query(sql, params);
  }

  /**
   * Map foreign key action to PostgreSQL syntax.
   */
  private mapForeignKeyAction(action: "cascade" | "restrict" | "setNull" | "noAction"): string {
    const mapping: Record<string, string> = {
      cascade: "CASCADE",
      restrict: "RESTRICT",
      setNull: "SET NULL",
      noAction: "NO ACTION",
    };
    return mapping[action] ?? "NO ACTION";
  }
}
