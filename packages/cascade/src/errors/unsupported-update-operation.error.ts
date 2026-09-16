/**
 * Error thrown when a driver is asked to perform an update it cannot express
 * natively — e.g. an aggregation-pipeline update, `arrayFilters` or `$addToSet`
 * on a SQL driver, or an upsert whose conflict target cannot be derived.
 *
 * Drivers throw this instead of silently dropping the operation, so a caller
 * never believes a write happened that did not.
 */
export class UnsupportedUpdateOperationError extends Error {
  /**
   * The operation that was rejected (e.g. `"pipeline update"`, `"$addToSet"`).
   */
  public readonly operation: string;

  /**
   * The driver that rejected it (e.g. `"postgres"`).
   */
  public readonly driver: string;

  /**
   * Creates a new UnsupportedUpdateOperationError.
   *
   * @param operation - The rejected operation
   * @param driver - The driver name
   * @param hint - Optional guidance appended to the message
   */
  public constructor(operation: string, driver: string, hint?: string) {
    super(
      `The ${driver} driver does not support ${operation} in atomic updates.` +
        (hint ? ` ${hint}` : ""),
    );
    this.name = "UnsupportedUpdateOperationError";
    this.operation = operation;
    this.driver = driver;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedUpdateOperationError);
    }
  }
}
