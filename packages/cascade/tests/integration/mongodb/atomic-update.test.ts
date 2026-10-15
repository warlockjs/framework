import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UnsafeFilterError } from "../../../src/errors/unsafe-filter.error";
import { Model } from "../../../src/model/model";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * Atomic update options against a REAL mongod: upsert, returnDocument,
 * `$setOnInsert` / `$addToSet` / `$dec`, `arrayFilters`, pipeline (array-form)
 * updates, and the concurrency guarantee behind quota reservations.
 *
 * Skipped when LOCAL_MONGO_URI / LOCAL_MONGO_DATABASE are not configured.
 */

const suite = hasLocalMongodb() ? describe : describe.skip;

const COUNTERS = "atomic_counters";
const QUOTAS = "atomic_quotas";
const POSTS = "atomic_posts";

class Counter extends Model {
  public static table = COUNTERS;
}

class Quota extends Model {
  public static table = QUOTAS;
}

class Post extends Model {
  public static table = POSTS;
}

suite("MongoDB atomic updates — options and operators", () => {
  let harness: LocalMongodbHarness;

  beforeAll(async () => {
    harness = await startLocalMongodbHarness();
  });

  afterAll(async () => {
    await harness.dropCollections(COUNTERS, QUOTAS, POSTS);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.dropCollections(COUNTERS, QUOTAS, POSTS);
  });

  it("upserts with $inc + $setOnInsert and returns the new document in one call", async () => {
    const first = await Counter.findOneAndUpdate(
      { key: "signups" },
      { $inc: { count: 1 }, $setOnInsert: { createdBy: "seed" } },
      { upsert: true },
    );

    expect(first?.get("count")).toBe(1);
    expect(first?.get("createdBy")).toBe("seed");

    const second = await Counter.findOneAndUpdate(
      { key: "signups" },
      { $inc: { count: 1 }, $setOnInsert: { createdBy: "other" } },
      { upsert: true },
    );

    expect(second?.get("count")).toBe(2);
    expect(second?.get("createdBy")).toBe("seed");
    expect(await harness.db.collection(COUNTERS).countDocuments()).toBe(1);
  });

  it("returnDocument defaults to after and honours before", async () => {
    await harness.db.collection(COUNTERS).insertOne({ key: "a", count: 5 });

    const after = await Counter.findOneAndUpdate({ key: "a" }, { $inc: { count: 1 } });
    expect(after?.get("count")).toBe(6);

    const before = await Counter.findOneAndUpdate(
      { key: "a" },
      { $inc: { count: 1 } },
      { returnDocument: "before" },
    );
    expect(before?.get("count")).toBe(6);
  });

  it("atomic upsert counts the inserted document", async () => {
    const affected = await Counter.atomic({ key: "new" }, { $inc: { count: 3 } }, { upsert: true });

    expect(affected).toBe(1);

    const stored = await harness.db.collection(COUNTERS).findOne({ key: "new" });
    expect(stored?.count).toBe(3);
  });

  it("$dec decrements (translated to a negative $inc)", async () => {
    await harness.db.collection(COUNTERS).insertOne({ key: "d", count: 10 });

    const updated = await Counter.findOneAndUpdate({ key: "d" }, { $dec: { count: 4 } });

    expect(updated?.get("count")).toBe(6);
  });

  it("applies an aggregation-pipeline update atomically", async () => {
    await harness.db.collection(POSTS).insertOne({ slug: "p", likes: 3, shares: 4 });

    const updated = await Post.findOneAndUpdate({ slug: "p" }, [
      { $set: { score: { $add: ["$likes", "$shares"] } } },
    ]);

    expect(updated?.get("score")).toBe(7);
  });

  it("$addToSet adds only missing members", async () => {
    await harness.db.collection(POSTS).insertOne({ slug: "t", tags: ["a"] });

    await Post.atomic({ slug: "t" }, { $addToSet: { tags: "a" } });
    await Post.atomic({ slug: "t" }, { $addToSet: { tags: "b" } });

    const stored = await harness.db.collection(POSTS).findOne({ slug: "t" });
    expect(stored?.tags).toEqual(["a", "b"]);
  });

  it("arrayFilters target matching array elements", async () => {
    await harness.db.collection(POSTS).insertOne({
      slug: "g",
      grades: [{ score: 40 }, { score: 90 }, { score: 30 }],
    });

    await Post.atomic(
      { slug: "g" },
      { $set: { "grades.$[low].score": 50 } },
      { arrayFilters: [{ "low.score": { $lt: 50 } }] },
    );

    const stored = await harness.db.collection(POSTS).findOne({ slug: "g" });
    expect(stored?.grades).toEqual([{ score: 50 }, { score: 90 }, { score: 50 }]);
  });

  it("keeps rejecting operator filters unless trustedFilter is set", async () => {
    await harness.db.collection(QUOTAS).insertOne({ id: 1, used: 0 });

    await expect(Quota.atomic({ id: 1, used: { $lt: 10 } }, { $inc: { used: 1 } })).rejects.toThrow(
      UnsafeFilterError,
    );

    const affected = await Quota.atomic(
      { id: 1, used: { $lt: 10 } },
      { $inc: { used: 1 } },
      { trustedFilter: true },
    );
    expect(affected).toBe(1);
  });

  it("50 parallel atomic reservations against a limit of 10 — exactly 10 succeed", async () => {
    await harness.db.collection(QUOTAS).insertOne({ id: 1, used: 0 });

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        Quota.atomic({ id: 1, used: { $lt: 10 } }, { $inc: { used: 1 } }, { trustedFilter: true }),
      ),
    );

    expect(results.filter((affected) => affected === 1)).toHaveLength(10);

    const stored = await harness.db.collection(QUOTAS).findOne({ id: 1 });
    expect(stored?.used).toBe(10);
  });

  it("50 parallel findOneAndUpdate reservations — exactly 10 documents returned", async () => {
    await harness.db.collection(QUOTAS).insertOne({ id: 2, used: 0 });

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        Quota.findOneAndUpdate(
          { id: 2, used: { $lt: 10 } },
          { $inc: { used: 1 } },
          { trustedFilter: true },
        ),
      ),
    );

    const granted = results.filter((quota) => quota !== null);
    expect(granted).toHaveLength(10);
    expect(granted.map((quota) => quota!.get("used")).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);

    const stored = await harness.db.collection(QUOTAS).findOne({ id: 2 });
    expect(stored?.used).toBe(10);
  });
});
