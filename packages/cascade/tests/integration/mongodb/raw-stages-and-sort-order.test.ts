import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedQueryOperationError } from "../../../src/errors/unsupported-query-operation.error";
import { Model } from "../../../src/model/model";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * `joinRaw()` / `raw()` stages, and `select()` + `orderBy()` on an unselected
 * field, against a REAL mongod.
 *
 * Skipped when LOCAL_MONGO_URI / LOCAL_MONGO_DATABASE are not configured.
 */

const suite = hasLocalMongodb() ? describe : describe.skip;

const POSTS = "raw_stage_posts";
const COMMENTS = "raw_stage_comments";

class RawStagePost extends Model {
  public static table = POSTS;
}

suite("MongoDB raw stages and select/sort ordering", () => {
  let harness: LocalMongodbHarness;

  beforeAll(async () => {
    harness = await startLocalMongodbHarness();
  });

  afterAll(async () => {
    await harness.dropCollections(POSTS, COMMENTS);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.dropCollections(POSTS, COMMENTS);
    // Insertion order deliberately differs from every sort order asserted below.
    await harness.db.collection(POSTS).insertMany([
      { id: 3, title: "three", likes: 1, shares: 9 },
      { id: 1, title: "one", likes: 3, shares: 4 },
      { id: 4, title: "four", likes: 0, shares: 0 },
      { id: 2, title: "two", likes: 10, shares: 0 },
    ]);
    await harness.db.collection(COMMENTS).insertMany([
      { postId: 1, body: "a", approved: true },
      { postId: 1, body: "b", approved: false },
      { postId: 2, body: "c", approved: true },
    ]);
  });

  describe("joinRaw()", () => {
    it("runs a raw $lookup stage in call order", async () => {
      const rows = await RawStagePost.query()
        .whereIn("id", [1, 2])
        .joinRaw({
          $lookup: {
            from: COMMENTS,
            let: { postId: "$id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$postId", "$$postId"] }, approved: true } },
              { $project: { _id: 0, body: 1 } },
            ],
            as: "approved",
          },
        })
        .orderBy("id")
        .lean()
        .get();

      expect(rows.map((row) => [row.id, row.approved])).toEqual([
        [1, [{ body: "a" }]],
        [2, [{ body: "c" }]],
      ]);
    });

    it("accepts an array of stages", async () => {
      const rows = await RawStagePost.query()
        .joinRaw([
          { $lookup: { from: COMMENTS, localField: "id", foreignField: "postId", as: "comments" } },
          { $addFields: { commentsCount: { $size: "$comments" } } },
        ])
        .orderBy("id")
        .lean()
        .get();

      expect(rows.map((row) => [row.id, row.commentsCount])).toEqual([
        [1, 2],
        [2, 1],
        [3, 0],
        [4, 0],
      ]);
    });

    it("throws UnsupportedQueryOperationError for a SQL string", () => {
      expect(() => RawStagePost.query().joinRaw("LEFT JOIN comments ON 1 = 1")).toThrow(
        UnsupportedQueryOperationError,
      );
    });
  });

  describe("raw()", () => {
    it("receives the pipeline built so far and its returned pipeline is executed", async () => {
      const rows = await RawStagePost.query()
        .raw((pipeline) => [...(pipeline as object[]), { $match: { likes: { $gte: 3 } } }])
        .orderBy("id")
        .lean()
        .get();

      expect(rows.map((row) => row.id)).toEqual([1, 2]);
    });

    it("keeps an in-place mutation when the callback returns nothing", async () => {
      const count = await RawStagePost.query()
        .raw((pipeline) => {
          (pipeline as object[]).push({ $match: { shares: 0 } });
        })
        .count();

      expect(count).toBe(2);
    });
  });

  describe("select() then orderBy() on an unselected field", () => {
    it("sorts hydrated reads", async () => {
      const rows = await RawStagePost.query().select(["title"]).orderBy("likes", "desc").get();

      expect(rows.map((post) => post.get("title"))).toEqual(["two", "one", "three", "four"]);
      expect(rows[0]?.get("likes")).toBeUndefined();
    });

    it("sorts lean reads, first(), paginate() and keeps count()", async () => {
      const query = () => RawStagePost.query().select(["title"]).orderBy("shares", "desc");

      expect((await query().lean().get()).map((row) => row.title)).toEqual([
        "three",
        "one",
        // shares tie at 0 → the secondary order is not asserted
        expect.any(String),
        expect.any(String),
      ]);
      expect((await query().first())?.get("title")).toBe("three");

      const page = await query().orderBy("id").paginate({ page: 2, limit: 2 });
      expect(page.data.map((post) => post.get("title"))).toEqual(["two", "four"]);
      expect(page.pagination.total).toBe(4);
      expect(await query().count()).toBe(4);
    });

    it("still sorts by a computed select alias, alone or mixed with an unselected field", async () => {
      const byAlias = await RawStagePost.query()
        .select(["title"])
        .selectRaw({ score: { $add: ["$likes", "$shares"] } })
        .orderBy("score", "desc")
        .lean()
        .get();

      expect(byAlias.map((row) => row.score)).toEqual([10, 10, 7, 0]);

      const mixed = await RawStagePost.query()
        .select(["title"])
        .selectRaw({ score: { $add: ["$likes", "$shares"] } })
        .orderBy("score", "desc")
        .orderBy("likes", "desc")
        .lean()
        .get();

      expect(mixed.map((row) => [row.title, row.score])).toEqual([
        ["two", 10],
        ["three", 10],
        ["one", 7],
        ["four", 0],
      ]);
      expect(mixed[0]?.likes).toBeUndefined();
    });
  });
});
