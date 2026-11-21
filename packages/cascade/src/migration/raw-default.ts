/**
 * Bare words that `.default()` writes as-is because SQL reads them as keywords
 * or special values, not as column references (lower case).
 */
const RAW_DEFAULT_KEYWORDS = new Set([
  "null",
  "true",
  "false",
  "default",
  "current_timestamp",
  "current_date",
  "current_time",
  "current_user",
  "current_role",
  "current_catalog",
  "current_schema",
  "session_user",
  "user",
  "localtime",
  "localtimestamp",
  "infinity",
]);

/**
 * The SQL text of a raw `.default()` value.
 *
 * Throws when the value is a bare word that is not a SQL keyword (for example
 * `"agency"`): SQL reads it as a column reference and rejects the statement, so
 * the error names the column and `defaultString()` instead. Called by the SQL
 * drivers only; document databases ignore column defaults.
 */
export function rawDefaultSql(column: string, value: unknown): string {
  const text = String(value);

  if (
    typeof value === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) &&
    !RAW_DEFAULT_KEYWORDS.has(value.toLowerCase())
  ) {
    throw new Error(
      `Column "${column}": default("${value}") would be written as the raw SQL ` +
        `identifier ${value}, which the database reads as a column reference. ` +
        `Use defaultString("${value}") for a text default.`,
    );
  }

  return text;
}
