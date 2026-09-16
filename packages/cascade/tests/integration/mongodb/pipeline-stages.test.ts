import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * Public aggregation stages against a REAL mongod: `unwind()` (short and
 * document form), `addFields()`, and pipeline-form `join()`.
 *
 * Skipped when LOCAL_MONGO_URI / LOCAL_MONGO_DATABASE are not configured.
 */

const suite = hasLocalMongodb() ? describe : describe.skip;

const POSTS = "stage_posts";
const COMMENTS = "stage_comments";

class StagePost extends Model {
  public static table = POSTS;
}

suite("MongoDB public pipeline stages", () => {
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
    await harness.db.collection(POSTS).insertMany([
      { id: 1, title: "one", tags: ["news", "tech"], likes: 3, shares: 4 },
      { id: 2, title: "two", tags: ["tech"], likes: 10, shares: 0 },
      { id: 3, title: "three", tags: [], likes: 1, shares: 1 },
      { id: 4, title: "four", likes: 0, shares: 0 },
    ]);
    await harness.db.collection(COMMENTS).insertMany([
      { postId: 1, body: "a", approved: true },
      { postId: 1, body: "b", approved: false },
      { postId: 2, body: "c", approved: true },
    ]);
  });

  it("unwind() emits one document per array element, and a later where filters elements", async () => {
    const rows = await StagePost.query().unwind("tags").orderBy("id").lean().get();

    expect(rows.map((row) => [row.id, row.tags])).toEqual([
      [1, "news"],
      [1, "tech"],
      [2, "tech"],
    ]);

    const tech = await StagePost.query().unwind("tags").where("tags", "tech").lean().get();
    expect(tech.map((row) => row.id).sort()).toEqual([1, 2]);
  });

  it("unwind() options keep empty/missing arrays and record the element index", async () => {
    const rows = await StagePost.query()
      .unwind("tags", { preserveNullAndEmptyArrays: true, includeArrayIndex: "tagIndex" })
      .orderBy("id")
      .lean()
      .get();

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => [row.id, row.tagIndex])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
      [3, null],
      [4, null],
    ]);
  });

  it("addFields() adds a computed field that later stages can sort on", async () => {
    const rows = await StagePost.query()
      .addFields({ score: { $add: ["$likes", "$shares"] } })
      .orderBy("score", "desc")
      .limit(2)
      .get();

    expect(rows.map((post) => [post.get("id"), post.get("score")])).toEqual([
      [2, 10],
      [1, 7],
    ]);
    // Existing fields are kept.
    expect(rows[0]?.get("title")).toBe("two");
  });

  it("join() with a pipeline runs a pipeline $lookup", async () => {
    const rows = await StagePost.query()
      .where("id", 1)
      .join({
        table: COMMENTS,
        localField: "id",
        foreignField: "postId",
        alias: "approvedComments",
        pipeline: [{ $match: { approved: true } }, { $project: { _id: 0, body: 1 } }],
      })
      .lean()
      .get();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.approvedComments).toEqual([{ body: "a" }]);
  });
});
