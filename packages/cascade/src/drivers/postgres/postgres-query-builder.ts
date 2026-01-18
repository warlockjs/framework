/**
 * PostgreSQL Query Builder
 *
 * Implements the QueryBuilderContract for PostgreSQL databases.
 * Provides a fluent API for building SQL queries with proper
 * parameter handling and type safety.
 *
 * @module cascade/drivers/postgres
 */

import type { GenericObject } from "@mongez/reinforcements";
import type {
  ChunkCallback,
  CursorPaginationOptions,
  CursorPaginationResult,
  GroupByInput,
  HavingInput,
  JoinOptions,
  OrderDirection,
  PaginationOptions,
  PaginationResult,
  QueryBuilderContract,
  RawExpression,
  WhereCallback,
  WhereObject,
  WhereOperator,
} from "../../contracts/query-builder.contract";
import type { DataSource } from "../../data-source/data-source";
import { dataSourceRegistry } from "../../data-source/data-source-registry";
import type { GlobalScopeDefinition, LocalScopeCallback } from "../../model/model";
import { getModelFromRegistry } from "../../model/register-model";
import type { PostgresDriver } from "./postgres-driver";
import { PostgresQueryParser, type PostgresParserOperation } from "./postgres-query-parser";

/**
 * PostgreSQL Query Builder.
 *
 * Implements the Cascade QueryBuilderContract for PostgreSQL.
 * Collects query operations and delegates to PostgresQueryParser
 * for SQL generation.
 *
 * @example
 * ```typescript
 * const users = await queryBuilder('users')
 *   .select(['id', 'name', 'email'])
 *   .where('status', 'active')
 *   .where('age', '>', 18)
 *   .orderBy('createdAt', 'desc')
 *   .limit(10)
 *   .get();
 * ```
 */
export class PostgresQueryBuilder<T = unknown> implements QueryBuilderContract<T> {
  /**
   * Collected operations to be parsed into SQL.
   */
  public operations: PostgresParserOperation[] = [];

  /**
   * Data source instance.
   */
  public readonly dataSource: DataSource;

  /**
   * Hydrate callback for transforming results.
   */
  public hydrateCallback?: (data: unknown, index: number) => unknown;

  /**
   * Callback invoked before query execution.
   */
  private fetchingCallback?: (query: this) => void | Promise<void>;

  /**
   * Callback invoked after records fetched but before hydration.
   */
  private hydratingCallback?: (records: unknown[], context: unknown) => void | Promise<void>;

  /**
   * Callback invoked after records fetched and hydrated.
   */
  private fetchedCallback?: (records: unknown[], context: unknown) => void | Promise<void>;

  /**
   * Pending global scopes.
   */
  public pendingGlobalScopes?: Map<string, GlobalScopeDefinition>;

  /**
   * Available local scopes.
   */
  public availableLocalScopes?: Map<string, LocalScopeCallback>;

  /**
   * Disabled global scope names.
   */
  public disabledGlobalScopes = new Set<string>();

  /**
   * Whether scopes have been applied.
   */
  public scopesApplied = false;

  /**
   * Create a new query builder.
   *
   * @param table - Target table name
   * @param dataSource - Optional data source (uses default if not provided)
   */
  public constructor(
    public readonly table: string,
    dataSource?: DataSource,
  ) {
    this.dataSource = dataSource ?? dataSourceRegistry.get()!;
  }

  /**
   * Get the PostgreSQL driver instance.
   */
  private get driver(): PostgresDriver {
    return this.dataSource.driver as PostgresDriver;
  }

  /**
   * Add an operation to the operations list.
   *
   * @param type - Operation type
   * @param data - Operation data
   */
  private addOperation(type: PostgresParserOperation["type"], data: Record<string, unknown>): void {
    this.operations.push({ type, data });
  }

  /**
   * Clone this query builder with all current operations.
   *
   * @returns New query builder instance
   */
  public clone(): this {
    const cloned = new PostgresQueryBuilder<T>(this.table, this.dataSource);
    cloned.operations = [...this.operations];
    cloned.hydrateCallback = this.hydrateCallback;
    cloned.pendingGlobalScopes = this.pendingGlobalScopes;
    cloned.availableLocalScopes = this.availableLocalScopes;
    cloned.disabledGlobalScopes = new Set(this.disabledGlobalScopes);
    cloned.scopesApplied = this.scopesApplied;
    return cloned as this;
  }

  // ============================================================================
  // HYDRATION
  // ============================================================================

  /**
   * Set a hydration callback to transform each result row.
   *
   * @param callback - Transform function
   * @returns This builder for chaining
   */
  public hydrate(callback: (data: unknown, index: number) => unknown): this {
    this.hydrateCallback = callback;
    return this;
  }

  /**
   * Register callback invoked before query execution.
   *
   * @param callback - Callback function
   * @returns Unsubscribe function
   */
  public onFetching(callback: (query: this) => void | Promise<void>): () => void {
    this.fetchingCallback = callback;
    return () => {
      this.fetchingCallback = undefined;
    };
  }

  /**
   * Register callback invoked after fetch but before hydration.
   *
   * @param callback - Callback function
   * @returns Unsubscribe function
   */
  public onHydrating(
    callback: (records: unknown[], context: unknown) => void | Promise<void>,
  ): () => void {
    this.hydratingCallback = callback;
    return () => {
      this.hydratingCallback = undefined;
    };
  }

  /**
   * Register callback invoked after fetch and hydration.
   *
   * @param callback - Callback function
   * @returns Unsubscribe function
   */
  public onFetched(
    callback: (records: unknown[], context: unknown) => void | Promise<void>,
  ): () => void {
    this.fetchedCallback = callback;
    return () => {
      this.fetchedCallback = undefined;
    };
  }

  // ============================================================================
  // SCOPES
  // ============================================================================

  /**
   * Disable one or more global scopes for this query.
   *
   * @param scopeNames - Scope names to disable
   * @returns This builder for chaining
   */
  public withoutGlobalScope(...scopeNames: string[]): this {
    scopeNames.forEach((name) => this.disabledGlobalScopes.add(name));
    return this;
  }

  /**
   * Disable all global scopes for this query.
   *
   * @returns This builder for chaining
   */
  public withoutGlobalScopes(): this {
    if (this.pendingGlobalScopes) {
      this.pendingGlobalScopes.forEach((_, name) => {
        this.disabledGlobalScopes.add(name);
      });
    }
    return this;
  }

  /**
   * Apply a local scope to this query.
   *
   * @param scopeName - Name of the local scope
   * @returns This builder for chaining
   */
  public scope(scopeName: string): this {
    if (!this.availableLocalScopes) {
      throw new Error("No local scopes available");
    }

    const scopeCallback = this.availableLocalScopes.get(scopeName);
    if (!scopeCallback) {
      throw new Error(`Local scope "${scopeName}" not found`);
    }

    scopeCallback(this as unknown as QueryBuilderContract<T>);
    return this;
  }

