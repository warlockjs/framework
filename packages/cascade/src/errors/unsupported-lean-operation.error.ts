/**
 * Error thrown when a query in lean read mode (`.lean()`) asks for something
 * that needs hydrated Model instances — eager-loading relations with `with()`
 * or `joinWith()`.
 *
 * Relations are attached to Model instances and shaped (including the related
 * model's `hidden` fields) by the Model layer, so lean mode refuses them rather
 * than returning a half-loaded or unfiltered result.
 */
export class UnsupportedLeanOperationError extends Error {
  /**
   * The rejected builder operation (e.g. `"with"`, `"joinWith"`).
   */
  public readonly operation: string;

  /**
   * Creates a new UnsupportedLeanOperationError.
   *
   * @param operation - The rejected builder operation
   */
  public constructor(operation: string) {
    super(
      `${operation}() cannot be combined with lean(): eager-loaded relations need hydrated models. ` +
        `Drop lean() for this query, or load the related records with a second lean query.`,
    );
    this.name = "UnsupportedLeanOperationError";
    this.operation = operation;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedLeanOperationError);
    }
  }
}
