import { AggregateExpression } from "../../expressions/aggregate-expressions.mjs";
import { SqlDialectContract } from "../sql/sql-dialect.contract.mjs";

//#region ../../@warlock.js/cascade/src/drivers/postgres/postgres-dialect.d.ts
/**
 * PostgreSQL-specific SQL dialect implementation.
 *
 * Provides PostgreSQL syntax for:
 * - Parameter placeholders ($1, $2, $3...)
 * - Identifier quoting with double quotes
 * - JSONB operators (->, ->>, @>)
 * - ILIKE for case-insensitive matching
 * - RETURNING clause support
 *
 * @example
 * ```typescript
 * const dialect = new PostgresDialect();
 *
 * dialect.placeholder(1); // "$1"
 * dialect.quoteIdentifier('user'); // '"user"'
 * dialect.jsonExtract('data', 'name'); // "data"->>'name'
 * ```
 */
declare class PostgresDialect implements SqlDialectContract {
  /**
   * Dialect name identifier.
   */
  readonly name: "postgres";
  /**
   * PostgreSQL supports the RETURNING clause for INSERT/UPDATE/DELETE.
   */
  readonly supportsReturning = true;
  /**
   * PostgreSQL uses ON CONFLICT for upsert operations.
   */
  readonly upsertKeyword: "ON CONFLICT";
  /**
   * Generate a PostgreSQL parameter placeholder.
   *
   * PostgreSQL uses numbered placeholders: $1, $2, $3, etc.
   *
   * @param index - The 1-based parameter index
   * @returns The placeholder string (e.g., "$1")
   */
  placeholder(index: number): string;
  /**
   * Quote an identifier using PostgreSQL's double-quote syntax.
   *
   * Handles escaping of embedded double quotes by doubling them.
   * This is necessary for reserved words and special characters.
   *
   * @param identifier - The identifier (table/column name) to quote
   * @returns The quoted identifier (e.g., '"user"')
   */
  quoteIdentifier(identifier: string): string;
  /**
   * Convert a boolean to PostgreSQL literal.
   *
   * @param value - The boolean value
   * @returns "TRUE" or "FALSE"
   */
  booleanLiteral(value: boolean): string;
  /**
   * Build LIMIT/OFFSET clause for PostgreSQL.
   *
   * @param limit - Maximum rows to return
   * @param offset - Rows to skip
   * @returns The SQL clause (e.g., "LIMIT 10 OFFSET 20")
   */
  limitOffset(limit?: number, offset?: number): string;
  /**
   * Build a JSON path extraction expression for PostgreSQL.
   *
   * Uses the ->> operator for text extraction from JSONB columns.
   * Supports nested paths using chained operators.
   *
   * @param column - The JSONB column name
   * @param path - The path to extract (dot notation: "user.name")
   * @returns The SQL expression (e.g., "data"->>'user'->>'name')
   */
  jsonExtract(column: string, path: string): string;
  /**
   * Build a JSON contains expression for PostgreSQL.
   *
   * Uses the @> containment operator for JSONB columns.
   *
   * @param column - The JSONB column name
   * @param value - The value to check for
   * @param path - Optional path within the JSON
   * @returns The SQL expression
   */
  jsonContains(column: string, value: unknown, path?: string): string;
  /**
   * Build a LIKE pattern expression for PostgreSQL.
   *
   * Uses ILIKE for case-insensitive matching, LIKE for case-sensitive.
   *
   * @param pattern - The pattern to match
   * @param caseInsensitive - Whether to use case-insensitive matching
   * @returns Object with operator and pattern
   */
  likePattern(pattern: string, caseInsensitive?: boolean): {
    operator: string;
    pattern: string;
  };
  /**
   * Build an array contains expression for PostgreSQL.
   *
   * Uses ANY() for checking if a value is in an array column.
   *
   * @param column - The array column name
   * @param paramIndex - The parameter index
   * @returns The SQL expression
   */
  arrayContains(column: string, paramIndex: number): string;
  /**
   * Get the PostgreSQL SQL type for an abstract type.
   *
   * @param type - The abstract type name
   * @param options - Type-specific options
   * @returns The PostgreSQL type string
   */
  getSqlType(type: string, options?: {
    length?: number;
    precision?: number;
    scale?: number;
    dimensions?: number;
  }): string;
  /**
   * Translate a database-agnostic aggregate expression to PostgreSQL SQL.
   *
   * The five scalar aggregates map to their ANSI SQL function. `distinct`,
   * `floor`, `first` and `last` are MongoDB-only for v1 — none has a
   * single-scalar `GROUP BY` equivalent on PostgreSQL, so they throw instead
   * of emitting a silently-different semantic (the footgun this guards).
   *
   * @param expression - The abstract aggregate (`$agg.*`) to translate
   * @returns The SQL fragment (e.g. `SUM("amount")`, `COUNT(*)`)
   */
  aggregateToSql(expression: AggregateExpression): string;
}
//#endregion
export { PostgresDialect };
//# sourceMappingURL=postgres-dialect.d.mts.map