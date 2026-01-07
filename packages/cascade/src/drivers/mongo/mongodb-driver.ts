import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import type {
  BulkWriteOptions,
  ClientSession,
  Db,
  DeleteOptions,
  InsertManyResult,
  InsertOneOptions,
  MongoClient,
  MongoClientOptions,
  TransactionOptions,
  UpdateFilter,
  UpdateOptions,
} from "mongodb";
import { EventEmitter } from "node:events";
import { databaseTransactionContext } from "../../context/database-transaction-context";
import type {
  DriverBlueprintContract,
  DriverContract,
  DriverEvent,
  DriverEventListener,
  DriverTransactionContract,
  IdGeneratorContract,
  InsertResult,
  MigrationDriverContract,
  QueryBuilderContract,
  SyncAdapterContract,
  UpdateResult,
} from "../../contracts";
import { dataSourceRegistry } from "../../data-source/data-source-registry";
import { MongoIdGenerator } from "./mongo-id-generator";
import { MongoMigrationDriver } from "./mongo-migration-driver";
import { MongoQueryBuilder } from "./mongo-query-builder";
import { MongoSyncAdapter } from "./mongo-sync-adapter";
import { MongoDBBlueprint } from "./mongodb-blueprint";
import type { MongoDriverOptions } from "./types";

const DEFAULT_TRANSACTION_OPTIONS: TransactionOptions = {
  readPreference: "primary",
  readConcern: { level: "local" },
  writeConcern: { w: "majority" },
};

let ObjectId: typeof import("mongodb").ObjectId;

/**
 * MongoDB driver implementation that fulfils the Cascade driver contract.
 *
 * It encapsulates the native Mongo client, exposes lifecycle events, and
 * provides helpers for CRUD, transactions, atomic updates, and sync adapters.
 */
export class MongoDbDriver implements DriverContract {
  private readonly events = new EventEmitter();
  public client?: MongoClient;
  public database?: Db;
  private connected = false;
  private syncAdapterInstance?: MongoSyncAdapter;
  private migrationDriverInstance?: MigrationDriverContract;
  private readonly transactionOptions: TransactionOptions;
  private idGeneratorInstance?: IdGeneratorContract;
  private _blueprint?: DriverBlueprintContract;

  public get blueprint(): DriverBlueprintContract {
    if (!this._blueprint) {
      this._blueprint = new MongoDBBlueprint(this.database!);
    }

    return this._blueprint;
  }

  /**
   * The name of this driver.
   */
  public readonly name = "mongodb";

  /**
   * Create a new MongoDB driver using the supplied connection options.
   *
   * @param config - Connection configuration
   * @param driverOptions - Driver-specific options
   */
  public constructor(
    private readonly config: {
      database: string;
      uri?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      authSource?: string;
      clientOptions?: MongoClientOptions;
    },
    private readonly driverOptions?: MongoDriverOptions,
  ) {
    this.transactionOptions = {
      ...DEFAULT_TRANSACTION_OPTIONS,
      ...driverOptions?.transactionOptions,
    };
  }

  /**
   * Indicates whether the driver currently maintains an active connection.
   */
  public get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the MongoDB database instance.
   *
   * @returns The MongoDB Db instance
   * @throws {Error} If not connected
   *
   * @example
   * ```typescript
   * const db = driver.getDatabase();
   * const collection = db.collection("users");
   * ```
   */
  public getDatabase(): Db {
    if (!this.database) {
      throw new Error(
        "Database not available. Ensure the driver is connected before accessing the database.",
      );
    }
    return this.database;
  }

  /**
   * Get the ID generator instance for this driver.
   *
   * Creates a MongoIdGenerator on first access if autoGenerateId is enabled.
   *
   * @returns The ID generator instance, or undefined if disabled
   *
   * @example
   * ```typescript
   * const idGenerator = driver.getIdGenerator();
   * if (idGenerator) {
   *   const id = await idGenerator.generateNextId({ table: "users" });
   * }
   * ```
   */
  public getIdGenerator(): IdGeneratorContract | undefined {
    // Return undefined if ID generation is disabled
    if (this.driverOptions?.autoGenerateId === false) {
      return undefined;
    }

    // Create ID generator lazily on first access
    if (!this.idGeneratorInstance) {
      this.idGeneratorInstance = new MongoIdGenerator(this, this.driverOptions?.counterCollection);
    }

    return this.idGeneratorInstance;
  }

