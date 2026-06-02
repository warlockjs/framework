import { Context, contextManager } from "@warlock.js/context";
//#region ../../@warlock.js/cascade/src/context/database-transaction-context.ts
/**
* Database Transaction Context
*
* Manages database transaction sessions using AsyncLocalStorage.
* Extends the base Context class for consistent API.
*/
var DatabaseTransactionContext = class extends Context {
	/**
	* Get the current transaction session
	*/
	getSession() {
		return this.get("session");
	}
	/**
	* Check if there's an active transaction in the current context
	*/
	hasActiveTransaction() {
		return this.getSession() !== void 0;
	}
	/**
	* Set the transaction session in context
	*/
	setSession(session) {
		this.set("session", session);
	}
	/**
	* Exit the transaction context
	*/
	exit() {
		this.clear();
	}
	/**
	* Build the initial transaction store with defaults
	*/
	buildStore() {
		return { session: void 0 };
	}
};
const databaseTransactionContext = new DatabaseTransactionContext();
contextManager.register("db.transaction", databaseTransactionContext);
//#endregion
export { databaseTransactionContext };

//# sourceMappingURL=database-transaction-context.mjs.map