/**
 * Comparison operators a builder helper may write into SQL text.
 *
 * Helpers such as `has(relation, operator, count)`, `having()` on an
 * aggregate alias, `whereJsonLength()` and `whereArrayLength()` place the
 * operator between two expressions. It is SQL text, not a bound value, so
 * only these exact tokens are accepted.
 */
const COMPARISON_OPERATORS = new Set(["=", "!=", "<>", ">", ">=", "<", "<="]);

/**
 * Return `operator` when it is a plain comparison operator, or throw.
 *
 * @param operator - The operator passed to the helper
 * @param method - The helper name, used in the error message
 * @throws Error when the operator is anything else
 */
export function toSqlComparisonOperator(operator: unknown, method: string): string {
  const token = typeof operator === "string" ? operator.trim() : operator;

  if (typeof token === "string" && COMPARISON_OPERATORS.has(token)) {
    return token;
  }

  throw new Error(
    `${method}: unsupported comparison operator ${JSON.stringify(String(operator).slice(0, 40))}. ` +
      `Use one of =, !=, <>, >, >=, <, <=.`,
  );
}
