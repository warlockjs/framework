import { DriverQuery } from "../../contracts/query-builder.contract.mjs";
import { SqlDialectContract } from "../sql/sql-dialect.contract.mjs";

//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-query-parser.d.ts
/**
 * Operation types supported by the query parser.
 */
type PostgresOperationType = "where" | "orWhere" | "whereRaw" | "orWhereRaw" | "whereIn" | "whereNotIn" | "whereNull" | "whereNotNull" | "whereBetween" | "whereNotBetween" | "whereLike" | "whereNotLike" | "whereColumn" | "orWhereColumn" | "whereExists" | "whereNotExists" | "whereDate" | "whereDateBefore" | "whereDateAfter" | "whereDateBetween" | "whereJsonContains" | "whereJsonDoesntContain" | "whereFullText" | "select" | "selectRaw" | "deselect" | "join" | "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin" | "crossJoin" | "joinRaw" | "orderBy" | "orderByRaw" | "groupBy" | "having" | "havingRaw" | "limit" | "offset" | "has" | "whereHas" | "doesntHave" | "whereDoesntHave" | "selectRelatedColumns" | "distinct";
/**
 * Internal operation representation.
 */
type PostgresParserOperation = {
  /** Operation type */readonly type: PostgresOperationType; /** Operation data/parameters */
  readonly data: Record<string, unknown>;
};
/**
 * Parser configuration options.
 */
type PostgresParserOptions = {
  /** Target table name */readonly table: string; /** Table alias (optional) */
  readonly alias?: string; /** Operations to parse */
  readonly operations: PostgresParserOperation[]; /** SQL dialect for syntax generation */
  readonly dialect?: SqlDialectContract; /** Factory for creating sub-parsers (for nested queries) */
  readonly createSubParser?: (table: string) => PostgresQueryParser;
};
/**
 * PostgreSQL Query Parser.
 *
 * Converts a list of query operations into a SQL query string with parameters.
 * Handles SELECT, WHERE, JOIN, ORDER BY, GROUP BY, LIMIT/OFFSET clauses.
 *
 * @example
 * ```typescript
 * const parser = new PostgresQueryParser({
 *   table: 'users',
 *   operations: [
 *     { type: 'where', data: { field: 'name', operator: '=', value: 'Alice' } },
 *     { type: 'orderBy', data: { field: 'createdAt', direction: 'desc' } },
 *     { type: 'limit', data: { value: 10 } }
 *   ]
 * });
 *
 * const { sql, params } = parser.parse();
 * // sql: 'SELECT * FROM "users" WHERE "name" = $1 ORDER BY "createdAt" DESC LIMIT 10'
 * // params: ['Alice']
 * ```
 */
