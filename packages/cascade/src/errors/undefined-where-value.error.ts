/**
 * Error thrown when a `where()`-family call is given `undefined` as the
 * bound value.
 *
 * A bound `undefined` reaches SQL drivers as `= NULL`, which never matches
 * any row (SQL's three-valued logic — `NULL = NULL` is `NULL`, not `true`) —
 * and reaches the MongoDB driver as a filter that matches every document
 * missing the field. Either way the query silently returns the wrong rows
 * instead of failing loudly, which usually means the caller forgot to guard
 * an id/value that turned out to be missing (e.g. `User.find(post.authorId)`
 * when `authorId` came back `undefined`).
 *
 * To match `NULL` explicitly, pass `null` — `where("deletedAt", null)` is a
 * valid, intentional query. To skip the query entirely when there's no
 * value, guard the call site instead of calling `where()`.
 */
export class UndefinedWhereValueError extends Error {
  /**
   * The field whose value was `undefined`.
   */
  public readonly field: string;

  /**
   * Creates a new UndefinedWhereValueError.
   *
   * @param field - The field name whose value was rejected
   */
  public constructor(field: string) {
    super(
      `where("${field}", undefined) — a bound "undefined" value silently becomes a NULL ` +
        `comparison that never matches, hiding the real bug. Pass null to match NULL ` +
        `explicitly, or skip the query when there's no value for "${field}".`,
    );
    this.name = "UndefinedWhereValueError";
    this.field = field;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UndefinedWhereValueError);
    }
  }
}
