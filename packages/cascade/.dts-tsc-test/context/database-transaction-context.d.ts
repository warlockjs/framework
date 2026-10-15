import { Context } from "@warlock.js/context";
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
export declare const databaseTransactionContext: DatabaseTransactionContext;
export {};
//# sourceMappingURL=database-transaction-context.d.ts.map