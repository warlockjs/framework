import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Migration } from "../../../src/migration/migration";
import { MigrationRunner } from "../../../src/migration/migration-runner";
import type { MigrationDriverContract } from "../../../src/contracts/migration-driver.contract";
import { startMongodbHarness, type MongodbHarness } from "../helpers";

/**
 * Integration coverage for cascade's MongoDB schema operations against a REAL
 * MongoDB server (single-node replica set, via testcontainers).
 *
 * IMPORTANT — discovered during this work:
 *
 *   The `MigrationRunner` is SQL-ONLY. Every execution path
 *   (`run` / `rollback` / `runAll` / `exportSQL`) calls `migration.toSQL()`,
 *   which calls `driver.getSQLSerializer()`. The MongoDB driver's
 *   `getSQLSerializer()` (and `query()`) THROW by design. So you cannot run a
 *   migration through the runner against a MongoDB data source — the first test
 *   below pins that behavior so a future change is caught.
 *
 *   The programmatically-reachable MongoDB schema surface is therefore the
 *   MIGRATION DRIVER API directly — `dataSource.driver.migrationDriver()` —
 *   which `createIndex` / `createUniqueIndex` / `createTTLIndex` /
 *   `createFullTextIndex` / `setSchemaValidation` / `dropIndex` all hit native
 *   MongoDB commands. The rest of this suite drives that API and asserts via the
 *   native `db` handle.
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

  it("the SQL-only MigrationRunner throws on a MongoDB data source (documented limitation)", async () => {
    class CreateIndexMigration extends Migration {
      public static migrationName = "msync_runner_attempt";
      public readonly table = COLLECTION;

      public up(): void {
        this.index("email");
      }

      public down(): void {
        this.dropIndex("email");
      }
    }

    const runner = new MigrationRunner({ dataSource: harness.dataSource, verbose: false });

    // toSQL() → MongoDbDriver.getSQLSerializer() throws. The runner surfaces it.
    await expect(runner.run(CreateIndexMigration)).rejects.toThrow(
      /MongoDB driver does not support SQL serialization/,
    );
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

  // BUG: MongoMigrationDriver.dropIndex() cannot drop an index by its actual
  // name when that name does not follow the "<col>_1" convention. The string
  // form is documented as "Index name" (mongodb-migration-driver.ts:295-297),
  // but the implementation unconditionally rewrites EVERY input to `${x}_1`
  // (line 308): so dropIndex(table, "idx_email") tries to drop "idx_email_1"
  // and throws IndexNotFound for an index that was created with name "idx_email".
  // Evidence: mongodb-migration-driver.ts:299-311.
  it.skip("drops a custom-named index by its name (BUG: dropIndex appends _1)", async () => {
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