  /**
   * Establish a MongoDB connection using the configured options.
   * Throws if the connection attempt fails.
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const uri = this.resolveUri();
    const { MongoClient, ObjectId: ObjectIdMongoDB } = await import("mongodb");

    ObjectId = ObjectIdMongoDB;

    const client = new MongoClient(uri, this.buildClientOptions());

    try {
      log.info(
        "database",
        "connection",
        `Connecting to database ${colors.bold(colors.yellowBright(this.config.database))}`,
      );
      await client.connect();
      this.client = client;
      this.database = client.db(this.config.database);
      this.connected = true;
      log.success("database", "connection", "Connected to database");

      client.on("close", () => {
        if (this.connected) {
          this.connected = false;
          this.emit("disconnected");
          log.warn("database", "connection", "Disconnected from database");
        }
      });

      this.emit("connected");
    } catch (error) {
      await client.close().catch(() => undefined);
      this.emit("disconnected");
      throw error;
    }
  }

  /**
   * Close the underlying MongoDB connection.
   */
  public async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.close();
    } finally {
      this.connected = false;
      this.emit("disconnected");
    }
  }

  /**
   * Subscribe to driver lifecycle events.
   */
  public on(event: DriverEvent, listener: DriverEventListener): void {
    this.events.on(event, listener);
  }

  /**
   * Insert a single document into the given collection.
   */
  public async insert(
    table: string,
    document: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<InsertResult> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<InsertOneOptions>(options);
    const result = await collection.insertOne(document, mongoOptions);

    return {
      document: {
        ...document,
        _id: result.insertedId,
      },
    };
  }

  /**
   * Insert multiple documents into the given collection.
   */
  public async insertMany(
    table: string,
    documents: Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): Promise<InsertResult[]> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<BulkWriteOptions>(options);
    const result: InsertManyResult<Record<string, unknown>> = await collection.insertMany(
      documents,
      mongoOptions,
    );

    return documents.map((document, index) => {
      const insertedId = result.insertedIds[index as unknown as keyof typeof result.insertedIds];

      return {
        document: {
          ...document,
          _id: insertedId,
        },
      };
    });
  }

  /**
   * Update a single document that matches the provided filter.
   */
  public async update(
    table: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<UpdateOptions>(options);
    const result = await collection.updateOne(
      filter,
      update as UpdateFilter<Record<string, unknown>>,
      mongoOptions,
    );

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Replace a single document that matches the provided filter.
   */
  public async replace<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    document: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T | null> {
    const collection = this.getDatabaseInstance().collection(table);
    const result = await collection.findOneAndReplace(filter, document as Record<string, unknown>);

    return result?.value as T | null;
  }

  /**
   * Update multiple documents that match the provided filter.
   */
  public async updateMany(
    table: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<UpdateOptions>(options);
    const result = await collection.updateMany(
      filter,
      update as UpdateFilter<Record<string, unknown>>,
      mongoOptions,
    );

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Delete a single document that matches the provided filter.
   */
  public async delete(
    table: string,
    filter: Record<string, unknown> = {},
    options?: Record<string, unknown>,
  ): Promise<number> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<DeleteOptions>(options);
    const result = await collection.deleteOne(filter, mongoOptions);

    return result.deletedCount > 0 ? 1 : 0;
  }

  /**
   * Delete documents that match the provided filter.
   */
  public async deleteMany(
    table: string,
    filter: Record<string, unknown> = {},
    options?: Record<string, unknown>,
  ): Promise<number> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<DeleteOptions>(options);

    const result = await collection.deleteMany(filter, mongoOptions);

    return result.deletedCount ?? 0;
  }

  /**
   * Remove all records from a collection.
   *
   * This uses deleteMany with an empty filter to remove all documents.
   * For very large collections, consider using the migration driver's
   * dropTable + createTable approach for better performance.
   */
  public async truncateTable(table: string, options?: Record<string, unknown>): Promise<number> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<DeleteOptions>(options);
    const result = await collection.deleteMany({}, mongoOptions);

    return result.deletedCount ?? 0;
  }

  /**
   * Serialize the given data
   */
  public serialize(data: Record<string, unknown>): Record<string, unknown> {
    if (data._id && data._id instanceof ObjectId) {
      data._id = data._id.toString();
    }

    return data;
  }

  /**
   * Deserialize the given data
   */
  public deserialize(data: Record<string, unknown>): Record<string, unknown> {
    if (data._id && typeof data._id === "string") {
      data._id = new ObjectId(data._id);
    }

    return data;
  }

  /**
   * Provide a Mongo-backed query builder instance for the given collection.
   */
  public queryBuilder<T = unknown>(table: string): QueryBuilderContract<T> {
    return new MongoQueryBuilder(table, dataSourceRegistry.get());
  }

  /**
   * Begin a MongoDB transaction, returning commit/rollback helpers.
   */
  public async beginTransaction(): Promise<DriverTransactionContract<ClientSession>> {
    const client = this.getClientInstance();
    const session = client.startSession();

    await session.startTransaction(this.transactionOptions);
    databaseTransactionContext.enter({ session });
    let finished = false;

    const finalize = async (operation: () => Promise<void>): Promise<void> => {
      if (finished) return;

      try {
        await operation();
      } finally {
        finished = true;
        databaseTransactionContext.exit();
        await session.endSession().catch(() => undefined);
      }
    };

    return {
      context: session,
      commit: async () => {
        await finalize(async () => {
          try {
            await session.commitTransaction();
          } catch (error) {
            await session.abortTransaction().catch(() => undefined);
            throw error;
          }
        });
      },
      rollback: async () => {
        await finalize(async () => {
          await session.abortTransaction();
        });
      },
    };
  }

  /**
   * Execute atomic operations (typically $inc/$set style updates) against documents.
   *
   * Uses `updateMany` so callers can atomically modify any set of documents.
   */
  public async atomic(
    table: string,
    filter: Record<string, unknown>,
    operations: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    const collection = this.getDatabaseInstance().collection(table);
    const mongoOptions = this.withSession<UpdateOptions>(options);
    const result = await collection.updateMany(
      filter,
      operations as UpdateFilter<Record<string, unknown>>,
      mongoOptions,
    );

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Lazily create (and cache) the Mongo sync adapter.
   * The adapter uses this driver instance to ensure all operations
   * participate in active transactions via the session context.
   */
  public syncAdapter(): SyncAdapterContract {
    if (!this.syncAdapterInstance) {
      this.syncAdapterInstance = new MongoSyncAdapter(this);
    }

    return this.syncAdapterInstance;
  }

  /**
   * Lazily create (and cache) the Mongo migration driver.
   * The migration driver handles schema operations like indexes, collections, etc.
   */
  public migrationDriver(): MigrationDriverContract {
    if (!this.migrationDriverInstance) {
      this.migrationDriverInstance = new MongoMigrationDriver(this);
    }

    return this.migrationDriverInstance!;
  }

  /**
   * Expose the underlying Mongo client for advanced consumers.
   */
  public getClient(): MongoClient {
    return this.getClientInstance();
  }

  /**
   * Retrieve the active Mongo client, throwing if the driver is disconnected.
   */
  private getClientInstance(): MongoClient {
    if (!this.client) {
      throw new Error("Mongo driver is not connected.");
    }

    return this.client;
  }

  /**
   * Retrieve the active Mongo database, throwing if the driver is disconnected.
   * @private
   */
  private getDatabaseInstance(): Db {
    if (!this.database) {
      throw new Error("Mongo driver is not connected to a database.");
    }

    return this.database;
  }

  /**
   * Resolve the Mongo connection string based on provided options.
   */
  private resolveUri(): string {
    if (this.config.uri) {
      return this.config.uri;
    }

    const host = this.config.host ?? "localhost";
    const port = this.config.port ?? 27017;

    return `mongodb://${host}:${port}`;
  }

  /**
   * Build the Mongo client options derived from the driver configuration.
   */
  private buildClientOptions(): MongoClientOptions {
    const baseOptions: MongoClientOptions = {
      ...(this.config.clientOptions ?? {}),
    };

    if (this.config.username && !baseOptions.auth) {
      baseOptions.auth = {
        username: this.config.username,
        password: this.config.password,
      };
    }

    if (this.config.authSource && !baseOptions.authSource) {
      baseOptions.authSource = this.config.authSource;
    }

    return baseOptions;
  }

  /**
   * Emit a driver lifecycle event.
   */
  private emit(event: DriverEvent, ...args: unknown[]): void {
    this.events.emit(event, ...args);
  }

  /**
   * Attach the active transaction session (when available) to Mongo options.
   */
  private withSession<TOptions extends { session?: ClientSession }>(
    options?: Record<string, unknown>,
  ): TOptions | undefined {
    const session = databaseTransactionContext.getSession<ClientSession>();

    if (!session) {
      return options as TOptions | undefined;
    }

    const baseOptions = options ? ({ ...options } as TOptions) : ({} as TOptions);

    baseOptions.session = session;

    return baseOptions;
  }
}
