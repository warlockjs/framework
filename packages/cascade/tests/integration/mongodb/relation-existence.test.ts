import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RelComment, RelPost, RelUser } from "../fixtures/relations/models";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * Relation existence filters and relation counts (`$lookup` pipelines) against a
 * REAL MongoDB server. Touches only the `rel_*` collections. Skipped when
 * LOCAL_MONGO_* is not configured.
 */
const suite = hasLocalMongodb() ? describe : describe.skip;

const COLS = ["rel_users", "rel_posts", "rel_comments", "rel_roles", "MasterMind"];

suite("MongoDB relation existence filters", () => {
  let harness: LocalMongodbHarness;

  beforeAll(async () => {
    harness = await startLocalMongodbHarness();
    await harness.dropCollections(...COLS);
    const a = await RelUser.create({ name: "A" });
    const b = await RelUser.create({ name: "B" });
    await RelUser.create({ name: "C" });
    const p1 = await RelPost.create({ title: "p1", rel_user_id: a.id });
    await RelPost.create({ title: "p2", rel_user_id: a.id });
    await RelPost.create({ title: "p3", rel_user_id: b.id });
    await RelComment.create({ body: "c", rel_post_id: p1.id });
  });

  afterAll(async () => {
    await harness.dropCollections(...COLS);
    await harness.stop();
  });

  it("has / doesntHave / whereHas / withCount on hasMany", async () => {
    const withPosts = await RelUser.query().has("posts").orderBy("id").get();
    expect(withPosts.map((u) => u.get("name"))).toEqual(["A", "B"]);

    const without = await RelUser.query().doesntHave("posts").get();
    expect(without.map((u) => u.get("name"))).toEqual(["C"]);

    const where = await RelUser.query()
      .whereHas("posts", (q: any) => q.where("title", "p3"))
      .get();
    expect(where.map((u) => u.get("name"))).toEqual(["B"]);

    const counted = await RelUser.query().withCount("posts").orderBy("id").get();
    expect(counted.map((u) => u.get("postsCount"))).toEqual([2, 1, 0]);

    const belongs = await RelPost.query()
      .whereHas("author", (q: any) => q.where("name", "B"))
      .get();
    expect(belongs.map((p) => p.get("title"))).toEqual(["p3"]);

    const both = await RelUser.query().has("posts").where("name", "A").get();
    expect(both).toHaveLength(1);
  });
});
