import { Context, contextManager } from "@warlock.js/context";

export interface TransactionContextStore {
  session?: unknown;
  /**
   * Set once the transaction that owns this store has finished (commit,
   * rollback or failure). Async work armed inside the transaction keeps a
   * reference to the store, so the flag makes it stop handing out the
   * finished session.
   */
  ended?: boolean;
  afterCommit?: Array<() => void | Promise<void>>;
}

/**
 * Database Transaction Context
 *
 * Manages database transaction sessions using AsyncLocalStorage.
 * Extends the base Context class for consistent API.
 */
class DatabaseTransactionContext extends Context<TransactionContextStore> {
  /**
   * Get the current transaction session
   */
  public getSession<TSession = unknown>(): TSession | undefined {
    if (this.get("ended")) return undefined;

    return this.get("session") as TSession | undefined;
  }

  /**
   * Mark a transaction store as finished. Timers, queues and fire-and-forget
   * work armed inside the transaction still hold this store object; after this
   * call their queries run without a session, outside any transaction.
   */
  public end(store: TransactionContextStore | undefined): void {
    if (store) store.ended = true;
  }

  /**
   * Check if there's an active transaction in the current context
   */
  public hasActiveTransaction(): boolean {
    return this.getSession() !== undefined;
  }

  /**
   * Set the transaction session in context
   */
  public setSession(session: unknown): void {
    this.set("session", session);
  }

  /**
   * Queue a callback to run once the active transaction commits
   */
  public addAfterCommit(fn: () => void | Promise<void>): void {
    const queue = this.get("afterCommit") ?? [];

    queue.push(fn);

    this.set("afterCommit", queue);
  }

  /**
   * Take (and empty) the queued after-commit callbacks.
   * Must be called before `exit()`, which clears the store.
   */
  public takeAfterCommit(): Array<() => void | Promise<void>> {
    const queue = this.get("afterCommit") ?? [];

    this.set("afterCommit", []);

    return queue;
  }

  /**
   * Exit the transaction context
   */
  public exit(): void {
    this.clear();
  }

  /**
   * Build the initial transaction store with defaults
   */
  public buildStore(): TransactionContextStore {
    return { session: undefined };
  }
}

export const databaseTransactionContext = new DatabaseTransactionContext();

contextManager.register("db.transaction", databaseTransactionContext);
