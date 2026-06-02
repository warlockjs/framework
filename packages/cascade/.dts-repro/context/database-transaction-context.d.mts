import { Context } from "@warlock.js/context";

//#region ../../@warlock.js/cascade/src/context/database-transaction-context.d.ts
interface TransactionContextStore {
  session?: unknown;
}
/**
 * Database Transaction Context
 *
 * Manages database transaction sessions using AsyncLocalStorage.
 * Extends the base Context class for consistent API.
 */
declare class DatabaseTransactionContext extends Context<TransactionContextStore> {
  /**
   * Get the current transaction session
   */
  getSession<TSession = unknown>(): TSession | undefined;
  /**
   * Check if there's an active transaction in the current context
   */
  hasActiveTransaction(): boolean;
  /**
   * Set the transaction session in context
   */
  setSession(session: unknown): void;
  /**
   * Exit the transaction context
   */
  exit(): void;
  /**
   * Build the initial transaction store with defaults
   */
  buildStore(): TransactionContextStore;
}
declare const databaseTransactionContext: DatabaseTransactionContext;
//#endregion
export { databaseTransactionContext };
//# sourceMappingURL=database-transaction-context.d.mts.map