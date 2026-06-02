//#region ../../@warlock.js/cascade/src/errors/transaction-rollback.error.d.ts
/**
 * Error thrown when a transaction is explicitly rolled back via ctx.rollback().
 *
 * This error is used to signal transaction rollback without representing
 * an application error. It's caught by the transaction wrapper to perform
 * cleanup and then re-thrown.
 */
declare class TransactionRollbackError extends Error {
  /**
   * The reason for the rollback (if provided).
   */
  readonly reason?: string;
  /**
   * Creates a new TransactionRollbackError.
   *
   * @param reason - Optional reason for rollback (for logging/debugging)
   */
  constructor(reason?: string);
}
//#endregion
export { TransactionRollbackError };
//# sourceMappingURL=transaction-rollback.error.d.mts.map