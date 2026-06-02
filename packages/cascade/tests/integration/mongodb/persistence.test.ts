import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ARTICLES_TABLE, QArticle, QUser, USERS_TABLE } from "../fixtures/query/models";
import { startMongodbHarness, type MongodbHarness } from "../helpers";

/**
 * Persistence EXECUTION coverage for the MongoDB driver against a REAL
 * container: create, partial update (only the changed field is written), bulk
 * update / delete, upsert (insert + update branch), atomic increment /
 * decrement, and the delete strategies — permanent, soft (hidden by the
 * `notDeleted` scope yet present in the raw collection, then restored), and
 * trash (moved to a separate collection).
 *
 * Unlike Postgres, MongoDB's `atomic` is backed by `updateMany`, so
 * `findAndUpdate` correctly touches every matching document here.
 */

const TRASH_COLLECTION = `${ARTICLES_TABLE}Trash`;

let harness: MongodbHarness;

describe("MongoDB integration — persistence execution", () => {
  beforeAll(async () => {
    harness = await startMongodbHarness();
  });

  afterAll(async () => {
    await harness.dropCollections(USERS_TABLE, ARTICLES_TABLE, TRASH_COLLECTION);
    await harness.stop();
  });

  describe("create + update", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE);
    });

    it("create persists the document and returns a generated id", async () => {
      const user = await QUser.create({ name: "Alice", email: "alice@example.com", age: 30 });

      expect(typeof user.id).toBe("number");

      const stored = await harness.db.collection(USERS_TABLE).findOne({ id: user.id });

      expect(stored).toMatchObject({ name: "Alice", age: 30 });
    });

    it("update writes ONLY the changed field", async () => {
      const user = await QUser.create({ name: "Carol", email: "carol@example.com", age: 25 });

      // Mutate `name` out-of-band so we can prove save() does not overwrite it.
      await harness.db
        .collection(USERS_TABLE)
        .updateOne({ id: user.id }, { $set: { name: "Carol Edited" } });

      user.set("age", 26);
      await user.save();

      const stored = await harness.db
        .collection<{ name: string; age: number }>(USERS_TABLE)
        .findOne({ id: user.id });

      // age changed via the model; the out-of-band name survives → save() only
      // wrote the dirty `age` field (plus the auto-stamped updatedAt).
      expect(stored).toMatchObject({ name: "Carol Edited", age: 26 });
    });

    it("Model.update by id returns the modified count", async () => {
      const user = await QUser.create({ name: "Dave", email: "dave@example.com", age: 50 });

      const modified = await QUser.update(user.id, { age: 51 });

      expect(modified).toBe(1);

      const refreshed = await QUser.find(user.id);
      expect(refreshed!.get("age")).toBe(51);
    });

    it("Model.update against a non-existent id modifies nothing", async () => {
      const modified = await QUser.update(999999, { age: 1 });

      expect(modified).toBe(0);
    });
  });

  describe("bulk operations", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE);
    });

    it("createMany inserts every document", async () => {
      const created = await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20 },
        { name: "B", email: "b@example.com", age: 30 },
        { name: "C", email: "c@example.com", age: 40 },
      ]);

      expect(created).toHaveLength(3);
      expect(await harness.db.collection(USERS_TABLE).countDocuments()).toBe(3);
    });

    it("findAndUpdate touches every matching document", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20, role: "member" },
        { name: "B", email: "b@example.com", age: 30, role: "member" },
        { name: "C", email: "c@example.com", age: 40, role: "admin" },
      ]);

      const updated = await QUser.findAndUpdate({ role: "member" }, { $set: { city: "Cairo" } });

      expect(updated).toHaveLength(2);
      expect(updated.every((row) => row.get("city") === "Cairo")).toBe(true);

      const admin = await harness.db
        .collection<{ city?: string }>(USERS_TABLE)
        .findOne({ role: "admin" });
      expect(admin!.city).toBeUndefined();
    });

    it("bulk delete via Model.delete removes every matching document and returns the count", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20, role: "member" },
        { name: "B", email: "b@example.com", age: 30, role: "member" },
        { name: "C", email: "c@example.com", age: 40, role: "admin" },
      ]);

      const deleted = await QUser.delete({ role: "member" });

      expect(deleted).toBe(2);
      expect(await harness.db.collection(USERS_TABLE).countDocuments()).toBe(1);
    });

    it("Model.delete with a no-match filter returns 0", async () => {
      const deleted = await QUser.delete({ role: "nope" });

      expect(deleted).toBe(0);
    });
  });

  describe("upsert", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE);
    });

    it("inserts when no matching document exists", async () => {
      const row = await QUser.upsert(
        { email: "new@example.com" },
        { email: "new@example.com", name: "New", age: 1 },
      );

      expect(row.get("name")).toBe("New");
      expect(await harness.db.collection(USERS_TABLE).countDocuments()).toBe(1);
    });

    it("updates the existing document instead of inserting a duplicate", async () => {
      await QUser.upsert(
        { email: "dup@example.com" },
        { email: "dup@example.com", name: "First", age: 1 },
      );

      const row = await QUser.upsert(
        { email: "dup@example.com" },
        { email: "dup@example.com", name: "Second", age: 9 },
      );

      expect(row.get("name")).toBe("Second");

      const matches = await harness.db
        .collection(USERS_TABLE)
        .find({ email: "dup@example.com" })
        .toArray();
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ name: "Second", age: 9 });
    });
  });

  describe("increment / decrement", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE);
    });

    it("Model.increase bumps a field by filter and returns the new value", async () => {
      const user = await QUser.create({ name: "A", email: "a@example.com", age: 30, score: 5 });

      const newScore = await QUser.increase({ id: user.id }, "score", 3);

      expect(newScore).toBe(8);

      const stored = await harness.db
        .collection<{ score: number }>(USERS_TABLE)
        .findOne({ id: user.id });
      expect(stored!.score).toBe(8);
    });

    it("Model.decrease lowers a field by filter and returns the new value", async () => {
      const user = await QUser.create({ name: "A", email: "a@example.com", age: 30, score: 5 });

      const newScore = await QUser.decrease({ id: user.id }, "score", 2);

      expect(newScore).toBe(3);
    });

    it("incrementMany bumps every matching document", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 30, role: "member", score: 1 },
        { name: "B", email: "b@example.com", age: 31, role: "member", score: 2 },
        { name: "C", email: "c@example.com", age: 32, role: "admin", score: 3 },
      ]);

      const affected = await QUser.query().where("role", "member").incrementMany("score", 10);

      expect(affected).toBe(2);

      // createMany inserts concurrently, so assert the resulting score set rather
      // than relying on id order matching the input array order.
      const scores = await harness.db
        .collection<{ score: number }>(USERS_TABLE)
        .find({ role: "member" })
        .toArray();
      expect(scores.map((row) => row.score).sort((a, b) => a - b)).toEqual([11, 12]);

      // The admin (unmatched) score is untouched.
      const admin = await harness.db
        .collection<{ score: number }>(USERS_TABLE)
        .findOne({ role: "admin" });
      expect(admin!.score).toBe(3);
    });
  });

  describe("delete strategies", () => {
    beforeEach(async () => {
      await harness.dropCollections(ARTICLES_TABLE, TRASH_COLLECTION);
    });

    it("permanent delete removes the document from the collection", async () => {
      const article = await QArticle.create({ title: "Doomed", views: 0 });

      const result = await article.destroy({ strategy: "permanent" });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("permanent");
      expect(await harness.db.collection(ARTICLES_TABLE).countDocuments()).toBe(0);
    });

    it("soft delete hides the document from scoped queries but keeps it in the collection", async () => {
      const article = await QArticle.create({ title: "Soft", views: 5 });

      const result = await article.destroy({ strategy: "soft" });

      expect(result.strategy).toBe("soft");

      // Hidden from the default (scoped) query path.
      expect(await QArticle.all()).toHaveLength(0);
      expect(await QArticle.find(article.id)).toBeNull();

      // Still physically present with deletedAt populated.
      const stored = await harness.db
        .collection<{ deletedAt: Date | null }>(ARTICLES_TABLE)
        .findOne({ id: article.id });
      expect(stored).not.toBeNull();
      expect(stored!.deletedAt).toBeInstanceOf(Date);
    });

    it("withoutGlobalScope surfaces soft-deleted documents", async () => {
      const article = await QArticle.create({ title: "Surfaced", views: 1 });
      await article.destroy({ strategy: "soft" });

      const all = await QArticle.query().withoutGlobalScope("notDeleted").get();
      expect(all).toHaveLength(1);

      const onlyDeleted = await QArticle.query()
        .withoutGlobalScope("notDeleted")
        .whereNotNull("deletedAt")
        .get();
      expect(onlyDeleted.map((row) => row.get("title"))).toEqual(["Surfaced"]);
    });

    it("restore clears deletedAt and the document reappears in scoped queries", async () => {
      const article = await QArticle.create({ title: "Phoenix", views: 2 });
      await article.destroy({ strategy: "soft" });

      expect(await QArticle.all()).toHaveLength(0);

      await QArticle.restore(article.id);

      const visible = await QArticle.all();
      expect(visible.map((row) => row.get("title"))).toEqual(["Phoenix"]);
    });

    it("trash delete moves the document to the trash collection", async () => {
      const article = await QArticle.create({ title: "Trashed", views: 3 });

      const result = await article.destroy({ strategy: "trash" });

      expect(result.strategy).toBe("trash");

      // Gone from the source collection.
      expect(await harness.db.collection(ARTICLES_TABLE).countDocuments()).toBe(0);

      // Present in the {table}Trash collection, tagged with originalTable.
      const trashed = await harness.db
        .collection<{ title: string; originalTable: string }>(TRASH_COLLECTION)
        .findOne({ id: article.id });
      expect(trashed).not.toBeNull();
      expect(trashed).toMatchObject({ title: "Trashed", originalTable: ARTICLES_TABLE });
    });
  });
});
