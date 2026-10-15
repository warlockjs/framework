import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import type { MigrationDriverContract } from "../../../src/contracts/migration-driver.contract";
import { startMongodbHarness, type MongodbHarness } from "../helpers";

/**
 * Integration coverage for cascade's MongoDB schema operations against a REAL
 * MongoDB server (single-node replica set, via testcontainers).
 *
 * The `MigrationRunner` detects drivers without SQL serialization
 * (`driver.supportsSqlSerialization === false`) and executes each migration's
 * pending operations DIRECTLY through the migration driver instead of
 * `migration.toSQL()` — the first test below covers that path end to end
 * (run creates the index, rollback drops it). `exportSQL` stays SQL-only and
 * throws a clear unsupported error on MongoDB.
 *
 * The rest of this suite drives the MIGRATION DRIVER API directly —
 * `dataSource.driver.migrationDriver()` — which `createIndex` /
 * `createUniqueIndex` / `createTTLIndex` / `createFullTextIndex` /
 * `setSchemaValidation` / `dropIndex` all hit native MongoDB commands,
 * asserting via the native `db` handle.
 *
 * Collections are namespaced `msync_*` to stay isolated from the CRUD suite.
 */

const COLLECTION = "msync_widgets";

/** Convenience accessor for the live migration driver under test. */
function migrationDriverOf(harness: MongodbHarness): MigrationDriverContract {
  return harness.driver.migrationDriver();
}

