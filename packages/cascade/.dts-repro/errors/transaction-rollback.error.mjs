//#region ../../@warlock.js/cascade/src/errors/transaction-rollback.error.ts
/**
* Error thrown when a transaction is explicitly rolled back via ctx.rollback().
*
* This error is used to signal transaction rollback without representing
* an application error. It's caught by the transaction wrapper to perform
* cleanup and then re-thrown.
*/
var TransactionRollbackError = class TransactionRollbackError extends Error {
	/**
	* The reason for the rollback (if provided).
	*/
	reason;
	/**
	* Creates a new TransactionRollbackError.
	*
	* @param reason - Optional reason for rollback (for logging/debugging)
	*/
	constructor(reason) {
		super(reason || "Transaction rolled back");
		this.name = "TransactionRollbackError";
		this.reason = reason;
		if (Error.captureStackTrace) Error.captureStackTrace(this, TransactionRollbackError);
	}
};
//#endregion
export { TransactionRollbackError };

//# sourceMappingURL=transaction-rollback.error.mjs.map