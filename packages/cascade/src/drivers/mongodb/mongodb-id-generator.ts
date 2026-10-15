import type { GenerateIdOptions, IdGeneratorContract } from "../../contracts";
import type { MongoDbDriver } from "./mongodb-driver";

/** Number of times a reservation retries after a duplicate-key (E11000) error. */
const MAX_RESERVE_ATTEMPTS = 3;

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Is `error` a MongoDB duplicate-key (E11000) error?
 *
 * Raised when two concurrent first-time upserts race to create the same
 * counter document once the unique index on `{ collection: 1 }` exists.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === DUPLICATE_KEY_ERROR_CODE
  );
}

/**
 * MongoDB-specific ID generator for auto-incrementing integer IDs.
 *
 * Maintains a separate collection that tracks the last generated ID for each
 * table, mimicking SQL's `AUTO_INCREMENT` / `SERIAL`.
 *
 * **Collection Structure:**
 * ```json
 * { "collection": "users", "id": 12345 }
 * ```
 *
 * **Atomicity & concurrency:**
 * - Each id (or block of ids) is reserved with a SINGLE atomic
 *   `findOneAndUpdate` on one document; MongoDB serializes concurrent writes to
 *   the same document, so concurrent callers receive distinct, non-overlapping
 *   ids/blocks.
 * - A unique index on `{ collection: 1 }` is ensured lazily (once per instance)
 *   so two concurrent first-time upserts for a brand-new table can't create
 *   duplicate counter documents; the loser of that race gets an E11000 and is
 *   retried (by then the document exists, so it takes the increment branch).
 *
 * **Transactions — IMPORTANT:** the counter write is its OWN standalone,
 * immediately-durable operation. It does NOT join an ambient
 * `transaction()` session (it calls `findOneAndUpdate` directly without a
 * session). This is intentional and matches SQL `SERIAL` semantics: if the
 * surrounding transaction rolls back, the inserted records are undone but the
 * consumed id(s) are NOT — they remain a gap in the sequence. Do not rely on
 * id reservation being rolled back with a transaction.
 *
 * @example
 * ```typescript
 * const idGenerator = new MongoIdGenerator(mongoDriver);
 *
 * const id = await idGenerator.generateNextId({ table: "users" });        // one id
 * const ids = await idGenerator.generateNextIds({ table: "users", count: 100 }); // a block
 * ```
 */
export class MongoIdGenerator implements IdGeneratorContract {
  /**
   * The collection name that stores ID counters.
   * Each document tracks the last ID for a specific table.
   *
   * Named "MasterMind" for backward compatibility with legacy Cascade.
   */
  public readonly counterCollection: string = "MasterMind";

  /**
   * Memoized "ensure unique index" promise — the index is created at most once
   * per generator instance, before the first reservation completes.
   */
  private indexEnsured?: Promise<void>;

  /**
   * Create a new MongoDB ID generator instance.
   *
   * @param driver - The MongoDB driver instance
   * @param counterCollection - Name of the collection storing ID counters (default: "MasterMind")
   */
  public constructor(
    private readonly driver: MongoDbDriver,
    counterCollection?: string,
  ) {
    if (counterCollection) {
      this.counterCollection = counterCollection;
    }
  }

  /**
   * Generate the next ID for a table.
   *
   * Reserves a single id via one atomic `findOneAndUpdate` (see the class doc
   * for the atomicity / transaction contract). Equivalent to a block of size 1.
   *
   * @param options - Configuration for ID generation
   * @returns The generated ID
   *
   * @example
   * ```typescript
   * const id = await idGenerator.generateNextId({ table: "users", initialId: 1000 });
   * ```
   */
  public async generateNextId(options: GenerateIdOptions): Promise<number> {
    const { table, initialId = 1, incrementIdBy = 1 } = options;

    await this.ensureIndexes();

    return await this.reserveBlock(table, initialId, incrementIdBy, 1);
  }

  /**
   * Reserve a contiguous block of `count` ids in a single atomic operation.
   *
   * Advances the counter by `count * incrementIdBy` in one `findOneAndUpdate`
   * (so the stored last id becomes the block's last id) and returns the block
   * in ascending order. See the class doc for the non-transactional contract.
   *
   * @param options - `GenerateIdOptions` plus the block `count`
   * @returns The reserved ids in ascending order (length `count`)
   *
   * @example
   * ```typescript
   * const ids = await idGenerator.generateNextIds({ table: "users", count: 100 });
   * // ids[0] is the first id, ids[99] the last; getLastId("users") === ids[99]
   * ```
   */
  public async generateNextIds(
    options: GenerateIdOptions & { count: number },
  ): Promise<number[]> {
    const { table, initialId = 1, incrementIdBy = 1, count } = options;

    if (count <= 0) {
      return [];
    }

    await this.ensureIndexes();

    const lastId = await this.reserveBlock(table, initialId, incrementIdBy, count);
    const firstId = lastId - (count - 1) * incrementIdBy;

    return Array.from({ length: count }, (_, index) => firstId + index * incrementIdBy);
  }

