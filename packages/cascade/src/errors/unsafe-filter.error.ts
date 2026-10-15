/**
 * Error thrown when a filter value in an equality position contains
 * MongoDB operator keys (keys starting with `$`, e.g. `$ne`, `$gt`, `$where`).
 *
 * This blocks NoSQL operator injection: request-controlled payloads such as
 * `{ password: { $ne: null } }` must not be able to turn an equality match
 * into an operator query. Use the explicit operator APIs instead:
 * - `where(field, operator, value)` for comparisons
 * - `whereIn` / `whereNull` / `whereBetween` / … for specific operators
 * - `whereRaw({ ... })` (object form) for intentional raw driver filters
 */
export class UnsafeFilterError extends Error {
  /**
   * The field whose value contained the rejected operator key (if applicable).
   */
  public readonly field?: string;

  /**
   * The `$`-prefixed key that triggered the rejection.
   */
  public readonly operatorKey?: string;

  /**
   * Creates a new UnsafeFilterError.
   *
   * @param message - Descriptive error message
   * @param field - Optional field name whose value was rejected
   * @param operatorKey - Optional `$`-prefixed key that was rejected
   */
  public constructor(message: string, field?: string, operatorKey?: string) {
    super(message);
    this.name = "UnsafeFilterError";
    this.field = field;
    this.operatorKey = operatorKey;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsafeFilterError);
    }
  }
}
