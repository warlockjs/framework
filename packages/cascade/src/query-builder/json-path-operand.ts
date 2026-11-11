/**
 * Deferred JSON path operands for raw SQL expressions.
 *
 * The JSON helpers (`whereJsonContainsKey`, `whereJsonLength`,
 * `whereJsonIsArray`, `whereJsonIsObject`, `whereArrayLength`, `selectJson`)
 * record a raw expression with {@link JSON_PATH_PLACEHOLDER} where the path
 * goes, plus the path itself. The SQL parser resolves the path when it knows
 * every table and alias of the query, so a leading `table.` (the base table,
 * a joined table or an alias, even one joined after the helper was called)
 * keeps meaning `table.column`, and the path is quoted and escaped rather
 * than written into the SQL text.
 */

/** Where the resolved path goes inside the recorded raw expression. */
export const JSON_PATH_PLACEHOLDER = "\u0000json-path\u0000";

/**
 * A JSON path operand.
 *
 * - `path` — `column.key.key`, `column->key->key`, or either form prefixed by a
 *   table name or alias of the query (`posts.meta.theme`, `posts.meta->theme`).
 * - `asText` — read the last key as text (`->>`) instead of JSON (`->`).
 */
export type JsonPathOperand = { path: string; asText?: boolean };

/**
 * Operation data for a raw expression on a JSON path.
 *
 * @param template - The expression, holding {@link JSON_PATH_PLACEHOLDER}
 * @param path - The JSON path (see {@link JsonPathOperand})
 * @param bindings - Values for the `?` placeholders of the template
 * @param asText - Read the last key as text
 */
export function jsonPathOperation(
  template: string,
  path: string,
  bindings: unknown[] = [],
  asText = false,
): { expression: string; bindings: unknown[]; jsonPath: JsonPathOperand } {
  return { expression: template, bindings, jsonPath: { path: String(path), asText } };
}