  /**
   * Apply pending global scopes before query execution.
   */
  private applyPendingScopes(): void {
    if (!this.pendingGlobalScopes || this.scopesApplied) {
      return;
    }

    const beforeOps: PostgresParserOperation[] = [];
    const afterOps: PostgresParserOperation[] = [];

    for (const [name, { callback, timing }] of this.pendingGlobalScopes) {
      if (this.disabledGlobalScopes.has(name)) {
        continue;
      }

      const tempBuilder = new PostgresQueryBuilder(this.table, this.dataSource);
      callback(tempBuilder as unknown as QueryBuilderContract<T>);

      if (timing === "before") {
        beforeOps.push(...tempBuilder.operations);
      } else {
        afterOps.push(...tempBuilder.operations);
      }
    }

    this.operations = [...beforeOps, ...this.operations, ...afterOps];
    this.scopesApplied = true;
  }

  // ============================================================================
  // WHERE CLAUSES - BASIC
  // ============================================================================

  /**
   * Add a WHERE clause to filter records.
   */
  public where(field: string, value: unknown): this;
  public where(field: string, operator: WhereOperator, value: unknown): this;
  public where(conditions: WhereObject): this;
  public where(callback: WhereCallback<T>): this;
  public where(...args: unknown[]): this {
    if (args.length === 1) {
      if (typeof args[0] === "function") {
        // Callback for nested conditions
        const tempBuilder = new PostgresQueryBuilder<T>(this.table, this.dataSource);
        (args[0] as WhereCallback<T>)(tempBuilder as unknown as QueryBuilderContract<T>);
        // Wrap nested operations
        this.addOperation("where", { nested: tempBuilder.operations });
      } else if (typeof args[0] === "object") {
        // Object conditions
        for (const [key, value] of Object.entries(args[0] as WhereObject)) {
          this.addOperation("where", { field: key, operator: "=", value });
        }
      }
    } else if (args.length === 2) {
      this.addOperation("where", { field: args[0], operator: "=", value: args[1] });
    } else if (args.length === 3) {
      this.addOperation("where", { field: args[0], operator: args[1], value: args[2] });
    }
    return this;
  }

  /**
   * Add an OR WHERE clause.
   */
  public orWhere(field: string, value: unknown): this;
  public orWhere(field: string, operator: WhereOperator, value: unknown): this;
  public orWhere(conditions: WhereObject): this;
  public orWhere(callback: WhereCallback<T>): this;
  public orWhere(...args: unknown[]): this {
    if (args.length === 2) {
      this.addOperation("orWhere", { field: args[0], operator: "=", value: args[1] });
    } else if (args.length === 3) {
      this.addOperation("orWhere", { field: args[0], operator: args[1], value: args[2] });
    }
    return this;
  }