  /**
   * Atomically advance the counter for `table` by a whole block and return the
   * block's LAST id.
   *
   * One `findOneAndUpdate` with an aggregation pipeline:
   * - **Cold start** (counter field missing or null): seed `initialId + (count - 1) * incrementIdBy`
   *   so the FIRST id of the block equals `initialId` (the `count - 1` here vs
   *   `count` in the steady-state branch is deliberate — the counter stores the
   *   last-issued id and the very first id must be exactly `initialId`).
   * - **Steady state**: add `count * incrementIdBy` to the stored counter.
   *
   * Retries on a duplicate-key error from the cold-start upsert race (see
   * {@link isDuplicateKeyError}).
   *
   * @param table - The table/collection the block is for
   * @param initialId - The first id ever issued for this table
   * @param incrementIdBy - The fixed stride between ids
   * @param count - Block size (`>= 1`)
   * @returns The last id of the reserved block
   */
  private async reserveBlock(
    table: string,
    initialId: number,
    incrementIdBy: number,
    count: number,
  ): Promise<number> {
    const run = async (): Promise<number> => {
      const database = this.driver.getDatabase();
      const collection = database.collection(this.counterCollection);

      const result = await collection.findOneAndUpdate(
        { collection: table },
        [
          {
            $set: {
              id: {
                $cond: {
                  // Cold start = the counter field is absent or null. Tested by
                  // existence ($type), NOT truthiness — a legitimately stored
                  // last-id of 0 (initialId: 0) must take the increment branch,
                  // not be mistaken for an unset counter and re-issued.
                  if: {
                    $or: [{ $eq: [{ $type: "$id" }, "missing"] }, { $eq: ["$id", null] }],
                  },
                  then: initialId + (count - 1) * incrementIdBy,
                  else: { $add: ["$id", count * incrementIdBy] },
                },
              },
              collection: table,
            },
          },
        ],
        {
          upsert: true,
          returnDocument: "after",
        },
      );

      const lastId = result?.id;

      if (typeof lastId !== "number") {
        throw new Error(
          `Failed to reserve an id block for "${table}": counter returned no id.`,
        );
      }

      return lastId;
    };

    return await this.withDuplicateKeyRetry(run);
  }

  /**
   * Run `operation`, retrying on a duplicate-key (E11000) error up to
   * {@link MAX_RESERVE_ATTEMPTS} times. Only the cold-start upsert race throws
   * E11000 (once the unique index exists); on retry the counter document
   * already exists, so the increment branch runs and succeeds. Any other error
   * is rethrown immediately.
   *
   * @param operation - The reservation to run
   * @returns The operation's result
   */
  private async withDuplicateKeyRetry<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RESERVE_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw lastError;
  }

  /**
   * Ensure the unique index on `{ collection: 1 }` exists (once per instance).
   *
   * Best-effort: a pre-existing duplicate counter document (created before this
   * index existed) makes index creation fail with E11000. We swallow that
   * rather than block app boot — without the index the generator degrades to
   * its prior (un-indexed) behavior, and the retry path becomes a no-op since
   * E11000 can no longer be raised by the upsert.
   */
  private async ensureIndexes(): Promise<void> {
    if (!this.indexEnsured) {
      this.indexEnsured = this.createCounterIndex();
    }

    return await this.indexEnsured;
  }

  /**
   * Create the unique index on the counter collection's `collection` field.
   * Failures are swallowed (see {@link ensureIndexes}).
   */
  private async createCounterIndex(): Promise<void> {
    try {
      const database = this.driver.getDatabase();
      await database.collection(this.counterCollection).createIndex(
        { collection: 1 },
        { unique: true, name: "collection_unique" },
      );
    } catch {
      // Best-effort — see ensureIndexes(). Degrade gracefully without the index.
    }
  }

  /**
   * Get the last generated ID for a table.
   *
   * @param table - The table/collection name
   * @returns The last generated ID, or 0 if none exists
   */
  public async getLastId(table: string): Promise<number> {
    const query = this.driver.queryBuilder(this.counterCollection);
    const doc = (await query.where("collection", table).first()) as Record<string, unknown> | null;
    return (doc?.id as number) ?? 0;
  }

  /**
   * Set the last ID for a table.
   *
   * Creates or updates the counter document for the specified table. Useful for
   * seeding or resetting ID sequences.
   *
   * @param table - The table/collection name
   * @param id - The ID to set as the last generated ID
   *
   * @example
   * ```typescript
   * // Reset user IDs to start from 1000 (next generated id is 1001)
   * await idGenerator.setLastId("users", 1000);
   * ```
   */
  public async setLastId(table: string, id: number): Promise<void> {
    await this.driver.update(
      this.counterCollection,
      { collection: table },
      { $set: { id, collection: table } },
      { upsert: true },
    );
  }
}
