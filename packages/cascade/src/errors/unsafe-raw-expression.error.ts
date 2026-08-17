/**
 * Error thrown when a string expression is passed to `whereRaw()` /
 * `orWhereRaw()` on the MongoDB driver.
 *
 * String raw expressions used to compile to `{ $where: "<js>" }`, which MongoDB
 * evaluates as JavaScript inside the server for every scanned document — a
 * server-side JS injection sink when any part of the string is
 * request-controlled, and an unindexed full-scan DoS vector even when trusted.
 *
 * Use the object form instead, e.g. `whereRaw({ $expr: { $gt: ["$stock", "$reserved"] } })`.
 */
export class UnsafeRawExpressionError extends Error {
  /**
   * Creates a new UnsafeRawExpressionError.
   *
   * @param message - Descriptive error message
   */
  public constructor(message: string) {
    super(message);
    this.name = "UnsafeRawExpressionError";

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsafeRawExpressionError);
    }
  }
}
