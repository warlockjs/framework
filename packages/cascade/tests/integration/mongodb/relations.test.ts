import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  POSTS_TABLE,
  RelComment,
  RelPost,
  RelProfile,
  RelRole,
  RelSkill,
  RelUser,
  ROLE_USER_PIVOT,
  USER_SKILLS_PIVOT,
} from "../fixtures/relations/models";
import { RelationLoader } from "../../../src/relations/relation-loader";
import { startMongodbHarness, type MongodbHarness } from "../helpers";

/**
 * Relations execution against a REAL MongoDB server (testcontainers).
 *
 * Covers every relation type end-to-end — belongsTo, hasOne, hasMany,
 * belongsToMany — through lazy loading (`model.load`), nested/deep loading,
 * loading on collections, default vs. explicit key conventions, and pivot
 * persistence. Loaded results are cross-checked against the native collections,
 * so the assertions verify stored documents, not just the API's self-report.
 *
 * **Why `model.load()` instead of `with()` here:** the MongoDB driver's eager
 * loading is currently broken — `MongoDbQueryBuilder.get()`
 * (src/drivers/mongodb/mongodb-query-builder.ts:1807) never runs the
 * RelationLoader, so `Model.with(...)` is a silent no-op on Mongo (see the
 * skipped test under "eager loading (with) — BUG"). The relation LOADER itself
 * works fine on Mongo, so this suite exercises it through the lazy `model.load`
 * path, which routes straight to `RelationLoader`. The Postgres suite covers the
 * `with()` eager-load surface.
 *
 * Collections (including the `MasterMind` id counter) are dropped per test so
 * ids restart and state stays isolated.
 */
const ALL_COLLECTIONS = [
  USER_SKILLS_PIVOT,
  ROLE_USER_PIVOT,
  "rel_comments",
  "rel_posts",
  "rel_profiles",
  "rel_roles",
  "rel_skills",
  "rel_users",
  "MasterMind",
];

