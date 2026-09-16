/**
 * Error thrown when a query builder is asked for a read operation its driver
 * cannot express — e.g. a MongoDB-only aggregation stage such as `unwind()` or
 * `addFields()` on a SQL driver.
 *
 * Builders throw this instead of silently dropping the stage, so a caller
 * never receives rows shaped differently from what the query asked for.
 */
export class UnsupportedQueryOperationError extends Error {
  /**
   * The operation that was rejected (e.g. `"unwind"`, `"addFields"`).
   */
  public readonly operation: string;

  /**
   * The driver that rejected it (e.g. `"postgres"`).
   */
  public readonly driver: string;

  /**
   * Creates a new UnsupportedQueryOperationError.
   *
   * @param operation - The rejected operation
   * @param driver - The driver name
   * @param hint - Optional guidance appended to the message
   */
  public constructor(operation: string, driver: string, hint?: string) {
    super(`The ${driver} driver does not support ${operation}() in queries.` + (hint ? ` ${hint}` : ""));
    this.name = "UnsupportedQueryOperationError";
    this.operation = operation;
    this.driver = driver;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedQueryOperationError);
    }
  }
}