describe("MongoDB integration — schema operations (migration driver)", () => {
  let harness: MongodbHarness;

  beforeAll(async () => {
    harness = await startMongodbHarness();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.dropCollections(COLLECTION);
    // Collection must exist before createIndex/collMod on a fresh slate.
    await harness.db.createCollection(COLLECTION).catch(() => undefined);
  });

  /** Read live indexes for the collection, keyed by index name. */
  async function getIndexes(collection: string): Promise<
    Map<string, { key: Record<string, unknown>; unique?: boolean; expireAfterSeconds?: number }>
  > {
    const indexes = await harness.db.collection(collection).indexes();
    return new Map(
      indexes.map((index) => [
        index.name ?? "",
        {
          key: index.key as Record<string, unknown>,
          unique: index.unique,
          expireAfterSeconds: index.expireAfterSeconds,
        },
      ]),
    );
  }

  it("the MigrationRunner executes migrations on a MongoDB data source via the migration driver", async () => {
    class CreateIndexMigration extends Migration {
      public static migrationName = "msync_runner_attempt";
      public readonly table = COLLECTION;

      public up(): void {
        this.index("email", "msync_runner_idx");
      }

      public down(): void {
        // string form = index name (array form = columns)
        this.dropIndex("msync_runner_idx");
      }
    }

    const runner = new MigrationRunner({ dataSource: harness.dataSource, verbose: false });

    // supportsSqlSerialization === false → the runner executes the queued
    // operations directly through the migration driver instead of toSQL().
    const upResult = await runner.run(CreateIndexMigration);
    expect(upResult.success).toBe(true);

    let indexes = await getIndexes(COLLECTION);
    expect(indexes.has("msync_runner_idx")).toBe(true);

    const downResult = await runner.rollback(CreateIndexMigration);
    expect(downResult.success).toBe(true);

    indexes = await getIndexes(COLLECTION);
    expect(indexes.has("msync_runner_idx")).toBe(false);
  });

  it("exportSQL stays SQL-only and throws a clear unsupported error on MongoDB", async () => {
    class NoopMigration extends Migration {
      public static migrationName = "msync_export_attempt";
      public readonly table = COLLECTION;

      public up(): void {
        this.index("email", "msync_export_idx");
      }

      public down(): void {
        this.dropIndex("msync_export_idx");
      }
    }

    const runner = new MigrationRunner({ dataSource: harness.dataSource, verbose: false });
    runner.register(NoopMigration);

    await expect(runner.exportSQL()).rejects.toThrow(/SQL export is not supported/);
  });

  it("creates a regular index and drops it by columns", async () => {
    const driver = migrationDriverOf(harness);

    // No custom name → MongoDB auto-names it "email_1". dropIndex() resolves the
    // columns form to that same "<col>_1" name, so this round-trips cleanly.
    await driver.createIndex(COLLECTION, { columns: ["email"] });

    let indexes = await getIndexes(COLLECTION);
    expect(indexes.has("email_1")).toBe(true);
    expect(indexes.get("email_1")!.key).toMatchObject({ email: 1 });
    expect(indexes.get("email_1")!.unique).toBeFalsy();

    await driver.dropIndex(COLLECTION, ["email"]);

    indexes = await getIndexes(COLLECTION);
    expect(indexes.has("email_1")).toBe(false);
  });

  // dropIndex()'s string form is the literal index name (passed through
  // untouched); only the columns-array form resolves to the "<col>_1"
  // convention name.
  it("drops a custom-named index by its name", async () => {
    const driver = migrationDriverOf(harness);

    await driver.createIndex(COLLECTION, { columns: ["email"], name: "idx_email" });

    let indexes = await getIndexes(COLLECTION);
    expect(indexes.has("idx_email")).toBe(true);

    await driver.dropIndex(COLLECTION, "idx_email");

    indexes = await getIndexes(COLLECTION);
    expect(indexes.has("idx_email")).toBe(false);
  });

  it("creates a unique index that the database actually enforces", async () => {
    const driver = migrationDriverOf(harness);

    await driver.createUniqueIndex(COLLECTION, ["sku"], "uq_sku");

    const indexes = await getIndexes(COLLECTION);
    expect(indexes.get("uq_sku")!.unique).toBe(true);

    // The constraint is real: a duplicate sku is rejected by the server.
    await harness.db.collection(COLLECTION).insertOne({ sku: "ABC", id: 1 });

    await expect(
      harness.db.collection(COLLECTION).insertOne({ sku: "ABC", id: 2 }),
    ).rejects.toThrow();
  });

  it("creates a multi-column index in declaration order", async () => {
    const driver = migrationDriverOf(harness);

    await driver.createIndex(COLLECTION, {
      columns: ["organization_id", "created_at"],
      name: "idx_org_created",
    });

    const indexes = await getIndexes(COLLECTION);
    const key = indexes.get("idx_org_created")!.key;

    expect(Object.keys(key)).toEqual(["organization_id", "created_at"]);
  });

  it("creates a TTL index with the configured expiry", async () => {
    const driver = migrationDriverOf(harness);

    await driver.createTTLIndex(COLLECTION, "created_at", 3600);

    const indexes = await getIndexes(COLLECTION);
    const ttl = [...indexes.values()].find((index) => index.expireAfterSeconds !== undefined);

    expect(ttl).toBeDefined();
    expect(ttl!.expireAfterSeconds).toBe(3600);
    expect(ttl!.key).toMatchObject({ created_at: 1 });
  });

  it("creates a full-text index", async () => {
    const driver = migrationDriverOf(harness);

    await driver.createFullTextIndex(COLLECTION, ["title", "body"], { name: "ft_title_body" });

    const indexes = await getIndexes(COLLECTION);
    // MongoDB text indexes carry a special _fts/_ftsx key shape.
    const textIndex = indexes.get("ft_title_body");
    expect(textIndex).toBeDefined();
    expect(textIndex!.key).toMatchObject({ _fts: "text" });
  });

  it("applies JSON schema validation that the server enforces, then removes it", async () => {
    const driver = migrationDriverOf(harness);

    await driver.setSchemaValidation(COLLECTION, {
      bsonType: "object",
      required: ["name"],
      properties: {
        name: { bsonType: "string" },
      },
    });

    // A document violating the validator is rejected.
    await expect(
      harness.db.collection(COLLECTION).insertOne({ id: 1, name: 123 } as never),
    ).rejects.toThrow();

    // A conforming document is accepted.
    await harness.db.collection(COLLECTION).insertOne({ id: 2, name: "ok" });

    // Removing validation lets the previously-rejected shape through.
    await driver.removeSchemaValidation(COLLECTION);
    await harness.db.collection(COLLECTION).insertOne({ id: 3, name: 999 } as never);

    const count = await harness.db.collection(COLLECTION).countDocuments();
    expect(count).toBe(2 + 1 - 1); // (id:2 accepted) + (id:3 accepted) ; id:1 was rejected
  });

  it("is idempotent: re-creating the same index does not error or duplicate", async () => {
    const driver = migrationDriverOf(harness);

    await driver.createIndex(COLLECTION, { columns: ["status"], name: "idx_status" });
    await driver.createIndex(COLLECTION, { columns: ["status"], name: "idx_status" });

    const indexes = await getIndexes(COLLECTION);
    const statusIndexes = [...indexes.keys()].filter((name) => name === "idx_status");

    expect(statusIndexes).toHaveLength(1);
  });

  it("renames a field across all documents (driver renameColumn → $rename)", async () => {
    const driver = migrationDriverOf(harness);

    await harness.db.collection(COLLECTION).insertMany([
      { id: 1, old_name: "a" },
      { id: 2, old_name: "b" },
    ]);

    await driver.renameColumn(COLLECTION, "old_name", "new_name");

    const docs = await harness.db
      .collection<{ id: number; new_name?: string; old_name?: string }>(COLLECTION)
      .find()
      .sort({ id: 1 })
      .toArray();

    expect(docs.every((doc) => doc.new_name !== undefined && doc.old_name === undefined)).toBe(true);
  });
});