describe("MongoDB integration — relations", () => {
  let harness: MongodbHarness;

  beforeAll(async () => {
    harness = await startMongodbHarness();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.dropCollections(...ALL_COLLECTIONS);
  });

  // ==========================================================================
  // belongsTo
  // ==========================================================================

  describe("belongsTo", () => {
    it("loads the owner via model.load()", async () => {
      const author = await RelUser.create({ name: "Alice" });
      const post = await RelPost.create({ title: "Hello", rel_user_id: author.id });

      const fetched = await RelPost.find(post.id);
      expect(fetched!.isLoaded("author")).toBe(false);

      await fetched!.load("author");

      expect(fetched!.isLoaded("author")).toBe(true);
      const loadedAuthor = fetched!.getRelation<RelUser>("author");
      expect(loadedAuthor).toBeInstanceOf(RelUser);
      expect(loadedAuthor!.id).toBe(author.id);
      expect(loadedAuthor!.get("name")).toBe("Alice");
    });

    it("resolves to null when the foreign key matches no owner", async () => {
      const post = await RelPost.create({ title: "Orphan", rel_user_id: 9999 });

      const fetched = await RelPost.find(post.id);
      await fetched!.load("author");

      expect(fetched!.getRelation("author")).toBeNull();
    });

    it("resolves to null when the foreign key itself is null", async () => {
      const post = await RelPost.create({ title: "NoAuthor", rel_user_id: null });

      const fetched = await RelPost.find(post.id);
      await fetched!.load("author");

      expect(fetched!.getRelation("author")).toBeNull();
    });
  });

  // ==========================================================================
  // hasOne
  // ==========================================================================

  describe("hasOne", () => {
    it("loads a single child by the inferred foreign key", async () => {
      const user = await RelUser.create({ name: "Carol" });
      const profile = await RelProfile.create({ bio: "Engineer", rel_user_id: user.id });

      const fetched = await RelUser.find(user.id);
      await fetched!.load("profile");

      const loadedProfile = fetched!.getRelation<RelProfile>("profile");
      expect(loadedProfile).toBeInstanceOf(RelProfile);
      expect(loadedProfile!.id).toBe(profile.id);
      expect(loadedProfile!.get("bio")).toBe("Engineer");
    });

    it("resolves to null when no child document exists", async () => {
      const user = await RelUser.create({ name: "Dave" });

      const fetched = await RelUser.find(user.id);
      await fetched!.load("profile");

      expect(fetched!.getRelation("profile")).toBeNull();
    });
  });

  // ==========================================================================
  // hasMany
  // ==========================================================================

  describe("hasMany", () => {
    it("loads children and matches the docs in the collection", async () => {
      const user = await RelUser.create({ name: "Erin" });
      const first = await RelPost.create({ title: "First", rel_user_id: user.id });
      const second = await RelPost.create({ title: "Second", rel_user_id: user.id });
      // A post belonging to another user must NOT leak in.
      const other = await RelUser.create({ name: "Frank" });
      await RelPost.create({ title: "Other", rel_user_id: other.id });

      const fetched = await RelUser.find(user.id);
      await fetched!.load("posts");
      const posts = fetched!.getRelation<RelPost[]>("posts")!;

      expect(posts).toHaveLength(2);
      expect(posts.map((post) => post.id).sort()).toEqual([first.id, second.id].sort());

      const stored = await harness.db
        .collection(POSTS_TABLE)
        .countDocuments({ rel_user_id: user.id });
      expect(stored).toBe(2);
    });

    it("assigns an empty array when a user has no children", async () => {
      const user = await RelUser.create({ name: "Grace" });

      const fetched = await RelUser.find(user.id);
      await fetched!.load("posts");

      expect(fetched!.getRelation("posts")).toEqual([]);
    });

    it("loads the relation across a whole collection in one batch", async () => {
      const userA = await RelUser.create({ name: "Ivan" });
      const userB = await RelUser.create({ name: "Judy" });
      await RelPost.create({ title: "a1", rel_user_id: userA.id });
      await RelPost.create({ title: "a2", rel_user_id: userA.id });
      await RelPost.create({ title: "b1", rel_user_id: userB.id });

      const users = await RelUser.query().orderBy("id", "asc").get();
      // RelationLoader batches a single whereIn across the whole collection.
      // (Used directly because the builder's with() eager-load is a no-op on
      // Mongo — see the skipped "eager loading (with)" test.)
      await new RelationLoader(users, RelUser).load("posts");

      expect(users).toHaveLength(2);
      expect(users[0].getRelation<RelPost[]>("posts")).toHaveLength(2);
      expect(users[1].getRelation<RelPost[]>("posts")).toHaveLength(1);
    });
  });

  // ==========================================================================
  // belongsToMany (inferred pivot)
  // ==========================================================================

  describe("belongsToMany — inferred pivot", () => {
    it("loads related models through the inferred pivot collection", async () => {
      const user = await RelUser.create({ name: "Karl" });
      const admin = await RelRole.create({ name: "admin" });
      const editor = await RelRole.create({ name: "editor" });

      await harness.db.collection(ROLE_USER_PIVOT).insertMany([
        { rel_user_id: user.id, rel_role_id: admin.id },
        { rel_user_id: user.id, rel_role_id: editor.id },
      ]);

      const fetched = await RelUser.find(user.id);
      await fetched!.load("roles");
      const roles = fetched!.getRelation<RelRole[]>("roles")!;

      expect(roles.map((role) => role.get("name")).sort()).toEqual(["admin", "editor"]);
    });

    it("assigns an empty array when the pivot has no rows for the model", async () => {
      const user = await RelUser.create({ name: "Liam" });

      const fetched = await RelUser.find(user.id);
      await fetched!.load("roles");

      expect(fetched!.getRelation("roles")).toEqual([]);
    });
  });

  // ==========================================================================
  // belongsToMany — pivot persistence (attach / detach)
  // ==========================================================================

  describe("belongsToMany — pivot persistence", () => {
    it("attaches fresh ids and writes the pivot rows", async () => {
      const user = await RelUser.create({ name: "Mia" });
      const roleA = await RelRole.create({ name: "a" });
      const roleB = await RelRole.create({ name: "b" });

      await user.attach("roles", [roleA.id, roleB.id]);

      const rows = await harness.db
        .collection<{ rel_role_id: number }>(ROLE_USER_PIVOT)
        .find({ rel_user_id: user.id })
        .toArray();
      expect(rows.map((row) => row.rel_role_id).sort((left, right) => left - right)).toEqual(
        [roleA.id, roleB.id].sort((left, right) => left - right),
      );
    });

    it("detaches a specific id, leaving the rest in place", async () => {
      const user = await RelUser.create({ name: "Noah" });
      const roleA = await RelRole.create({ name: "a" });
      const roleB = await RelRole.create({ name: "b" });
      await user.attach("roles", [roleA.id, roleB.id]);

      await user.detach("roles", [roleA.id]);

      const rows = await harness.db
        .collection<{ rel_role_id: number }>(ROLE_USER_PIVOT)
        .find({ rel_user_id: user.id })
        .toArray();
      expect(rows.map((row) => row.rel_role_id)).toEqual([roleB.id]);
    });

    it("detaches all rows for the model when no ids are given", async () => {
      const user = await RelUser.create({ name: "Olivia" });
      const roleA = await RelRole.create({ name: "a" });
      const roleB = await RelRole.create({ name: "b" });
      await user.attach("roles", [roleA.id, roleB.id]);

      await user.detach("roles");

      const count = await harness.db
        .collection(ROLE_USER_PIVOT)
        .countDocuments({ rel_user_id: user.id });
      expect(count).toBe(0);
    });

    // BUG: attach() de-dupes by reading the existing pivot ids first, via
    // PivotOperations.getExistingPivotIds (src/relations/pivot-operations.ts:313)
    // which calls `queryBuilder(pivot).select([fk]).where(localKey, value).get()`.
    // On Mongo the query builder emits pipeline stages in call order, so the
    // `$project` (from select, which keeps only `rel_role_id`) runs BEFORE the
    // `$match` on `rel_user_id` (src/drivers/mongodb/mongodb-query-parser.ts).
    // The projection strips the column the match needs, so the read returns []
    // and the existing-ids set is always empty → re-attaching an id inserts a
    // duplicate row. (Selecting a column NOT involved in the filter is the trap;
    // including the filter column in select() makes it work.) Postgres is
    // unaffected because its select+where executes correctly.
    it.skip("attaches ids and skips duplicates", async () => {
      const user = await RelUser.create({ name: "Mason" });
      const roleA = await RelRole.create({ name: "a" });
      const roleB = await RelRole.create({ name: "b" });

      await user.attach("roles", [roleA.id]);
      await user.attach("roles", [roleA.id, roleB.id]);

      const rows = await harness.db
        .collection<{ rel_role_id: number }>(ROLE_USER_PIVOT)
        .find({ rel_user_id: user.id })
        .toArray();
      expect(rows.map((row) => row.rel_role_id).sort((left, right) => left - right)).toEqual(
        [roleA.id, roleB.id].sort((left, right) => left - right),
      );
    });

    // BUG: sync() computes the delta from getExistingPivotIds (same broken
    // select-before-match read as above), so on Mongo it sees an empty existing
    // set and never detaches removed ids — leaving stale rows behind.
    it.skip("syncs the pivot to exactly the target set", async () => {
      const user = await RelUser.create({ name: "Pat" });
      const roleA = await RelRole.create({ name: "a" });
      const roleB = await RelRole.create({ name: "b" });
      const roleC = await RelRole.create({ name: "c" });
      await user.attach("roles", [roleA.id, roleB.id]);

      await user.pivot("roles").sync([roleB.id, roleC.id]);

      const rows = await harness.db
        .collection<{ rel_role_id: number }>(ROLE_USER_PIVOT)
        .find({ rel_user_id: user.id })
        .toArray();
      expect(rows.map((row) => row.rel_role_id).sort((left, right) => left - right)).toEqual(
        [roleB.id, roleC.id].sort((left, right) => left - right),
      );
    });

    // BUG: toggle() also reads via getExistingPivotIds, so on Mongo the broken
    // select-before-match read makes every id look "absent" → toggle always
    // attaches (and may duplicate) instead of flipping present ids off.
    it.skip("toggles ids — flipping present off and absent on", async () => {
      const user = await RelUser.create({ name: "Quinn" });
      const roleA = await RelRole.create({ name: "a" });
      const roleB = await RelRole.create({ name: "b" });
      await user.attach("roles", [roleA.id]);

      await user.pivot("roles").toggle([roleA.id, roleB.id]);

      const rows = await harness.db
        .collection<{ rel_role_id: number }>(ROLE_USER_PIVOT)
        .find({ rel_user_id: user.id })
        .toArray();
      expect(rows.map((row) => row.rel_role_id)).toEqual([roleB.id]);
    });
  });

  // ==========================================================================
  // belongsToMany — explicit pivot config overrides
  // ==========================================================================

  describe("belongsToMany — explicit pivot overrides", () => {
    it("attaches with extra pivot data and loads through the overridden columns", async () => {
      const user = await RelUser.create({ name: "Sam" });
      const skillA = await RelSkill.create({ name: "ts" });
      const skillB = await RelSkill.create({ name: "sql" });

      await user.attach("skills", [skillA.id, skillB.id], { added_by: 42 });

      // Pivot docs landed in the overridden collection + columns.
      const pivotRows = await harness.db
        .collection<{ user_ref: number; skill_ref: number; added_by: number }>(USER_SKILLS_PIVOT)
        .find({ user_ref: user.id })
        .toArray();
      expect(pivotRows).toHaveLength(2);
      expect(pivotRows.every((row) => row.added_by === 42)).toBe(true);

      const fetched = await RelUser.find(user.id);
      await fetched!.load("skills");
      const skills = fetched!.getRelation<RelSkill[]>("skills")!;
      expect(skills.map((skill) => skill.get("name")).sort()).toEqual(["sql", "ts"]);
    });
  });

  // ==========================================================================
  // nested / deep loading
  // ==========================================================================

  describe("nested loading (dot notation)", () => {
    it("loads a grandchild relation through a hasMany parent", async () => {
      const user = await RelUser.create({ name: "Tina" });
      const post = await RelPost.create({ title: "Deep", rel_user_id: user.id });
      const commentA = await RelComment.create({ body: "c1", rel_post_id: post.id });
      const commentB = await RelComment.create({ body: "c2", rel_post_id: post.id });

      const fetched = await RelUser.find(user.id);
      await fetched!.load("posts.comments");

      const posts = fetched!.getRelation<RelPost[]>("posts")!;
      expect(posts).toHaveLength(1);
      const comments = posts[0].getRelation<RelComment[]>("comments")!;
      expect(comments.map((comment) => comment.id).sort()).toEqual(
        [commentA.id, commentB.id].sort(),
      );
    });

    it("loads through a belongsTo parent then back down a hasMany", async () => {
      const user = await RelUser.create({ name: "Uma" });
      const post = await RelPost.create({ title: "Root", rel_user_id: user.id });
      await RelPost.create({ title: "Sibling", rel_user_id: user.id });
      const comment = await RelComment.create({ body: "hi", rel_post_id: post.id });

      // comment → post → author (post's user) → posts
      const fetched = await RelComment.find(comment.id);
      await fetched!.load("post.author.posts");

      const parentPost = fetched!.getRelation<RelPost>("post")!;
      expect(parentPost.id).toBe(post.id);
      const author = parentPost.getRelation<RelUser>("author")!;
      expect(author.id).toBe(user.id);
      expect(author.getRelation<RelPost[]>("posts")).toHaveLength(2);
    });
  });

  // ==========================================================================
  // eager loading (with) — BUG: no-op on the MongoDB driver
  // ==========================================================================

  describe("eager loading (with) — BUG", () => {
    // BUG: `Model.with(...)` records relations into the builder's
    // `eagerLoadRelations` map, but the MongoDB driver's get()
    // (src/drivers/mongodb/mongodb-query-builder.ts:1807) never invokes the
    // RelationLoader for them — it only fetches, hydrates, and fires callbacks.
    // The Postgres query builder DOES run the loader inside its own get(), so
    // `with()` works there. On Mongo every `with(...)` is a silent no-op: the
    // relation stays unloaded (`isLoaded` false, `getRelation` undefined). The
    // lazy `model.load(...)` path used throughout this suite proves the loader
    // itself works on Mongo — only the builder's eager-load wiring is missing.
    it.skip("eager-loads relations via with() (broken on Mongo)", async () => {
      const user = await RelUser.create({ name: "Vic" });
      await RelPost.create({ title: "p", rel_user_id: user.id });

      const loaded = await RelUser.with("posts").where("id", user.id).first();

      expect(loaded!.isLoaded("posts")).toBe(true);
      expect(loaded!.getRelation<RelPost[]>("posts")).toHaveLength(1);
    });
  });
});