declare class PostgresQueryParser {
  /**
   * Target table name.
   */
  private readonly table;
  /**
   * Table alias.
   */
  private readonly alias?;
  /**
   * Operations to process.
   */
  private readonly operations;
  /**
   * SQL dialect for syntax.
   */
  private readonly dialect;
  /**
   * Current parameter index (1-based for PostgreSQL).
   */
  private paramIndex;
  /**
   * Collected parameters.
   */
  private readonly params;
  /**
   * SELECT columns.
   */
  selectColumns: string[];
  /**
   * Deselected (excluded) columns.
   */
  private deselectColumns;
  /**
   * Raw SELECT expressions.
   */
  private selectRaw;
  /**
   * WHERE clauses.
   */
  whereClauses: string[];
  /**
   * JOIN clauses.
   */
  private joinClauses;
  /**
   * ORDER BY clauses.
   */
  orderClauses: string[];
  /**
   * GROUP BY columns.
   */
  private groupColumns;
  /**
   * HAVING clauses.
   */
  private havingClauses;
  /**
   * LIMIT value.
   */
  limitValue?: number;
  /**
   * OFFSET value.
   */
  offsetValue?: number;
  /**
   * DISTINCT flag.
   */
  private isDistinct;
  /**
   * Whether the query has any JOIN operations (pre-scanned before processing).
   * Used by qualifyColumn() to decide whether to prefix columns with the main table.
   */
  private hasJoins;
  /**
   * Tracked joined tables (for table reference detection).
   */
  private readonly joinedTables;
  /**
   * Create a new query parser.
   *
   * @param options - Parser configuration
   */
  constructor(options: PostgresParserOptions);
  /**
   * Parse all operations and build the SQL query.
   *
   * @returns DriverQuery with `query` (SQL string) and `bindings` (parameter values)
   */
  parse(): DriverQuery;
  /**
   * Get a formatted string representation of the query.
   *
   * @returns Formatted SQL with bindings
   */
  toPrettyString(): string;
  /**
   * Process a single operation.
   *
   * @param operation - The operation to process
   */
  private processOperation;
  /**
   * Build the final SQL query from collected clauses.
   *
   * @returns Complete SQL query string
   */
  private buildSql;
  /**
   * Build the SELECT clause.
   *
   * @returns SELECT clause string
   */
  private buildSelectClause;
  /**
   * Add a placeholder and parameter.
   *
   * @param value - Parameter value
   * @returns Placeholder string ($1, $2, etc.)
   */
  private addParam;
  /**
   * Absorb a sub-parser's params into this parser, returning a rewriter
   * function that translates the sub-parser's `$N` placeholders into freshly
   * numbered placeholders in this parser's namespace.
   *
   * Required whenever sub-parser SQL fragments (e.g. WHERE clauses produced
   * for a `joinWith` constraint) are spliced into the outer query — without
   * the rewrite the embedded `$N` references point at parameters this
   * parser has no knowledge of, leaving them dangling in the final SQL.
   *
   * The sub-parser's `params[i]` corresponds to its `$(i+1)` placeholder
   * (its `paramIndex` always starts at 1), so we map sequentially.
   *
   * @example
   *   const renumber = this.absorbSubParserParams(subParser);
   *   const fragment = renumber(subParser.whereClauses.join(" "));
   */
  private absorbSubParserParams;
  /**
   * Process a basic WHERE operation.
   *
   * Delegates to specialised processors for operators that require more than a
   * single placeholder (between, in, like-variants, exists, etc.).
   */
  private processWhere;
  /**
   * Process a raw WHERE operation.
   */
  private processWhereRaw;
  /**
   * Process WHERE IN / NOT IN.
   */
  private processWhereIn;
  /**
   * Process WHERE NULL / NOT NULL.
   */
  private processWhereNull;
  /**
   * Process WHERE BETWEEN / NOT BETWEEN.
   */
  private processWhereBetween;
  /**
   * Process WHERE LIKE / NOT LIKE.
   */
  private processWhereLike;
  /**
   * Process WHERE column comparison.
   */
  private processWhereColumn;
  /**
   * Process WHERE JSON contains.
   */
  private processWhereJsonContains;
  /**
   * Process full-text search WHERE.
   */
  private processWhereFullText;
  /**
   * Process SELECT operation.
   */
  private processSelect;
  /**
   * Process raw SELECT expression.
   */
  private processSelectRaw;
  /**
   * Process DESELECT operation.
   */
  private processDeselect;
  /**
   * Process SELECT for related columns (joinWith).
   *
   * - hasOne / belongsTo  → LEFT JOIN + row_to_json  (single object)
   * - hasMany             → correlated subquery with json_agg (array, no row explosion)
   *
   * @example hasMany correlated subquery:
   *   (SELECT json_agg(row_to_json(a.*))
   *    FROM "chat_message_actions" a
   *    WHERE a."chat_message_id" = "chat_messages"."id") AS "actions"
   *
   * @example hasOne/belongsTo row_to_json:
   *   row_to_json("organizationAiModel".*) AS "organizationAiModel"
   */
  private processSelectRelatedColumns;
  /**
   * Process JOIN operation with smart field detection.
   *
   * Handles both regular columns and JSONB nested paths:
   * - "id" → "table"."id" (auto-prefixed)
   * - "users.id" → "users"."id" (explicit table)
   * - "createdBy.id" → "table"."createdBy"->>'id' (JSONB path)
   * - "posts.createdBy.id" → "posts"."createdBy"->>'id' (JSONB with table)
   */
  private processJoin;
  /**
   * Parse a column identifier with smart detection for table prefixes and JSONB paths.
   *
   * Supports an optional explicit cast suffix using PostgreSQL's `::type` syntax,
   * which is the only way to coerce a JSONB-extracted value (always returned as
   * `text`) into another type. The parser does NOT infer casts from key names —
   * coercion is always opt-in by the caller.
   *
   * @param field - The field string. Examples:
   *   - "id"                       → `"table"."id"`
   *   - "users.id"                 → `"users"."id"`
   *   - "createdBy.id"             → `"table"."createdBy"->>'id'`
   *   - "createdBy.id::int"        → `("table"."createdBy"->>'id')::int`
   *   - "meta.score::numeric"      → `("table"."meta"->>'score')::numeric`
   *   - "posts.createdBy.id::uuid" → `("posts"."createdBy"->>'id')::uuid`
   * @param defaultTable - Default table to use if no prefix
   * @param tableAlias - Table alias to use if provided
   * @returns Properly quoted SQL expression
   */
  private parseColumnIdentifier;
  /**
   * Check if a string is a table reference (main table or join table).
   */
  private isTableReference;
  /**
   * Build a JSONB path expression.
   *
   * @param table - Table name
   * @param column - JSONB column name
   * @param path - Array of nested keys
   * @returns PostgreSQL JSONB path expression
   *
   * Returns the raw JSONB path expression — extracted values are always `text`
   * (`->>` returns text). Callers that need a different type must request an
   * explicit cast via the `::type` suffix in `parseColumnIdentifier`.
   *
   * @example
   * buildJsonbPath("posts", "createdBy", ["id"])
   * // Returns: "posts"."createdBy"->>'id'
   *
   * buildJsonbPath("posts", "createdBy", ["address", "city"])
   * // Returns: "posts"."createdBy"->'address'->>'city'
   */
  private buildJsonbPath;
  /**
   * Process CROSS JOIN operation.
   */
  private processCrossJoin;
  /**
   * Process raw JOIN expression.
   */
  private processJoinRaw;
  /**
   * Process ORDER BY operation.
   */
  private processOrderBy;
  /**
   * Process raw ORDER BY expression.
   */
  private processOrderByRaw;
  /**
   * Process GROUP BY operation.
   */
  private processGroupBy;
  /**
   * Process HAVING operation.
   */
  private processHaving;
  /**
   * Process a raw HAVING expression, threading `?` placeholders into
   * positional params the same way `processWhereRaw` / `processSelectRaw` do.
   * Without this, bindings on a `havingRaw` op are silently dropped.
   */
  private processHavingRaw;
  /**
   * Add a WHERE clause with boolean operator.
   */
  private addWhereClause;
  /**
   * Map simple Cascade operators to their SQL equivalents.
   *
   * Complex operators (between, in, like-variants, exists) are handled by
   * dedicated processors and should never reach this method.
   */
  private mapOperator;
}
//#endregion
export { PostgresOperationType, PostgresParserOperation, PostgresParserOptions, PostgresQueryParser };
//# sourceMappingURL=postgres-query-parser.d.mts.map