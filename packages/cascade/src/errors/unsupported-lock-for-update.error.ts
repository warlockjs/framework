/**
 * Error thrown when `lockForUpdate()` is requested on MongoDB, whose document
 * model has no row-level `SELECT ... FOR UPDATE` equivalent.
 */
export class UnsupportedLockForUpdateError extends Error {
  public constructor() {
    super(
      "lockForUpdate() is unsupported on MongoDB. MongoDB has no row-level SELECT locking. " +
        'Use a conditional atomic update instead, e.g. Model.atomic({ id, leaseUntil: { $lt: now } }, { $set: { status: "processing" } }, { trustedFilter: true }).',
    );
    this.name = "UnsupportedLockForUpdateError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedLockForUpdateError);
    }
  }
}
