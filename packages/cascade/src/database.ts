import { AsyncLocalStorage } from "async_hooks";
import type {
  ClientSession,
  ClientSessionOptions,
  Collection,
  Db,
  Document,
} from "mongodb";
import type { Connection } from "./connection";

export type DatabaseSessionTransaction = {
  session: ClientSession;
  database: Database;
};

const ROLLBACK_SYMBOL = Symbol("rollback");
const COMMIT_SYMBOL = Symbol("commit");

export type DatabaseTransactionCallbackOptions = {
  rollback: symbol;
  commit: symbol;
  session: ClientSession;
};

export type DatabaseTransactionCallback = (
  options: DatabaseTransactionCallbackOptions,
) => Promise<symbol | void>;

export class Database {
  /**
   * MongoDB Internal Database instance
   */
  public database!: Db;

  /**
   * Current Connection
   */
  public connection!: Connection;

  public sessionsContainer =
    new AsyncLocalStorage<DatabaseSessionTransaction>();

  /**
   * Execute operations within a transaction (automatic commit/rollback)
   *
   * This is the recommended method for most use cases.
   * Automatically commits on success, rolls back on errors.
   *
   * @example
   * const user = await database.transaction(async (session) => {
   *   const user = await User.create({ name: "John" }, { session });
   *   const order = await Order.create({ userId: user.id }, { session });
   *   return user; // Auto commits on success
   * });
   */
  public async transaction<T>(
    callback: (session: ClientSession) => Promise<T>,
    sessionOptions: ClientSessionOptions = {
      defaultTransactionOptions: {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      },
    },
  ): Promise<T> {
    const session = this.connection.client.startSession(sessionOptions);

    try {
      const result = await this.sessionsContainer.run(
        {
          session,
          database: this,
        },
        async () => {
          return await session.withTransaction(async () => {
            return await callback(session);
          });
        },
      );

      return result as T;
    } finally {
      // Always end session after withTransaction completes
      await session.endSession();
    }
  }

  /**
   * Start a transaction with manual control
   *
   * Use this when you need explicit control over commit/rollback based on business logic.
   * Returns true if committed, false if rolled back.
   *
   * @example
   * const committed = await database.startTransaction(async ({ session, commit, rollback }) => {
   *   const user = await User.create({ name: "John" }, { session });
   *   const order = await Order.create({ userId: user.id }, { session });
   *
   *   // Conditional rollback based on business logic
   *   if (order.total > 10000) {
   *     console.log("Order too large, rolling back");
   *     return rollback; // Explicit rollback
   *   }
   *
   *   if (user.isBanned) {
   *     console.log("User banned, rolling back");
   *     return rollback; // Explicit rollback
   *   }
   *
   *   return commit; // Explicit commit
   * });
   *
   * if (committed) {
   *   console.log("Transaction committed successfully");
   * } else {
   *   console.log("Transaction was rolled back");
   * }
   */
  public async startTransaction(
    callback: DatabaseTransactionCallback,
    sessionOptions: ClientSessionOptions = {
      defaultTransactionOptions: {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      },
    },
  ): Promise<boolean> {
    const session = this.connection.client.startSession(sessionOptions);

    try {
      let shouldRollback = false;

      await this.sessionsContainer.run(
        {
          session,
          database: this,
        },
        async () => {
          await session.withTransaction(async () => {
            const output = await callback({
              session,
              commit: COMMIT_SYMBOL,
              rollback: ROLLBACK_SYMBOL,
            });

            if (output === ROLLBACK_SYMBOL) {
              shouldRollback = true;
              // Throw error to trigger rollback in withTransaction
              throw new Error("TRANSACTION_ROLLBACK_REQUESTED");
            }

            // Return value for withTransaction to commit
            return output;
          });
        },
      );

      return !shouldRollback; // true if committed, false if rolled back
    } catch (error: any) {
      // Check if it was an intentional rollback
      if (error?.message === "TRANSACTION_ROLLBACK_REQUESTED") {
        return false; // Rolled back successfully
      }
      // Re-throw actual errors
      throw error;
    } finally {
      // Always end session after withTransaction completes
      await session.endSession();
    }
  }

  /**
   * Get active session
   */
  public getActiveSession() {
    return this.sessionsContainer.getStore();
  }
  /**
   * Set connection instance
   */
  public setConnection(connection: Connection) {
    this.connection = connection;

    return this;
  }

  /**
   * Set database instance
   */
  public setDatabase(database: Db) {
    this.database = database;

    return this;
  }

  /**
   * Get database collection instance
   */
  public collection<TSchema extends Document = Document>(
    collection: string,
  ): Collection<TSchema> {
    return this.database.collection<TSchema>(collection);
  }

  /**
   * List collection names
   */
  public async listCollectionNames() {
    return (await this.database.listCollections().toArray()).map(
      collection => collection.name,
    );
  }

  /**
   * Drop database
   */
  public async drop() {
    return await this.database.dropDatabase();
  }
}

export const database = new Database();
