import { CursorPaginationOptions, CursorPaginationResult, DriverQuery, GroupByInput, HavingInput, JoinOptions, OrderDirection, PaginationOptions, PaginationResult, QueryBuilderContract, RawExpression, WhereCallback, WhereObject, WhereOperator } from "../../contracts/query-builder.contract.mjs";
import { DataSource } from "../../data-source/data-source.mjs";
import { Operation } from "./types.mjs";
import { QueryBuilder } from "../../query-builder/query-builder.mjs";
import { MongoQueryOperations } from "./mongodb-query-operations.mjs";
import { MongoQueryParser } from "./mongodb-query-parser.mjs";
import { GenericObject } from "@mongez/reinforcements";
import { Collection } from "mongodb";

//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-query-builder.d.ts
/**
 * MongoDB-specific query builder implementation using aggregation pipeline.
 */
declare class MongoQueryBuilder<T = unknown> extends QueryBuilder<T> implements QueryBuilderContract<T> {
  readonly table: string;
  /**
   * Ordered list of operations to be converted to MongoDB aggregation pipeline.
   * Public to allow parser access. Uses MongoDB's own Operation type.
   *
   * NOTE: This shadows the base `operations: Op[]` field intentionally — the Mongo
   * Operation type carries an extra `stage` discriminator used by the pipeline assembler.
   */
  operations: Operation[];
  /**
   * Data source instance
   */
  readonly dataSource: DataSource;
  /**
   * Lazy-loaded operations helper for constructing pipeline operations.
   */
  protected _operationsHelper?: MongoQueryOperations;
  hydrateCallback?: (data: any, index: number) => any;
  private fetchingCallback?;
  private hydratingCallback?;
  private fetchedCallback?;
  /**
   * Create a new query builder for the given collection.
   * @param collection - The MongoDB collection to query
   */
  constructor(table: string, dataSource?: DataSource);
  /**
   * Gets the operations helper instance, creating it if needed.
   * @returns The operations helper instance
   */
  protected get operationsHelper(): MongoQueryOperations;
  /**
   * Get collection instance
   */
  get collection(): Collection;
  /**
   * Add hydrate callback function
   */
  hydrate(callback: (data: any, index: number) => any): this;
  /**
   * Register a callback to be invoked before query execution
   * @returns Unsubscribe function to remove the callback
   */
  onFetching(callback: (query: this) => void | Promise<void>): () => void;
  /**
   * Register a callback to be invoked after records are fetched but before hydration
   * @returns Unsubscribe function to remove the callback
   */
  onHydrating(callback: (records: any[], context: any) => void | Promise<void>): () => void;
  /**
   * Register a callback to be invoked after records are fetched and hydrated
   * @returns Unsubscribe function to remove the callback
   */
  onFetched(callback: (records: any[], context: any) => void | Promise<void>): () => void;
  /**
   * Disable one or more global scopes for this query
   */
  withoutGlobalScope(...scopeNames: string[]): this;
  /**
   * Disable all global scopes for this query
   */
  withoutGlobalScopes(): this;
  /**
   * Apply a local scope to this query
   */
  scope(scopeName: string, ...args: any[]): this;
  /**
   * Apply pending global scopes before query execution
   */
  private applyPendingScopes;
  /**
   * Adds a WHERE clause to filter documents. Supports equality, operators, objects, or callbacks.
   * @param field - Field name, or conditions object, or callback
   * @param operator - Comparison operator
   * @param value - Value to compare
   */
  where(field: string, value: unknown): this;
  where(field: string, operator: WhereOperator, value: unknown): this;
  where(conditions: WhereObject): this;
  where(callback: WhereCallback<T>): this;
  /**
   * Adds an OR WHERE clause. Works like where() but uses OR logic.
   * @param field - Field name, or conditions object, or callback
   * @param operator - Comparison operator
   * @param value - Value to compare
   */
  orWhere(field: string, value: unknown): this;
  orWhere(field: string, operator: WhereOperator, value: unknown): this;
  orWhere(conditions: WhereObject): this;
  orWhere(callback: WhereCallback<T>): this;
  /**
   * Adds a raw WHERE clause using MongoDB's native query syntax.
   * @param expression - Raw MongoDB expression
   * @param bindings - Optional parameter bindings for string expressions
   */
  whereRaw(expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Adds a raw OR WHERE clause using MongoDB's native query syntax.
   * @param expression - Raw MongoDB expression
   * @param bindings - Optional parameter bindings
   */
  orWhereRaw(expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Adds a WHERE clause comparing two columns/fields directly.
   * @param first - The first field name
   * @param operator - The comparison operator
   * @param second - The second field name
   */
  whereColumn(first: string, operator: WhereOperator, second: string): this;
  /**
   * Adds an OR WHERE clause comparing two columns/fields directly.
   * @param first - The first field name
   * @param operator - The comparison operator
   * @param second - The second field name
   */
  orWhereColumn(first: string, operator: WhereOperator, second: string): this;
  /**
   * Adds multiple column comparison clauses at once.
   * @param comparisons - Array of tuples [leftField, operator, rightField]
   */
  whereColumns(comparisons: Array<[left: string, operator: WhereOperator, right: string]>): this;
  /**
   * Filters documents where a field's value falls between two other fields.
   * @param field - The field to check
   * @param lowerColumn - The field defining the lower bound
   * @param upperColumn - The field defining the upper bound
   */
  whereBetweenColumns(field: string, lowerColumn: string, upperColumn: string): this;
  /**
   * Filters documents where a date field matches the given date (ignoring time).
   * @param field - The date field name
   * @param value - The date to match
   */
  whereDate(field: string, value: Date | string): this;
  /**
   * Alias for `whereDate()`. Filters by exact date match (ignoring time).
   * @param field - The date field name
   * @param value - The date to match
   */
  whereDateEquals(field: string, value: Date | string): this;
  /**
   * Filters documents where a date field is before the given date.
   * @param field - The date field name
   * @param value - The cutoff date
   */
  whereDateBefore(field: string, value: Date | string): this;
  /**
   * Filters documents where a date field is after the given date.
   * @param field - The date field name
   * @param value - The cutoff date
   */
  whereDateAfter(field: string, value: Date | string): this;
  /**
   * Filters documents where a time field matches the given time (HH:MM:SS format).
   * @param field - The time/datetime field name
   * @param value - The time string in HH:MM:SS format
   */
  whereTime(field: string, value: string): this;
  /**
   * Filters documents where the day of the month matches the given value (1-31).
   * @param field - The date field name
   * @param value - The day of the month
   */
  whereDay(field: string, value: number): this;
  /**
   * Filters documents where the month matches the given value (1-12).
   * @param field - The date field name
   * @param value - The month number
   */
  whereMonth(field: string, value: number): this;
  /**
   * Filters documents where the year matches the given value.
   * @param field - The date field name
   * @param value - The year
   */
  whereYear(field: string, value: number): this;
  /**
   * Filters documents where a JSON field contains the specified value.
   * @param path - The JSON path to check
   * @param value - The value to search for
   */
  whereJsonContains(path: string, value: unknown): this;
  /**
   * Filters documents where a JSON field does NOT contain the specified value.
   * @param path - The JSON path to check
   * @param value - The value to exclude
   */
  whereJsonDoesntContain(path: string, value: unknown): this;
  /**
   * Filters documents where a JSON field contains a specific key.
   * @param path - The JSON path to check for key existence
   */
  whereJsonContainsKey(path: string): this;
  /**
   * Filters documents where a JSON array or string has a specific length.
   * @param path - The JSON path to check
   * @param operator - The comparison operator
   * @param value - The length value to compare against
   */
  whereJsonLength(path: string, operator: WhereOperator, value: number): this;
  /**
   * Filters documents where a JSON field is an array.
   * @param path - The JSON path to check
   */
  whereJsonIsArray(path: string): this;
  /**
   * Filters documents where a JSON field is an object.
   * @param path - The JSON path to check
   */
  whereJsonIsObject(path: string): this;
  /**
   * Filters documents where an array field has a specific length.
   * @param field - The array field name
   * @param operator - The comparison operator
   * @param value - The length value to compare against
   */
  whereArrayLength(field: string, operator: WhereOperator, value: number): this;
  /**
   * Filters documents by ID (convenience method for `where("id", value)`).
   * @param value - The ID value to match
   */
  whereId(value: string | number): this;
  /**
   * Filters documents by multiple IDs (convenience method for `whereIn("id", values)`).
   * @param values - Array of ID values to match
   */
  whereIds(values: Array<string | number>): this;
  /**
   * Filters documents by UUID (convenience method for `where("uuid", value)`).
   * @param value - The UUID string to match
   */
  whereUuid(value: string): this;
  /**
   * Filters documents by ULID (convenience method for `where("ulid", value)`).
   * @param value - The ULID string to match
   */
  whereUlid(value: string): this;
  /**
   * Performs full-text search on one or more fields.
   * @param fields - Field name or array of field names to search
   * @param query - The search query string
   */
  whereFullText(fields: string | string[], query: string): this;
  /**
   * Performs full-text search with OR logic.
   * @param fields - Field name or array of field names to search
   * @param query - The search query string
   */
  orWhereFullText(fields: string | string[], query: string): this;
  /**
   * Alias for `whereFullText()` with a single field.
   * @param field - The field name to search
   * @param query - The search query string
   */
  whereSearch(field: string, query: string): this;
  /**
   * Negates a set of conditions using a callback.
   * @param callback - Callback function defining conditions to negate
   */
  whereNot(callback: WhereCallback<T>): this;
  /**
   * Negates a set of conditions with OR logic.
   * @param callback - Callback function defining conditions to negate
   */
  orWhereNot(callback: WhereCallback<T>): this;
  /**
   * Filters documents where a field's value matches any value in the given array.
   * @param field - The field name to check
   * @param values - Array of values to match against
   */
  whereIn(field: string, values: unknown[]): this;
  /**
   * Filters documents where a field's value does NOT match any value in the array.
   * @param field - The field name to check
   * @param values - Array of values to exclude
   */
  whereNotIn(field: string, values: unknown[]): this;
  /**
   * Filters documents where a field's value is null or undefined.
   * @param field - The field name to check
   */
  whereNull(field: string): this;
  /**
   * Filters documents where a field's value is NOT null or undefined.
   * @param field - The field name to check
   */
  whereNotNull(field: string): this;
  /**
   * Filters documents where a field's value falls within the given range (inclusive).
   * @param field - The field name to check
   * @param range - Tuple of [min, max] values
   */
  whereBetween(field: string, range: [unknown, unknown]): this;
  /**
   * Filters documents where a field's value is NOT within the given range.
   * @param field - The field name to check
   * @param range - Tuple of [min, max] values to exclude
   */
  whereNotBetween(field: string, range: [unknown, unknown]): this;
  /**
   * Filters documents where a field matches the given pattern (case-insensitive).
   * @param field - The field name to search
   * @param pattern - The pattern to match
   */
  whereLike(field: string, pattern: RegExp | string): this;
  /**
   * Filters documents where a field does NOT match the given pattern.
   * @param field - The field name to search
   * @param pattern - The pattern to exclude
   */
  whereNotLike(field: string, pattern: RegExp | string): this;
  /**
   * Filters documents where a field's value starts with the given prefix.
   * @param field - The field name to check
   * @param value - The prefix to match
   */
  whereStartsWith(field: string, value: string | number): this;
  /**
   * Filters documents where a field's value does NOT start with the given prefix.
   * @param field - The field name to check
   * @param value - The prefix to exclude
   */
  whereNotStartsWith(field: string, value: string | number): this;
  /**
   * Filters documents where a field's value ends with the given suffix.
   * @param field - The field name to check
   * @param value - The suffix to match
   */
  whereEndsWith(field: string, value: string | number): this;
  /**
   * Filters documents where a field's value does NOT end with the given suffix.
   * @param field - The field name to check
   * @param value - The suffix to exclude
   */
  whereNotEndsWith(field: string, value: string | number): this;
  /**
   * Filters documents where a date field falls within the given date range.
   * @param field - The date field name
   * @param range - Tuple of [startDate, endDate]
   */
  whereDateBetween(field: string, range: [Date, Date]): this;
  /**
   * Filters documents where a date field is NOT within the given date range.
   * @param field - The date field name
   * @param range - Tuple of [startDate, endDate] to exclude
   */
  whereDateNotBetween(field: string, range: [Date, Date]): this;
  /**
   * Filters documents where a field exists (has any value including null).
   * @param field - The field name to check for existence
   * @param callback - Optional callback for subquery existence
   */
  whereExists(field: string): this;
  whereExists(callback: WhereCallback<T>): this;
  /**
   * Filters documents where a field does NOT exist in the document.
   * @param field - The field name to check for absence
   * @param callback - Optional callback for subquery non-existence
   */
  whereNotExists(field: string): this;
  whereNotExists(callback: WhereCallback<T>): this;
  /**
   * Filters documents where an array field has a specific size.
   * @param field - The array field name
   * @param size - The exact size to match
   * @param operator - Optional comparison operator
   */
  whereSize(field: string, size: number): this;
  whereSize(field: string, operator: ">" | ">=" | "=" | "<" | "<=", size: number): this;
  /**
   * Performs a full-text search on the specified fields.
   * @param query - The search query string
   * @param filters - Optional additional filter conditions
   */
  textSearch(query: string, filters?: WhereObject): this;
  /**
   * Filters documents where an array field contains the given value.
   * @param field - The array field name
   * @param value - The value to search for in the array
   * @param key - Optional key to check within array objects
   */
  whereArrayContains(field: string, value: unknown, key?: string): this;
  /**
   * Filters documents where an array field does NOT contain the given value.
   * @param field - The array field name
   * @param value - The value to exclude from the array
   * @param key - Optional key to check within array objects
   */
  whereArrayNotContains(field: string, value: unknown, key?: string): this;
  /**
   * Filters documents where an array field contains the value OR is empty.
   * @param field - The array field name
   * @param value - The value to search for
   * @param key - Optional key to check within array objects
   */
  whereArrayHasOrEmpty(field: string, value: unknown, key?: string): this;
  /**
   * Filters documents where an array field does NOT contain the value AND is not empty.
   * @param field - The array field name
   * @param value - The value to exclude
   * @param key - Optional key to check within array objects
   */
  whereArrayNotHaveOrEmpty(field: string, value: unknown, key?: string): this;
  /**
   * Internal helper for processing where clause arguments.
   * @param prefix - The operation prefix
   * @param args - The arguments passed to where/orWhere
   */
  protected addWhereClause(prefix: "where" | "orWhere", args: any[]): void;
  /**
   * Internal helper for adding raw where clauses.
   * @param type - The operation type
   * @param expression - The raw expression in MongoDB query language
   * @param bindings - Optional bindings for the expression
   */
  protected addRawWhere(type: "whereRaw" | "orWhereRaw", expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Normalizes select field arguments into a structured format.
   * @param args - The arguments to normalize
   * @returns Normalized selection object with fields and aliases
   */
  protected normalizeSelectFields(args: any[]): {
    fields?: string[];
    projection?: Record<string, unknown>;
  };
  /**
   * Specifies which fields to include in the query results.
   * Supports arrays, multiple args, or object with aliases/inclusion/exclusion.
   * @param fields - Field names, array, or projection object
   */
  select(fields: string[]): this;
  select(fields: Record<string, 0 | 1 | boolean | string>): this;
  select(...fields: string[]): this;
  /**
   * Selects a field with an alias.
   * @param field - The field to select
   * @param alias - The alias name for the field
   * @returns The query builder instance
   */
  selectAs(field: string, alias: string): this;
  /**
   * Adds a computed field using a raw MongoDB expression.
   * @param expression - The raw MongoDB expression
   * @param bindings - Optional parameter bindings for string expressions
   */
  selectRaw(expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Adds multiple computed fields using raw MongoDB expressions.
   * @param definitions - Array of field definitions with alias, expression, and optional bindings
   */
  selectRawMany(definitions: Array<{
    alias: string;
    expression: RawExpression;
    bindings?: unknown[];
  }>): this;
  /**
   * Adds a subquery as a computed field.
   * @param expression - The subquery expression
   * @param alias - The alias for the computed field
   */
  selectSub(expression: RawExpression, alias: string): this;
  /**
   * Adds an additional subquery field to existing selections.
   * @param expression - The subquery expression
   * @param alias - The alias for the computed field
   */
  addSelectSub(expression: RawExpression, alias: string): this;
  /**
   * Adds an aggregate value as a computed field.
   * @param field - The field to aggregate
   * @param aggregate - The aggregate function to apply
   * @param alias - The alias for the computed field
   */
  selectAggregate(field: string, aggregate: "sum" | "avg" | "min" | "max" | "count" | "first" | "last", alias: string): this;
  /**
   * Adds a boolean field indicating whether a related document exists.
   * @param field - The field to check for existence
   * @param alias - The alias for the boolean field
   */
  selectExists(field: string, alias: string): this;
  /**
   * Adds a count field for a related collection.
   * @param field - The field to count
   * @param alias - The alias for the count field
   */
  selectCount(field: string, alias: string): this;
  /**
   * Adds a CASE-like conditional field using multiple conditions.
   * @param cases - Array of when/then pairs
   * @param otherwise - Default value if no conditions match
   * @param alias - The alias for the computed field
   */
  selectCase(cases: Array<{
    when: RawExpression;
    then: RawExpression | unknown;
  }>, otherwise: RawExpression | unknown, alias: string): this;
  /**
   * Adds a simple conditional field (if/else).
   * @param condition - The condition to evaluate
   * @param thenValue - Value if condition is true
   * @param elseValue - Value if condition is false
   * @param alias - The alias for the computed field
   */
  selectWhen(condition: RawExpression, thenValue: RawExpression | unknown, elseValue: RawExpression | unknown, alias: string): this;
  /**
   * Allows direct manipulation of the MongoDB projection object.
   * @param callback - Function that receives and modifies the projection object
   */
  selectDriverProjection(callback: (projection: Record<string, unknown>) => void): this;
  /**
   * Extracts a JSON field from a document.
   * @param path - The JSON path to extract
   * @param alias - Optional alias for the extracted field
   */
  selectJson(path: string, alias?: string): this;
  /**
   * Extracts a JSON field using a raw MongoDB expression.
   * @param path - The JSON path
   * @param expression - The raw expression for extraction
   * @param alias - The alias for the extracted field
   */
  selectJsonRaw(path: string, expression: RawExpression, alias: string): this;
  /**
   * Excludes a JSON path from the results.
   * @param path - The JSON path to exclude
   */
  deselectJson(path: string): this;
  /**
   * Concatenates multiple fields into a single string field.
   * @param fields - Array of fields or expressions to concatenate
   * @param alias - The alias for the concatenated field
   */
  selectConcat(fields: Array<string | RawExpression>, alias: string): this;
  /**
   * Returns the first non-null value from a list of fields.
   * @param fields - Array of fields to check
   * @param alias - The alias for the coalesced field
   */
  selectCoalesce(fields: Array<string | RawExpression>, alias: string): this;
  /**
   * Adds window function operations to the query.
   * @param spec - The window function specification
   */
  selectWindow(spec: RawExpression): this;
  /**
   * Excludes specific fields from the query results.
   * @param fields - Field names to exclude
   */
  deselect(fields: string[]): this;
  deselect(...fields: Array<string | string[]>): this;
  /**
   * Returns only distinct values for the specified fields.
   * @param fields - Optional field names to use for distinctness
   */
  distinctValues(fields?: string | string[]): this;
  /**
   * Adds additional fields to an existing selection.
   * @param fields - Additional field names to include
   */
  addSelect(fields: string[]): this;
  addSelect(...fields: Array<string | string[]>): this;
  /**
   * Removes all field selection restrictions.
   */
  clearSelect(): this;
  /**
   * Alias for `clearSelect()`. Removes all field restrictions.
   */
  selectAll(): this;
  /**
   * Alias for `clearSelect()`. Resets to default field selection.
   */
  selectDefault(): this;
  /**
   * Orders the query results by a specific field or multiple fields.
   *
   * @param field - The field name to sort by, or an object with multiple fields
   * @param direction - The sort direction (only used when field is a string)
   *
   * @example
   * ```typescript
   * // Single field
   * query.orderBy("createdAt", "desc");
   *
   * // Multiple fields
   * query.orderBy({ id: "asc", age: "desc", createdAt: "desc" });
   * ```
   */
  orderBy(field: string, direction?: OrderDirection): this;
  orderBy(fields: Record<string, OrderDirection>): this;
  /**
   * Orders the query results by a field in descending order.
   * @param field - The field name to sort by
   */
  orderByDesc(field: string): this;
  /**
   * Orders the query results using a raw MongoDB sort expression.
   * @param expression - The raw MongoDB sort expression
   * @param bindings - Optional parameter bindings
   */
  orderByRaw(expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Orders the query results randomly.
   */
  orderByRandom(limit?: number): this;
  /**
   * Orders results by a date field in descending order (newest first).
   * @param column - The date column to sort by
   */
  latest(column?: string): Promise<T[]>;
  /**
   * Orders results by a date field in ascending order (oldest first).
   * @param column - The date column to sort by
   */
  oldest(column?: string): this;
  /**
   * Limits the number of documents returned by the query.
   * @param value - The maximum number of documents to return
   */
  limit(value: number): this;
  /**
   * Skips a specified number of documents in the query results.
   * @param value - The number of documents to skip
   */
  skip(value: number): this;
  /**
   * Alias for `skip()`. Skips a specified number of documents.
   * @param value - The number of documents to skip
   */
  offset(value: number): this;
  /**
   * Alias for `limit()`. Limits the number of documents returned.
   * @param value - The maximum number of documents to return
   */
  take(value: number): this;
  /**
   * Applies cursor-based filtering for pagination.
   * @param after - Cursor value for forward pagination
   * @param before - Cursor value for backward pagination
   */
  cursor(after?: unknown, before?: unknown): this;
  /**
   * Groups documents by one or more fields.
   *
   * @param fields - Field(s) to group by
   * @param aggregates - Optional aggregate operations to perform
   *
   * @example
   * ```typescript
   * import { $agg } from '@warlock.js/cascade';
   *
   * // Simple grouping
   * query.groupBy("type");
   *
   * // Grouping with aggregates
   * query.groupBy("type", {
   *   count: $agg.count(),
   *   total: $agg.sum("duration")
   * });
   * ```
   */
  groupBy(fields: GroupByInput): this;
  groupBy(fields: GroupByInput, aggregates: Record<string, RawExpression>): this;
  /**
   * Groups documents using a raw MongoDB expression.
   * @param expression - The raw grouping expression
   * @param bindings - Optional parameter bindings
   */
  groupByRaw(expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Filters grouped results based on aggregate conditions.
   * @param field - The aggregate field to filter on
   * @param value - The value to compare against
   * @param operator - The comparison operator
   * @param condition - A condition object for complex filters
   */
  having(field: string, value: unknown): this;
  having(field: string, operator: WhereOperator, value: unknown): this;
  having(condition: HavingInput): this;
  /**
   * Filters grouped results using a raw MongoDB expression.
   * @param expression - The raw having expression
   * @param bindings - Optional parameter bindings
   */
  havingRaw(expression: RawExpression, bindings?: unknown[]): this;
  /**
   * Performs a join with another collection using MongoDB's $lookup.
   *
   * @param table - Target collection name
   * @param localField - Field from the input documents
   * @param foreignField - Field from the documents of the "from" collection
   */
  join(table: string, localField: string, foreignField: string): this;
  /**
   * Performs a join with another collection using MongoDB's $lookup.
   *
   * @param options - Join configuration including table, fields, and optional pipeline
   */
  join(options: JoinOptions): this;
  /**
   * Performs a left outer join with another collection.
   * In MongoDB, this is the standard $lookup behavior.
   *
   * @param table - Target collection name
   * @param localField - Field from the input documents
   * @param foreignField - Field from the documents of the "from" collection
   */
  leftJoin(table: string, localField: string, foreignField: string): this;
  /**
   * Performs a left outer join with another collection.
   *
   * @param options - Join configuration
   */
  leftJoin(options: JoinOptions): this;
  /**
   * Performs a right outer join with another collection.
   *
   * Note: MongoDB doesn't natively support right joins. This is implemented
   * as a regular left join with a warning. For true right join semantics,
   * consider reversing the collections in your query.
   *
   * @param table - Target collection name
   * @param localField - Field from the input documents
   * @param foreignField - Field from the documents of the "from" collection
   */
  rightJoin(table: string, localField: string, foreignField: string): this;
  /**
   * Performs a right outer join with another collection.
   *
   * @param options - Join configuration
   */
  rightJoin(options: JoinOptions): this;
  /**
   * Performs an inner join with another collection.
   *
   * This adds a $lookup followed by a $match to filter out documents
   * where the joined array is empty.
   *
   * @param table - Target collection name
   * @param localField - Field from the input documents
   * @param foreignField - Field from the documents of the "from" collection
   */
  innerJoin(table: string, localField: string, foreignField: string): this;
  /**
   * Performs an inner join with another collection.
   *
   * @param options - Join configuration
   */
  innerJoin(options: JoinOptions): this;
  /**
   * Performs a full outer join with another collection.
   *
   * Note: MongoDB doesn't natively support full outer joins. This is implemented
   * as a regular left join. For true full outer join semantics, you would need
   * to use $unionWith and additional aggregation logic.
   *
   * @param table - Target collection name
   * @param localField - Field from the input documents
   * @param foreignField - Field from the documents of the "from" collection
   */
  fullJoin(table: string, localField: string, foreignField: string): this;
  /**
   * Performs a full outer join with another collection.
   *
   * @param options - Join configuration
   */
  fullJoin(options: JoinOptions): this;
  /**
   * Performs a cross join with another collection.
   *
   * This creates a cartesian product by using $lookup with empty matching criteria.
   *
   * @param table - Target collection name
   */
  crossJoin(table: string): this;
  /**
   * Performs a raw join using a custom aggregation pipeline.
   *
   * This allows full control over the $lookup stage for complex join scenarios.
   *
   * @param expression - Raw expression (typically a $lookup stage or pipeline)
   * @param _bindings - Optional bindings (not used in MongoDB but kept for API consistency)
   */
  joinRaw(expression: RawExpression, _bindings?: unknown[]): this;
  /**
   * Allows direct manipulation of the native MongoDB query.
   * @param builder - Function that receives and modifies the native query
   */
  raw(builder: (native: unknown) => unknown): this;
  /**
   * Extends the query builder with driver-specific functionality.
   * @param extension - The extension name
   * @param _args - Extension-specific arguments
   * @returns The extension's return value
   */
  extend<R>(extension: string, ..._args: unknown[]): R;
  /**
   * Creates a deep copy of the query builder.
   * @returns A new query builder instance with copied operations
   */
  clone(): this;
  /**
   * Executes a callback with the query builder without breaking the chain.
   * @param callback - Function to execute with the builder
   */
  tap(callback: (builder: this) => void): this;
  /**
   * Conditionally applies query modifications based on a condition.
   * @param condition - The condition to evaluate
   * @param callback - Function to execute if condition is true
   * @param otherwise - Optional function to execute if condition is false
   *
   * @example
   * query.when(searchTerm, (q, term) => q.whereLike('name', term))
   */
  when<V>(condition: V | boolean, callback: (builder: this, value: V) => void, otherwise?: (builder: this) => void): this;
  /**
   * Executes the query and returns all matching documents.
   * @returns an array of matching documents
   */
  get<Output = T>(): Promise<Output[]>;
  /**
   * Execute the query and get first result
   * This is different than `first` as first adds a `limit = 1` to the pipeline
   */
  getFirst<Output = T>(): Promise<Output | null>;
  /**
   * Executes the query and returns the first matching document.
   * @returns the first document or null
   */
  first<Output = T>(): Promise<Output | null>;
  /**
   * Executes the query and returns the first matching document, throwing if none found.
   * @returns the first document
   */
  firstOrFail<Output = T>(): Promise<Output>;
  /**
   * Find a document by its primary key (id field).
   */
  find<Output = T>(id: number | string): Promise<Output | null>;
  /**
   * Configures the query to retrieve the last matching document.
   */
  last<Output = T>(field?: string): Promise<Output | null>;
  /**
   * Counts the number of documents matching the query.
   * @returns the count of matching documents
   */
  count(): Promise<number>;
  /**
   * Calculates the sum of a numeric field across matching documents.
   * @param field - The numeric field to sum
   * @returns the sum value
   */
  sum(field: string): Promise<number>;
  /**
   * Calculates the average value of a numeric field across matching documents.
   * @param field - The numeric field to average
   * @returns the average value
   */
  avg(field: string): Promise<number>;
  /**
   * Finds the minimum value of a field across matching documents.
   * @param field - The field to find the minimum of
   * @returns the minimum value
   */
  min(field: string): Promise<number>;
  /**
   * Finds the maximum value of a field across matching documents.
   * @param field - The field to find the maximum of
   * @returns the maximum value
   */
  max(field: string): Promise<number>;
  /**
   * Returns an array of distinct values for a field, respecting query filters.
   * @param field - The field to get distinct values from
   * @returns an array of distinct values
   */
  distinct<T = unknown>(field: string, ignoreNull?: boolean): Promise<T[]>;
  /**
   * Count distinct values for a field, respecting query filters.
   * @param field - The field to count distinct values for
   * @returns the count of distinct values
   */
  countDistinct(field: string, ignoreNull?: boolean): Promise<number>;
  /**
   * Extracts a single field value from each matching document.
   * @param field - The field to extract
   * @returns an array of field values
   */
  pluck<T = unknown>(field: string): Promise<T[]>;
  /**
   * Gets the value of a single field from the first matching document.
   * @param field - The field to extract
   * @returns the field value or null
   */
  value<T = unknown>(field: string): Promise<T | null>;
  /**
   * Checks if any documents match the query.
   * @param filter - Optional filter to apply to the query
   * @returns true if documents exist, false otherwise
   */
  exists(filter?: GenericObject): Promise<boolean>;
  /**
   * Checks if no documents match the query.
   * @param filter - Optional filter to apply to the query
   * @returns true if no documents exist, false otherwise
   */
  notExists(filter?: GenericObject): Promise<boolean>;
  /**
   * Increments a numeric field by the specified amount for first matching document.
   * @param field - The field to increment
   * @param amount - The amount to increment by (default: 1)
   * @returns the new value
   */
  increment(field: string, amount?: number): Promise<number>;
  /**
   * Decrements a numeric field by the specified amount.
   * @param field - The field to decrement
   * @param amount - The amount to decrement by
   * @returns the new value
   */
  decrement(field: string, amount?: number): Promise<number>;
  /**
   * Increments a numeric field by the specified amount for all matching documents.
   * @param field - The field to increment
   * @param amount - The amount to increment by (default: 1)
   * @returns the number of documents modified
   */
  incrementMany(field: string, amount?: number): Promise<number>;
  /**
   * Decrements a numeric field by the specified amount for all matching documents.
   * @param field - The field to decrement
   * @param amount - The amount to decrement by (default: 1)
   * @returns the number of documents modified
   */
  decrementMany(field: string, amount?: number): Promise<number>;
  /**
   * Delete all documents matching the query.
   */
  delete(): Promise<number>;
  /**
   * Delete a single document matching the query.
   */
  deleteOne(): Promise<number>;
  /**
   * Update the given fields for all documents matching the query.
   */
  update(fields: Record<string, unknown>): Promise<number>;
  /**
   * Unset the given fields from all documents matching the query.
   */
  unset(...fields: string[]): Promise<number>;
  /**
   * Processes query results in chunks, executing a callback for each chunk.
   * @param size - The number of documents per chunk
   * @param callback - Function to execute for each chunk
   * @returns void
   */
  chunk(size: number, callback: (rows: T[], chunkIndex: number) => Promise<boolean | void> | boolean | void): Promise<void>;
  /**
   * Executes the query with traditional page-based pagination.
   * @param options - Pagination options
   * @returns pagination result with data and metadata
   */
  paginate(options?: PaginationOptions): Promise<PaginationResult<T>>;
  /**
   * Executes the query with cursor-based pagination supporting both directions.
   * @param options - Cursor pagination options
   * @returns cursor pagination result with data and cursor info
   */
  cursorPaginate(options?: CursorPaginationOptions): Promise<CursorPaginationResult<T>>;
  /**
   * Returns the MongoDB aggregation pipeline that will be executed.
   */
  parse(): DriverQuery;
  /**
   * Returns a formatted string representation of the query pipeline.
   * @returns A formatted string representation of the pipeline
   */
  pretty(): string;
  /**
   * Returns the MongoDB query execution plan.
   * @returns MongoDB's explain output
   */
  explain(): Promise<unknown>;
  /**
   * Get query parser instance
   */
  protected getParser(): MongoQueryParser;
  /**
   * Build the MongoDB aggregation pipeline from the operations list.
   * @returns The MongoDB aggregation pipeline
   */
  protected buildPipeline(): any[];
  /**
   * Build a MongoDB filter object from the query's where clauses.
   * Used for update operations like increment/decrement.
   * @returns The MongoDB filter object
   */
  protected buildFilter(): Record<string, unknown>;
  /**
   * Execute the aggregate command
   */
  protected execute<T extends any = any>(pipeline?: any[]): Promise<T[]>;
  /**
   * Relations to eagerly load.
   */
  eagerLoadRelations: Map<string, boolean | ((query: QueryBuilderContract) => void)>;
  /**
   * Relations to load via $lookup (single query).
   */
  joinRelations: Map<string, {
    alias: string;
    type: "belongsTo" | "hasOne" | "hasMany";
  }>;
  /**
   * Relation definitions from the model.
   */
  relationDefinitions?: Record<string, any>;
  /**
   * Model class reference.
   */
  modelClass?: any;
  /**
   * Load relations using MongoDB $lookup in a single aggregation query.
   *
   * Unlike `with()` which uses separate queries, `joinWith()` uses
   * $lookup to fetch related data in a single aggregation pipeline.
   *
   * @param relations - Relation names to load via $lookup
   * @returns This builder for chaining
   */
  joinWith(...relations: string[]): this;
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
  with(...args: (string | Record<string, boolean | ((query: QueryBuilderContract) => void)> | ((query: QueryBuilderContract) => void))[]): this;
  /**
   * Filter results to only those that have related models.
   * @param relation - Relation name
   * @param operator - Optional comparison operator
   * @param count - Optional count to compare against
   */
  has(relation: string, operator?: string, count?: number): this;
  /**
   * Filter results that have related models matching specific conditions.
   * @param relation - Relation name
   * @param callback - Callback to define conditions
   */
  whereHas(relation: string, callback: (query: QueryBuilderContract) => void): this;
  /**
   * Filter results that don't have any related models.
   * @param relation - Relation name
   */
  doesntHave(relation: string): this;
  /**
   * Filter results that don't have related models matching specific conditions.
   * @param relation - Relation name
   * @param callback - Callback to define conditions
   */
  whereDoesntHave(relation: string, callback: (query: QueryBuilderContract) => void): this;
  /**
   * Nearest-neighbour vector similarity search via MongoDB Atlas $vectorSearch.
   *
   * Adds two pipeline stages:
   * 1. `$vectorSearch` — runs the ANN search using the Atlas vector index.
   *    Must be the first stage in the pipeline. Limit is embedded here.
   * 2. `$addFields` — exposes `{ $meta: "vectorSearchScore" }` under `alias`
   *    so callers can filter by minimum score after `.get()`.
   *
   * **Prerequisites:**
   * - MongoDB Atlas cluster (local/Community MongoDB does NOT support $vectorSearch)
   * - A vector search index on the collection, e.g.:
   *   `{ "fields": [{ "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" }] }`
   * - The index name convention used here is `"${column}_index"` (override via `alias` if needed).
   *
   * @param column    - Vector column name (e.g. `"embedding"`)
   * @param embedding - Query embedding as a plain number array
   * @param alias     - Score alias added to each result row (default: `"score"`)
   *
   * @example
   * ```typescript
   * const results = await Vector.query()
   *   .where({ organization_id: "org-123" })
   *   .similarTo("embedding", queryEmbedding)
   *   .limit(5)
   *   .get<VectorRow & { score: number }>();
   * ```
   */
  similarTo(column: string, embedding: number[], alias?: string): this;
}
//#endregion
export { MongoQueryBuilder };
//# sourceMappingURL=mongodb-query-builder.d.mts.map