  /**
   * Add a raw WHERE clause.
   */
  public whereRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("whereRaw", { expression, bindings });
    return this;
  }

  /**
   * Add a raw OR WHERE clause.
   */
  public orWhereRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("orWhereRaw", { expression, bindings });
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - COLUMN COMPARISONS
  // ============================================================================

  /**
   * Compare two columns.
   */
  public whereColumn(first: string, operator: WhereOperator, second: string): this {
    this.addOperation("whereColumn", { first, operator, second });
    return this;
  }

  /**
   * Compare two columns with OR.
   */
  public orWhereColumn(first: string, operator: WhereOperator, second: string): this {
    this.addOperation("orWhereColumn", { first, operator, second });
    return this;
  }

  /**
   * Compare multiple column pairs.
   */
  public whereColumns(
    comparisons: Array<[left: string, operator: WhereOperator, right: string]>,
  ): this {
    for (const [left, operator, right] of comparisons) {
      this.whereColumn(left, operator, right);
    }
    return this;
  }

  /**
   * Check if field is between two columns.
   */
  public whereBetweenColumns(field: string, lowerColumn: string, upperColumn: string): this {
    this.addOperation("whereBetween", { field, lowerColumn, upperColumn, useColumns: true });
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - DATE OPERATIONS
  // ============================================================================

  /**
   * Filter by date (ignoring time).
   */
  public whereDate(field: string, value: Date | string): this {
    this.addOperation("whereDate", { field, value });
    return this;
  }

  /**
   * Alias for whereDate.
   */
  public whereDateEquals(field: string, value: Date | string): this {
    return this.whereDate(field, value);
  }

  /**
   * Filter for dates before a value.
   */
  public whereDateBefore(field: string, value: Date | string): this {
    this.addOperation("whereDateBefore", { field, value });
    return this;
  }

  /**
   * Filter for dates after a value.
   */
  public whereDateAfter(field: string, value: Date | string): this {
    this.addOperation("whereDateAfter", { field, value });
    return this;
  }

  /**
   * Filter by time.
   */
  public whereTime(field: string, value: string): this {
    this.addOperation("where", { field, operator: "=", value, timeOnly: true });
    return this;
  }

  /**
   * Filter by day of month.
   */
  public whereDay(field: string, value: number): this {
    this.addOperation("whereRaw", {
      expression: `EXTRACT(DAY FROM ${field}) = ?`,
      bindings: [value],
    });
    return this;
  }

  /**
   * Filter by month.
   */
  public whereMonth(field: string, value: number): this {
    this.addOperation("whereRaw", {
      expression: `EXTRACT(MONTH FROM ${field}) = ?`,
      bindings: [value],
    });
    return this;
  }

  /**
   * Filter by year.
   */
  public whereYear(field: string, value: number): this {
    this.addOperation("whereRaw", {
      expression: `EXTRACT(YEAR FROM ${field}) = ?`,
      bindings: [value],
    });
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - JSON OPERATIONS
  // ============================================================================

  /**
   * Check if JSON contains value.
   */
  public whereJsonContains(path: string, value: unknown): this {
    this.addOperation("whereJsonContains", { path, value });
    return this;
  }

  /**
   * Check if JSON doesn't contain value.
   */
  public whereJsonDoesntContain(path: string, value: unknown): this {
    this.addOperation("whereJsonDoesntContain", { path, value });
    return this;
  }

  /**
   * Check if JSON contains key.
   */
  public whereJsonContainsKey(path: string): this {
    this.addOperation("whereRaw", {
      expression: `${path} IS NOT NULL`,
      bindings: [],
    });
    return this;
  }

  /**
   * Check JSON array/string length.
   */
  public whereJsonLength(path: string, operator: WhereOperator, value: number): this {
    this.addOperation("whereRaw", {
      expression: `jsonb_array_length(${path}) ${operator} ?`,
      bindings: [value],
    });
    return this;
  }

  /**
   * Check if JSON is array.
   */
  public whereJsonIsArray(path: string): this {
    this.addOperation("whereRaw", {
      expression: `jsonb_typeof(${path}) = 'array'`,
      bindings: [],
    });
    return this;
  }

  /**
   * Check if JSON is object.
   */
  public whereJsonIsObject(path: string): this {
    this.addOperation("whereRaw", {
      expression: `jsonb_typeof(${path}) = 'object'`,
      bindings: [],
    });
    return this;
  }

  /**
   * Check array length.
   */
  public whereArrayLength(field: string, operator: WhereOperator, value: number): this {
    this.addOperation("whereRaw", {
      expression: `array_length(${field}, 1) ${operator} ?`,
      bindings: [value],
    });
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - CONVENIENCE METHODS
  // ============================================================================

  /**
   * Filter by ID.
   */
  public whereId(value: string | number): this {
    return this.where("id", value);
  }

  /**
   * Filter by multiple IDs.
   */
  public whereIds(values: Array<string | number>): this {
    return this.whereIn("id", values);
  }

  /**
   * Filter by UUID.
   */
  public whereUuid(value: string): this {
    return this.where("uuid", value);
  }

  /**
   * Filter by ULID.
   */
  public whereUlid(value: string): this {
    return this.where("ulid", value);
  }

  /**
   * Full-text search.
   */
  public whereFullText(fields: string | string[], query: string): this {
    const fieldList = Array.isArray(fields) ? fields : [fields];
    this.addOperation("whereFullText", { fields: fieldList, query });
    return this;
  }

  /**
   * Full-text search with OR.
   */
  public orWhereFullText(fields: string | string[], query: string): this {
    // TODO: Handle OR full-text
    return this.whereFullText(fields, query);
  }

  /**
   * Alias for whereFullText.
   */
  public whereSearch(field: string, query: string): this {
    return this.whereFullText(field, query);
  }

  /**
   * Negate conditions.
   */
  public whereNot(callback: WhereCallback<T>): this {
    // TODO: Implement NOT wrapper
    return this;
  }

  /**
   * Negate conditions with OR.
   */
  public orWhereNot(callback: WhereCallback<T>): this {
    // TODO: Implement OR NOT wrapper
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - COMPARISON OPERATORS
  // ============================================================================

  /**
   * Filter by value in array.
   */
  public whereIn(field: string, values: unknown[]): this {
    this.addOperation("whereIn", { field, values });
    return this;
  }

  /**
   * Filter by value not in array.
   */
  public whereNotIn(field: string, values: unknown[]): this {
    this.addOperation("whereNotIn", { field, values });
    return this;
  }

  /**
   * Filter by NULL value.
   */
  public whereNull(field: string): this {
    this.addOperation("whereNull", { field });
    return this;
  }

  /**
   * Filter by NOT NULL value.
   */
  public whereNotNull(field: string): this {
    this.addOperation("whereNotNull", { field });
    return this;
  }

  /**
   * Filter by range (inclusive).
   */
  public whereBetween(field: string, range: [unknown, unknown]): this {
    this.addOperation("whereBetween", { field, range });
    return this;
  }

  /**
   * Filter by not in range.
   */
  public whereNotBetween(field: string, range: [unknown, unknown]): this {
    this.addOperation("whereNotBetween", { field, range });
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - PATTERN MATCHING
  // ============================================================================

  /**
   * Filter by LIKE pattern (case-insensitive).
   */
  public whereLike(field: string, pattern: RegExp | string): this {
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
    this.addOperation("whereLike", { field, pattern: patternStr });
    return this;
  }

  /**
   * Filter by NOT LIKE pattern.
   */
  public whereNotLike(field: string, pattern: RegExp | string): this {
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
    this.addOperation("whereNotLike", { field, pattern: patternStr });
    return this;
  }

  /**
   * Filter by prefix.
   */
  public whereStartsWith(field: string, value: string | number): this {
    return this.whereLike(field, `${value}%`);
  }

  /**
   * Filter by not starting with prefix.
   */
  public whereNotStartsWith(field: string, value: string | number): this {
    return this.whereNotLike(field, `${value}%`);
  }

  /**
   * Filter by suffix.
   */
  public whereEndsWith(field: string, value: string | number): this {
    return this.whereLike(field, `%${value}`);
  }

  /**
   * Filter by not ending with suffix.
   */
  public whereNotEndsWith(field: string, value: string | number): this {
    return this.whereNotLike(field, `%${value}`);
  }

  /**
   * Filter by date range.
   */
  public whereDateBetween(field: string, range: [Date, Date]): this {
    this.addOperation("whereDateBetween", { field, range });
    return this;
  }

  /**
   * Filter by not in date range.
   */
  public whereDateNotBetween(field: string, range: [Date, Date]): this {
    // Use NOT BETWEEN
    this.addOperation("whereNotBetween", { field, range });
    return this;
  }

  // ============================================================================
  // WHERE CLAUSES - EXISTENCE CHECKS
  // ============================================================================

  /**
   * Check if field/subquery exists.
   */
  public whereExists(field: string): this;
  public whereExists(callback: WhereCallback<T>): this;
  public whereExists(param: string | WhereCallback<T>): this {
    if (typeof param === "function") {
      // Subquery exists
      const tempBuilder = new PostgresQueryBuilder<T>(this.table, this.dataSource);
      param(tempBuilder as unknown as QueryBuilderContract<T>);
      this.addOperation("whereExists", { subquery: tempBuilder.operations });
    } else {
      this.addOperation("whereNotNull", { field: param });
    }
    return this;
  }

  /**
   * Check if field/subquery doesn't exist.
   */
  public whereNotExists(field: string): this;
  public whereNotExists(callback: WhereCallback<T>): this;
  public whereNotExists(param: string | WhereCallback<T>): this {
    if (typeof param === "function") {
      const tempBuilder = new PostgresQueryBuilder<T>(this.table, this.dataSource);
      param(tempBuilder as unknown as QueryBuilderContract<T>);
      this.addOperation("whereNotExists", { subquery: tempBuilder.operations });
    } else {
      this.addOperation("whereNull", { field: param });
    }
    return this;
  }

  /**
   * Check array size.
   */
  public whereSize(field: string, size: number): this;
  public whereSize(field: string, operator: WhereOperator, size: number): this;
  public whereSize(field: string, ...args: unknown[]): this {
    const operator = args.length === 2 ? (args[0] as string) : "=";
    const size = args.length === 2 ? (args[1] as number) : (args[0] as number);
    return this.whereArrayLength(field, operator as WhereOperator, size);
  }

  /**
   * Perform a full-text search.
   */
  public textSearch(query: string, filters?: WhereObject): this {
    // Apply filters if provided
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        this.where(key, value);
      }
    }
    // Full-text search would need to know which columns to search
    // For now, this is a placeholder - users should use whereFullText directly
    return this;
  }

  /**
   * Constrain an array field to contain the given value.
   */
  public whereArrayContains(field: string, value: unknown, key?: string): this {
    if (key) {
      // Array of objects - use JSON containment check
      this.addOperation("whereRaw", {
        expression: `${this.driver.dialect.quoteIdentifier(field)} @> ?::jsonb`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      // Simple array - check if value is in array
      this.addOperation("whereRaw", {
        expression: `? = ANY(${this.driver.dialect.quoteIdentifier(field)})`,
        bindings: [value],
      });
    }
    return this;
  }

  /**
   * Constrain an array field to not contain the given value.
   */
  public whereArrayNotContains(field: string, value: unknown, key?: string): this {
    if (key) {
      this.addOperation("whereRaw", {
        expression: `NOT (${this.driver.dialect.quoteIdentifier(field)} @> ?::jsonb)`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `NOT (? = ANY(${this.driver.dialect.quoteIdentifier(field)}))`,
        bindings: [value],
      });
    }
    return this;
  }

  /**
   * Constrain an array field to contain the value OR be empty.
   */
  public whereArrayHasOrEmpty(field: string, value: unknown, key?: string): this {
    const quotedField = this.driver.dialect.quoteIdentifier(field);
    if (key) {
      this.addOperation("whereRaw", {
        expression: `(${quotedField} @> ?::jsonb OR ${quotedField} = '[]'::jsonb OR ${quotedField} IS NULL)`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `(? = ANY(${quotedField}) OR array_length(${quotedField}, 1) IS NULL)`,
        bindings: [value],
      });
    }
    return this;
  }

  /**
   * Constrain an array field to not contain the value OR be empty.
   */
  public whereArrayNotHaveOrEmpty(field: string, value: unknown, key?: string): this {
    const quotedField = this.driver.dialect.quoteIdentifier(field);
    if (key) {
      this.addOperation("whereRaw", {
        expression: `(NOT (${quotedField} @> ?::jsonb) OR ${quotedField} = '[]'::jsonb OR ${quotedField} IS NULL)`,
        bindings: [JSON.stringify([{ [key]: value }])],
      });
    } else {
      this.addOperation("whereRaw", {
        expression: `(NOT (? = ANY(${quotedField})) OR array_length(${quotedField}, 1) IS NULL)`,
        bindings: [value],
      });
    }
    return this;
  }

  // ============================================================================
  // JOINS
  // ============================================================================

  /**
   * Add a JOIN clause.
   */
  public join(table: string, localField: string, foreignField: string): this;
  public join(options: JoinOptions): this;
  public join(...args: unknown[]): this {
    if (args.length === 3) {
      this.addOperation("join", {
        table: args[0],
        localField: args[1],
        foreignField: args[2],
      });
    } else {
      this.addOperation("join", args[0] as Record<string, unknown>);
    }
    return this;
  }

  /**
   * Add a LEFT JOIN clause.
   */
  public leftJoin(table: string, localField: string, foreignField: string): this;
  public leftJoin(options: JoinOptions): this;
  public leftJoin(...args: unknown[]): this {
    if (args.length === 3) {
      this.addOperation("leftJoin", {
        table: args[0],
        localField: args[1],
        foreignField: args[2],
      });
    } else {
      this.addOperation("leftJoin", args[0] as Record<string, unknown>);
    }
    return this;
  }

  /**
   * Add a RIGHT JOIN clause.
   */
  public rightJoin(table: string, localField: string, foreignField: string): this;
  public rightJoin(options: JoinOptions): this;
  public rightJoin(...args: unknown[]): this {
    if (args.length === 3) {
      this.addOperation("rightJoin", {
        table: args[0],
        localField: args[1],
        foreignField: args[2],
      });
    } else {
      this.addOperation("rightJoin", args[0] as Record<string, unknown>);
    }
    return this;
  }

  /**
   * Add an INNER JOIN clause.
   */
  public innerJoin(table: string, localField: string, foreignField: string): this;
  public innerJoin(options: JoinOptions): this;
  public innerJoin(...args: unknown[]): this {
    if (args.length === 3) {
      this.addOperation("innerJoin", {
        table: args[0],
        localField: args[1],
        foreignField: args[2],
      });
    } else {
      this.addOperation("innerJoin", args[0] as Record<string, unknown>);
    }
    return this;
  }

  /**
   * Add a FULL OUTER JOIN clause.
   */
  public fullJoin(table: string, localField: string, foreignField: string): this;
  public fullJoin(options: JoinOptions): this;
  public fullJoin(...args: unknown[]): this {
    if (args.length === 3) {
      this.addOperation("fullJoin", {
        table: args[0],
        localField: args[1],
        foreignField: args[2],
      });
    } else {
      this.addOperation("fullJoin", args[0] as Record<string, unknown>);
    }
    return this;
  }

  /**
   * Add a CROSS JOIN clause.
   */
  public crossJoin(table: string): this {
    this.addOperation("crossJoin", { table });
    return this;
  }

  /**
   * Add a raw JOIN clause.
   */
  public joinRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("joinRaw", { expression, bindings });
    return this;
  }

  // ============================================================================
  // SELECT / PROJECTION
  // ============================================================================

  /**
   * Select specific columns.
   */
  public select(fields: string[]): this;
  public select(fields: Record<string, 0 | 1 | boolean>): this;
  public select(...fields: Array<string | string[]>): this;
  public select(...args: unknown[]): this {
    // Handle single array argument
    if (args.length === 1 && Array.isArray(args[0])) {
      this.addOperation("select", { fields: args[0] });
    }
    // Handle Record<string, 0 | 1 | boolean> (projection map)
    else if (args.length === 1 && typeof args[0] === "object" && !Array.isArray(args[0])) {
      this.addOperation("select", { fields: args[0] });
    }
    // Handle rest params (...fields)
    else {
      const flatFields = args.flat() as string[];
      this.addOperation("select", { fields: flatFields });
    }
    return this;
  }

  /**
   * Select a field with alias.
   */
  public selectAs(field: string, alias: string): this {
    // Use select operation with alias format (Record<field, alias>)
    this.addOperation("select", { fields: { [field]: alias } });
    return this;
  }

  /**
   * Select raw expression.
   */
  public selectRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("selectRaw", { expression, bindings });
    return this;
  }

  /**
   * Select multiple raw expressions.
   */
  public selectRawMany(
    definitions: Array<{ alias: string; expression: RawExpression; bindings?: unknown[] }>,
  ): this {
    for (const def of definitions) {
      this.selectRaw({ [def.alias]: def.expression }, def.bindings);
    }
    return this;
  }

  /**
   * Select subquery.
   */
  public selectSub(expression: RawExpression, alias: string): this {
    this.addOperation("selectRaw", { expression: { [alias]: expression } });
    return this;
  }

  /**
   * Add subquery to existing selection.
   */
  public addSelectSub(expression: RawExpression, alias: string): this {
    return this.selectSub(expression, alias);
  }

  /**
   * Select aggregate value.
   */
  public selectAggregate(
    field: string,
    aggregate: "sum" | "avg" | "min" | "max" | "count" | "first" | "last",
    alias: string,
  ): this {
    const expr = `${aggregate.toUpperCase()}(${field})`;
    return this.selectRaw({ [alias]: expr });
  }

  /**
   * Select existence check.
   */
  public selectExists(field: string, alias: string): this {
    return this.selectRaw({ [alias]: `${field} IS NOT NULL` });
  }

  /**
   * Select count.
   */
  public selectCount(field: string, alias: string): this {
    return this.selectAggregate(field, "count", alias);
  }

  /**
   * Select CASE expression.
   */
  public selectCase(
    cases: Array<{ when: RawExpression; then: RawExpression | unknown }>,
    otherwise: RawExpression | unknown,
    alias: string,
  ): this {
    const caseExpr = cases.map((c) => `WHEN ${c.when} THEN ${c.then}`).join(" ");
    return this.selectRaw({ [alias]: `CASE ${caseExpr} ELSE ${otherwise} END` });
  }

  /**
   * Select conditional (IF/ELSE).
   */
  public selectWhen(
    condition: RawExpression,
    thenValue: RawExpression | unknown,
    elseValue: RawExpression | unknown,
    alias: string,
  ): this {
    return this.selectRaw({
      [alias]: `CASE WHEN ${condition} THEN ${thenValue} ELSE ${elseValue} END`,
    });
  }

  /**
   * Direct projection manipulation.
   */
  public selectDriverProjection(callback: (projection: Record<string, unknown>) => void): this {
    // PostgreSQL doesn't have direct projection manipulation like MongoDB
    return this;
  }

  /**
   * Select JSON path.
   */
  public selectJson(path: string, alias?: string): this {
    const parts = path.split("->");
    const column = parts[0];
    const jsonPath = parts.slice(1).join("->");
    const expr = jsonPath ? `${column}->>'${jsonPath}'` : column;
    return alias ? this.selectAs(expr, alias) : this.selectRaw(expr);
  }

  /**
   * Select JSON path with raw expression.
   */
  public selectJsonRaw(path: string, expression: RawExpression, alias: string): this {
    return this.selectRaw({ [alias]: expression });
  }

  /**
   * Exclude JSON path.
   */
  public deselectJson(path: string): this {
    return this.deselect([path]);
  }

  /**
   * Concatenate fields.
   */
  public selectConcat(fields: Array<string | RawExpression>, alias: string): this {
    const expr = fields.join(" || ");
    return this.selectRaw({ [alias]: expr });
  }

  /**
   * Coalesce values.
   */
  public selectCoalesce(fields: Array<string | RawExpression>, alias: string): this {
    const expr = `COALESCE(${fields.join(", ")})`;
    return this.selectRaw({ [alias]: expr });
  }

  /**
   * Window function.
   */
  public selectWindow(spec: RawExpression): this {
    this.addOperation("selectRaw", { expression: spec });
    return this;
  }

  /**
   * Exclude columns from projection.
   */
  public deselect(fields: string[]): this {
    this.addOperation("deselect", { fields });
    return this;
  }

  /**
   * Clear selection.
   */
  public clearSelect(): this {
    this.operations = this.operations.filter(
      (op) => !op.type.startsWith("select") && op.type !== "deselect",
    );
    return this;
  }

  /**
   * Select all columns.
   */
  public selectAll(): this {
    return this.clearSelect();
  }

  /**
   * Restore default projection.
   */
  public selectDefault(): this {
    return this.clearSelect();
  }

  /**
   * Select distinct values.
   */
  public distinctValues(fields?: string | string[]): this {
    this.addOperation("distinct", {});
    if (fields) {
      this.select(Array.isArray(fields) ? fields : [fields]);
    }
    return this;
  }

  /**
   * Add additional select fields.
   */
  public addSelect(fields: string[]): this {
    this.addOperation("select", { fields, add: true });
    return this;
  }

  // ============================================================================
  // ORDERING
  // ============================================================================

  /**
   * Order results.
   */
  public orderBy(field: string, direction?: OrderDirection): this;
  public orderBy(fields: Record<string, OrderDirection>): this;
  public orderBy(...args: unknown[]): this {
    if (typeof args[0] === "string") {
      this.addOperation("orderBy", { field: args[0], direction: args[1] ?? "asc" });
    } else {
      for (const [field, direction] of Object.entries(args[0] as Record<string, OrderDirection>)) {
        this.addOperation("orderBy", { field, direction });
      }
    }
    return this;
  }

  /**
   * Order descending.
   */
  public orderByDesc(field: string): this {
    return this.orderBy(field, "desc");
  }

  /**
   * Order with raw expression.
   */
  public orderByRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("orderByRaw", { expression, bindings });
    return this;
  }

  /**
   * Order randomly.
   */
  public orderByRandom(limit: number): this {
    this.addOperation("orderByRaw", { expression: "RANDOM()" });
    return this.limit(limit);
  }

  /**
   * Get latest records.
   */
  public async latest(column = "createdAt"): Promise<T[]> {
    return this.orderBy(column, "desc").get();
  }

  /**
   * Get oldest records.
   */
  public oldest(column = "createdAt"): this {
    return this.orderBy(column, "asc");
  }

  // ============================================================================
  // LIMITING / PAGINATION
  // ============================================================================

  /**
   * Limit results.
   */
  public limit(value: number): this {
    this.addOperation("limit", { value });
    return this;
  }

  /**
   * Skip results.
   */
  public skip(value: number): this {
    this.addOperation("offset", { value });
    return this;
  }

  /**
   * Offset results.
   */
  public offset(value: number): this {
    return this.skip(value);
  }

  /**
   * Take first N results.
   */
  public take(value: number): this {
    return this.limit(value);
  }

  /**
   * Apply cursor pagination hints.
   */
  public cursor(after?: unknown, before?: unknown): this {
    // Store cursor hints for cursorPaginate
    return this;
  }

  // ============================================================================
  // GROUPING / AGGREGATION
  // ============================================================================

  /**
   * Group results.
   */
  public groupBy(input: GroupByInput): this {
    const fields = Array.isArray(input) ? input : [input];
    this.addOperation("groupBy", { fields });
    return this;
  }

  /**
   * Raw GROUP BY.
   */
  public groupByRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("groupBy", { expression, bindings });
    return this;
  }

  /**
   * HAVING clause.
   */
  public having(field: string, value: unknown): this;
  public having(field: string, operator: WhereOperator, value: unknown): this;
  public having(condition: HavingInput): this;
  public having(...args: unknown[]): this {
    if (args.length === 1) {
      const input = args[0] as HavingInput;
      if (Array.isArray(input)) {
        if (input.length === 2) {
          this.addOperation("having", { field: input[0], operator: "=", value: input[1] });
        } else {
          this.addOperation("having", { field: input[0], operator: input[1], value: input[2] });
        }
      } else {
        for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
          this.addOperation("having", { field: key, operator: "=", value });
        }
      }
    } else if (args.length === 2) {
      this.addOperation("having", { field: args[0], operator: "=", value: args[1] });
    } else if (args.length === 3) {
      this.addOperation("having", { field: args[0], operator: args[1], value: args[2] });
    }
    return this;
  }

  /**
   * Raw HAVING clause.
   */
  public havingRaw(expression: RawExpression, bindings?: unknown[]): this {
    this.addOperation("havingRaw", { expression, bindings });
    return this;
  }

  // ============================================================================
  // EXECUTION METHODS
  // ============================================================================

  /**
   * Execute query and get all results.
   */
  public async get<TResult = T>(): Promise<TResult[]> {
    this.applyPendingScopes();

    // Apply JOIN operations for joinWith() relations
    this.applyJoinRelations();

    if (this.fetchingCallback) {
      await this.fetchingCallback(this);
    }

    const parser = new PostgresQueryParser({
      table: this.table,
      operations: this.operations,
    });

    const { sql, params } = parser.parse();
    try {
      const result = await this.driver.query<TResult>(sql, params);

      let records = result.rows;

      // Extract joined relation data before hydration
      const joinedData = this.extractJoinedRelationData(records);

      if (this.hydratingCallback) {
        await this.hydratingCallback(records as unknown[], {});
      }

      if (this.hydrateCallback) {
        records = records.map((row, index) => this.hydrateCallback!(row, index)) as TResult[];
      }

      // Attach joined relations to hydrated models
      this.attachJoinedRelations(records, joinedData);

      if (this.fetchedCallback) {
        await this.fetchedCallback(records as unknown[], {});
      }

      // Cleanup
      this.operations = [];

      return records;
    } catch (error) {
      console.log("Error while executing:", sql, params);
      console.log("Query Builder Error:", error);
      throw error;
    }
  }

  /**
   * Apply JOIN operations for joinWith() relations.
   */
  private applyJoinRelations(): void {
    if (this.joinRelations.size === 0 || !this.relationDefinitions) return;

    for (const [relationName, config] of this.joinRelations) {
      const relationDef = this.relationDefinitions[relationName];
      if (!relationDef) continue;

      // Resolve the related model class
      const RelatedModel =
        typeof relationDef.model === "string"
          ? getModelFromRegistry(relationDef.model)
          : relationDef.model;

      if (!RelatedModel) continue;

      const relatedTable = RelatedModel.table;
      const alias = config.alias;

      // Determine join keys based on relation type
      let localField: string;
      let foreignField: string;

      if (relationDef.type === "belongsTo") {
        localField = relationDef.foreignKey || `${relationName}Id`;
        foreignField = relationDef.ownerKey || "id";
      } else {
        // hasOne, hasMany
        localField = relationDef.localKey || "id";
        foreignField = relationDef.foreignKey || `${this.table.slice(0, -1)}Id`;
      }

      // Add LEFT JOIN operation
      this.addOperation("leftJoin", {
        table: relatedTable,
        alias,
        localField,
        foreignField,
      });

      // Add SELECT for related columns with prefix
      this.addOperation("selectRelatedColumns", {
        alias,
        relationName,
        table: relatedTable,
      });
    }
  }

  /**
   * Extract joined relation data from raw records.
   * Returns a map of record index to relation data.
   */
  private extractJoinedRelationData(records: any[]): Map<number, Record<string, any>> {
    const result = new Map<number, Record<string, any>>();

    if (this.joinRelations.size === 0) return result;

    records.forEach((record, index) => {
      const relationData: Record<string, any> = {};

      for (const [relationName, config] of this.joinRelations) {
        const columnName = config.alias; // e.g., "_rel_author"

        // Get the JSON object from the row_to_json column
        const relatedData = record[columnName];

        // Remove from main record so it doesn't appear in model.data
        delete record[columnName];

        // If null or all values are null, set to null
        if (
          relatedData === null ||
          (typeof relatedData === "object" && Object.values(relatedData).every((v) => v === null))
        ) {
          relationData[relationName] = null;
        } else {
          relationData[relationName] = relatedData;
        }
      }

      result.set(index, relationData);
    });

    return result;
  }

  /**
   * Attach joined relations to hydrated models.
   */
  private attachJoinedRelations(
    records: any[],
    joinedData: Map<number, Record<string, any>>,
  ): void {
    if (this.joinRelations.size === 0 || !this.relationDefinitions) return;

    records.forEach((model, index) => {
      const relationData = joinedData.get(index);
      if (!relationData) return;

      for (const [relationName, data] of Object.entries(relationData)) {
        if (data === null) {
          // No related record
          (model as any)[relationName] = null;
          if ((model as any).loadedRelations) {
            (model as any).loadedRelations.set(relationName, null);
          }
          continue;
        }

        const relationDef = this.relationDefinitions![relationName];
        if (!relationDef) continue;

        // Resolve and hydrate the related model
        const RelatedModel =
          typeof relationDef.model === "string"
            ? getModelFromRegistry(relationDef.model)
            : relationDef.model;

        if (RelatedModel) {
          const relatedInstance = new RelatedModel(data);
          relatedInstance.isNew = false;

          (model as any)[relationName] = relatedInstance;
          if ((model as any).loadedRelations) {
            (model as any).loadedRelations.set(relationName, relatedInstance);
          }
        }
      }
    });
  }

  /**
   * Get first result.
   */
  public async first<TResult = T>(): Promise<TResult | null> {
    const results = await this.limit(1).get<TResult>();
    return results[0] ?? null;
  }

  /**
   * Get last result.
   */
  public async last<TResult = T>(): Promise<TResult | null> {
    const results = await this.orderByDesc("id").limit(1).get<TResult>();
    return results[0] ?? null;
  }

  /**
   * Get random results.
   */
  public async random<TResult = T>(limit?: number): Promise<TResult[]> {
    this.orderByRaw("RANDOM()");
    if (limit) {
      this.limit(limit);
    }
    return this.get<TResult>();
  }

  /**
   * Get first or throw.
   */
  public async firstOrFail<TResult = T>(): Promise<TResult> {
    const result = await this.first<TResult>();
    if (!result) {
      throw new Error("No records found");
    }
    return result;
  }

  /**
   * Get first or call callback.
   */
  public async firstOr<TResult = T>(callback: () => TResult | Promise<TResult>): Promise<TResult> {
    const result = await this.first<TResult>();
    return result ?? (await callback());
  }

  /**
   * Get first or return default.
   */
  public async firstOrNull<TResult = T>(): Promise<TResult | null> {
    return this.first<TResult>();
  }

  /**
   * Get first or create new.
   */
  public async firstOrNew<TResult = T>(defaults: GenericObject): Promise<TResult> {
    const result = await this.first<TResult>();
    return result ?? (defaults as unknown as TResult);
  }

  /**
   * Find by ID.
   */
  public async find<TResult = T>(id: number | string): Promise<TResult | null> {
    return this.where("id", id).first<TResult>();
  }

  /**
   * Count results.
   */
  public async count(): Promise<number> {
    this.applyPendingScopes();

    // Build count query using selectRaw to avoid quoting COUNT(*) as a column
    const countOps: PostgresParserOperation[] = [
      ...this.operations.filter((op) => op.type.includes("where") || op.type.includes("join")),
      { type: "selectRaw", data: { expression: 'COUNT(*) AS "count"' } },
    ];

    const parser = new PostgresQueryParser({
      table: this.table,
      operations: countOps,
    });

    const { sql, params } = parser.parse();

    const result = await this.driver.query<{ count: string }>(sql, params);

    return parseInt(result.rows[0]?.count ?? "0", 10);
  }

  /**
   * Sum of field values.
   */
  public async sum(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`SUM(${field}) as sum`).first<{ sum: string }>();
    return parseFloat(result?.sum ?? "0");
  }

  /**
   * Average of field values.
   */
  public async avg(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`AVG(${field}) as avg`).first<{ avg: string }>();
    return parseFloat(result?.avg ?? "0");
  }

  /**
   * Minimum field value.
   */
  public async min(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`MIN(${field}) as min`).first<{ min: string }>();
    return parseFloat(result?.min ?? "0");
  }

  /**
   * Maximum field value.
   */
  public async max(field: string): Promise<number> {
    this.applyPendingScopes();
    const result = await this.selectRaw(`MAX(${field}) as max`).first<{ max: string }>();
    return parseFloat(result?.max ?? "0");
  }

  /**
   * Get distinct values.
   */
  public async distinct<TResult = unknown>(field: string): Promise<TResult[]> {
    this.distinctValues(field);
    const results = await this.get<{ [key: string]: TResult }>();
    return results.map((row) => row[field]);
  }

  /**
   * Get array of values for field.
   */
  public async pluck(field: string): Promise<unknown[]> {
    const results = await this.select([field]).get<Record<string, unknown>>();
    return results.map((row) => row[field]);
  }

  /**
   * Get single scalar value.
   */
  public async value<TResult = unknown>(field: string): Promise<TResult | null> {
    const result = await this.select([field]).first<Record<string, TResult>>();
    return result?.[field] ?? null;
  }

  /**
   * Check if records exist.
   */
  public async exists(): Promise<boolean> {
    const count = await this.limit(1).count();
    return count > 0;
  }

  /**
   * Check if no records exist.
   */
  public async notExists(): Promise<boolean> {
    return !(await this.exists());
  }

  /**
   * Count distinct values.
   */
  public async countDistinct(field: string): Promise<number> {
    const result = await this.selectRaw(`COUNT(DISTINCT ${field}) as count`).first<{
      count: string;
    }>();
    return parseInt(result?.count ?? "0", 10);
  }

  /**
   * Increment field value.
   */
  public async increment(field: string, amount = 1): Promise<number> {
    this.applyPendingScopes();
    const { sql, params } = this.buildFilter();
    const updateSql = `UPDATE ${this.driver.dialect.quoteIdentifier(this.table)} SET ${this.driver.dialect.quoteIdentifier(field)} = COALESCE(${this.driver.dialect.quoteIdentifier(field)}, 0) + $1 WHERE ${sql.replace("WHERE ", "")} RETURNING ${this.driver.dialect.quoteIdentifier(field)}`;
    const result = await this.driver.query<Record<string, number>>(updateSql, [amount, ...params]);
    return result.rows[0]?.[field] ?? 0;
  }

  /**
   * Decrement field value.
   */
  public async decrement(field: string, amount = 1): Promise<number> {
    return this.increment(field, -amount);
  }

  /**
   * Increment for all matching.
   */
  public async incrementMany(field: string, amount = 1): Promise<number> {
    this.applyPendingScopes();
    const { sql, params } = this.buildFilter();
    const updateSql = `UPDATE ${this.driver.dialect.quoteIdentifier(this.table)} SET ${this.driver.dialect.quoteIdentifier(field)} = COALESCE(${this.driver.dialect.quoteIdentifier(field)}, 0) + $1 WHERE ${sql.replace("WHERE ", "")}`;
    const result = await this.driver.query(updateSql, [amount, ...params]);
    return result.rowCount ?? 0;
  }

  /**
   * Decrement for all matching.
   */
  public async decrementMany(field: string, amount = 1): Promise<number> {
    return this.incrementMany(field, -amount);
  }

  // ============================================================================
  // CHUNKING / PAGINATION
  // ============================================================================

  /**
   * Process results in chunks.
   */
  public async chunk(size: number, callback: ChunkCallback<T>): Promise<void> {
    let chunkIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const chunk = await this.clone()
        .skip(chunkIndex * size)
        .limit(size)
        .get();

      if (chunk.length === 0) {
        break;
      }

      const shouldContinue = await callback(chunk, chunkIndex);

      if (shouldContinue === false) {
        break;
      }

      hasMore = chunk.length === size;
      chunkIndex++;
    }
  }

  /**
   * Page-based pagination.
   */
  public async paginate(options?: PaginationOptions): Promise<PaginationResult<T>> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.clone().skip(skip).limit(limit).get(),
      this.count(),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Cursor-based pagination.
   */
  public async cursorPaginate(
    options?: CursorPaginationOptions,
  ): Promise<CursorPaginationResult<T>> {
    const { limit = 10, cursor, column = "id", direction = "next" } = options ?? {};

    if (cursor) {
      const operator = direction === "next" ? ">" : "<";
      this.where(column, operator, cursor);
    }

    const sortOrder = direction === "next" ? "asc" : "desc";
    this.orderBy(column, sortOrder);

    const results = await this.limit(limit + 1).get();

    const hasMore = results.length > limit;
    let data = hasMore ? results.slice(0, limit) : results;

    if (direction === "prev") {
      data = data.reverse();
    }

    let nextCursor: unknown | undefined;
    let prevCursor: unknown | undefined;
    let hasPrev = false;

    if (data.length > 0) {
      const firstItem = (data[0] as Record<string, unknown>)[column];
      const lastItem = (data[data.length - 1] as Record<string, unknown>)[column];

      if (direction === "next") {
        nextCursor = hasMore ? lastItem : undefined;
        if (cursor) {
          hasPrev = true;
          prevCursor = firstItem;
        }
      } else {
        prevCursor = hasMore ? firstItem : undefined;
        hasPrev = hasMore;
        if (cursor) {
          nextCursor = lastItem;
        }
      }
    }

    return {
      data,
      pagination: {
        hasMore,
        hasPrev,
        nextCursor,
        prevCursor,
      },
    };
  }

  // ============================================================================
  // MUTATION METHODS
  // ============================================================================

  /**
   * Delete matching records.
   */
  public async delete(): Promise<number> {
    this.applyPendingScopes();
    const { sql, params } = this.buildFilter();
    const deleteSql = `DELETE FROM ${this.driver.dialect.quoteIdentifier(this.table)} ${sql}`;
    const result = await this.driver.query(deleteSql, params);
    return result.rowCount ?? 0;
  }

  /**
   * Delete first matching record.
   */
  public async deleteOne(): Promise<number> {
    return this.limit(1).delete();
  }

  /**
   * Update matching records.
   */
  public async update(fields: Record<string, unknown>): Promise<number> {
    this.applyPendingScopes();
    const result = await this.driver.updateMany(this.table, {}, { $set: fields });
    return result.modifiedCount;
  }

  /**
   * Unset fields from matching records.
   */
  public async unset(...fields: string[]): Promise<number> {
    this.applyPendingScopes();
    const updateObj: Record<string, 1> = {};
    for (const field of fields) {
      updateObj[field] = 1;
    }
    const result = await this.driver.updateMany(this.table, {}, { $unset: updateObj });
    return result.modifiedCount;
  }

  // ============================================================================
  // INSPECTION / DEBUGGING
  // ============================================================================

  /**
   * Get the raw SQL query.
   */
  public parse(): { sql: string; params: unknown[] } {
    this.applyPendingScopes();
    const parser = new PostgresQueryParser({
      table: this.table,
      operations: this.operations,
    });
    return parser.parse();
  }

  /**
   * Get formatted SQL string.
   */
  public pretty(): string {
    const { sql, params } = this.parse();
    return `${sql}\n-- Parameters: ${JSON.stringify(params)}`;
  }

  /**
   * Get query execution plan.
   */
  public async explain(): Promise<unknown> {
    const { sql, params } = this.parse();
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const result = await this.driver.query(explainSql, params);
    return result.rows;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Add driver-specific raw modifications to the query.
   */
  public raw(builder: (native: unknown) => unknown): this {
    // For PostgreSQL, the native object would be the operations array
    builder(this.operations);
    return this;
  }

  /**
   * Extend the query builder with driver-specific extensions.
   */
  public extend<R>(extension: string, ..._args: unknown[]): R {
    // PostgreSQL doesn't have driver-specific extensions like MongoDB
    // Return undefined as R for now - specific extensions can be added later
    throw new Error(`Extension "${extension}" is not supported by PostgresQueryBuilder`);
  }

  /**
   * Tap into the query builder for side-effects.
   */
  public tap(callback: (builder: this) => void): this {
    callback(this);
    return this;
  }

  /**
   * Conditionally apply query modifications.
   */
  public when<V>(
    condition: V | boolean,
    callback: (builder: this, value: V) => void,
    otherwise?: (builder: this) => void,
  ): this {
    if (condition) {
      callback(this, condition as V);
    } else if (otherwise) {
      otherwise(this);
    }
    return this;
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Build WHERE clause from current operations.
   */
  private buildFilter(): { sql: string; params: unknown[] } {
    const whereOps = this.operations.filter(
      (op) => op.type.includes("where") || op.type.includes("Where"),
    );

    if (whereOps.length === 0) {
      return { sql: "", params: [] };
    }

    const parser = new PostgresQueryParser({
      table: this.table,
      operations: whereOps,
    });

    const { sql, params } = parser.parse();
    const whereMatch = sql.match(/WHERE .+$/);
    return {
      sql: whereMatch ? whereMatch[0] : "",
      params,
    };
  }

  // ============================================================================
  // RELATIONS / EAGER LOADING (Stubs)
  // ============================================================================

  /**
   * Relations to eagerly load.
   */
  public eagerLoadRelations: Map<string, boolean | ((query: QueryBuilderContract) => void)> =
    new Map();

  /**
   * Relations to count.
   */
  public countRelations: string[] = [];

  /**
   * Relations to load via JOIN (single query).
   */
  public joinRelations: Map<string, { alias: string; type: "belongsTo" | "hasOne" | "hasMany" }> =
    new Map();

  /**
   * Relation definitions from the model.
   */
  public relationDefinitions?: Record<string, any>;

  /**
   * Model class reference.
   */
  public modelClass?: any;

  /**
   * Load relations using database JOINs in a single query.
   *
   * Unlike `with()` which uses separate queries, `joinWith()` uses
   * LEFT JOIN to fetch related data in a single query.
   *
   * @param relations - Relation names to load via JOIN
   * @returns This builder for chaining
   */
  public joinWith(...relations: string[]): this {
    for (const relation of relations) {
      const def = this.relationDefinitions?.[relation];
      if (def) {
        this.joinRelations.set(relation, {
          alias: `_rel_${relation}`,
          type: def.type,
        });
      }
    }
    return this;
  }

  /**
   * Eagerly load one or more relations.
   *
   * Supported patterns:
   * - `with("posts")` - Load relation
   * - `with("posts", "comments")` - Load multiple relations
   * - `with("posts", callback)` - Load relation with constraint
   * - `with({ posts: true, comments: callback })` - Object configuration
   *
   * @param args - Relation name(s), callbacks, or configuration object
   */
  public with(
    ...args: (
      | string
      | Record<string, boolean | ((query: QueryBuilderContract) => void)>
      | ((query: QueryBuilderContract) => void)
    )[]
  ): this {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (typeof arg === "string") {
        // Check if next argument is a callback for this relation
        const nextArg = args[i + 1];
        if (typeof nextArg === "function") {
          this.eagerLoadRelations.set(arg, nextArg);
          i++; // Skip the callback in next iteration
        } else {
          this.eagerLoadRelations.set(arg, true);
        }
      } else if (typeof arg === "object" && arg !== null) {
        for (const [key, value] of Object.entries(arg)) {
          this.eagerLoadRelations.set(key, value);
        }
      }
      // Functions not preceded by a string are ignored (invalid usage)
    }
    return this;
  }

  /**
   * Add a count of related models as a virtual field.
   * @param relations - Relation name(s) to count
   */
  public withCount(...relations: string[]): this {
    this.countRelations.push(...relations);
    return this;
  }

  /**
   * Filter results to only those that have related models.
   * @param relation - Relation name
   * @param operator - Optional comparison operator
   * @param count - Optional count to compare against
   */
  public has(relation: string, operator?: string, count?: number): this {
    // TODO: Implement has() using EXISTS subquery
    this.addOperation("has", { relation, operator, count });
    return this;
  }

  /**
   * Filter results that have related models matching specific conditions.
   * @param relation - Relation name
   * @param callback - Callback to define conditions
   */
  public whereHas(relation: string, callback: (query: QueryBuilderContract) => void): this {
    // TODO: Implement whereHas() using EXISTS subquery with conditions
    this.addOperation("whereHas", { relation, callback });
    return this;
  }

  /**
   * Filter results that don't have any related models.
   * @param relation - Relation name
   */
  public doesntHave(relation: string): this {
    // TODO: Implement doesntHave() using NOT EXISTS subquery
    this.addOperation("doesntHave", { relation });
    return this;
  }

  /**
   * Filter results that don't have related models matching specific conditions.
   * @param relation - Relation name
   * @param callback - Callback to define conditions
   */
  public whereDoesntHave(relation: string, callback: (query: QueryBuilderContract) => void): this {
    // TODO: Implement whereDoesntHave() using NOT EXISTS subquery with conditions
    this.addOperation("whereDoesntHave", { relation, callback });
    return this;
  }
}
