import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ARTICLES_TABLE, QArticle, QUser, USERS_TABLE } from "../fixtures/query/models";
import { CREATE_ARTICLES_TABLE, CREATE_USERS_TABLE } from "../fixtures/query/schema";
import { startPostgresHarness, type PostgresHarness } from "../helpers";

/**
 * Persistence EXECUTION coverage for the Postgres driver against a REAL
 * container: create, partial update (only the changed column is written), bulk
 * create / update / delete, upsert (insert + update branch), atomic
 * increment / decrement, and the delete strategies — permanent vs soft, where
 * a soft-deleted row is hidden by the `notDeleted` scope but still present in
 * the raw table, then resurfaced and restored.
 *
 * The `q_upsert` table carries a UNIQUE(email) constraint because Postgres
 * upsert is `INSERT ... ON CONFLICT (email)`, which needs that index to fire.
 */

const UPSERT_TABLE = "q_upsert";

// `created_at` / `updated_at` are present because the upsert path stamps both
// timestamp columns (the driver default column names) into the INSERT payload.
const CREATE_UPSERT_TABLE = `
  CREATE TABLE "${UPSERT_TABLE}" (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    visits INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )
`;

let harness: PostgresHarness;

describe("Postgres integration — persistence execution", () => {
  beforeAll(async () => {
    harness = await startPostgresHarness();
    await harness.query(CREATE_USERS_TABLE);
    await harness.query(CREATE_ARTICLES_TABLE);
    await harness.query(CREATE_UPSERT_TABLE);
  });

  afterAll(async () => {
    await harness.dropTables(USERS_TABLE, ARTICLES_TABLE, UPSERT_TABLE);
    await harness.stop();
  });

  describe("create + update", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${USERS_TABLE}" RESTART IDENTITY CASCADE`);
    });

    it("create persists the row and returns the DB-generated id", async () => {
      const user = await QUser.create({ name: "Alice", email: "alice@example.com", age: 30 });

      expect(user.id).toBe(1);

      const rows = await harness.query<{ name: string; age: number }>(
        `SELECT name, age FROM "${USERS_TABLE}" WHERE id = $1`,
        [user.id],
      );

      expect(rows.rows[0]).toMatchObject({ name: "Alice", age: 30 });
    });

    it("update writes ONLY the changed column", async () => {
      const user = await QUser.create({ name: "Carol", email: "carol@example.com", age: 25 });

      // Mutate `name` out-of-band so we can prove save() does not overwrite it.
      await harness.query(`UPDATE "${USERS_TABLE}" SET name = $1 WHERE id = $2`, [
        "Carol Edited",
        user.id,
      ]);

      user.set("age", 26);
      await user.save();

      const rows = await harness.query<{ name: string; age: number }>(
        `SELECT name, age FROM "${USERS_TABLE}" WHERE id = $1`,
        [user.id],
      );

      // Only dirty columns are written (plus the auto-stamped updated_at). `name`
      // was never dirtied on the model, so the out-of-band edit survives — proof
      // that save() did not rewrite the whole row from its in-memory copy.
      expect(rows.rows[0]).toEqual({ name: "Carol Edited", age: 26 });
    });

    it("Model.update by id returns the modified count", async () => {
      const user = await QUser.create({ name: "Dave", email: "dave@example.com", age: 50 });

      const modified = await QUser.update(user.id, { age: 51 });

      expect(modified).toBe(1);

      const refreshed = await QUser.find(user.id);
      expect(refreshed!.get("age")).toBe(51);
    });

    it("Model.update against a non-existent id modifies nothing", async () => {
      const modified = await QUser.update(9999, { age: 1 });

      expect(modified).toBe(0);
    });
  });

  describe("bulk operations", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${USERS_TABLE}" RESTART IDENTITY CASCADE`);
    });

    it("createMany inserts every row", async () => {
      const created = await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20 },
        { name: "B", email: "b@example.com", age: 30 },
        { name: "C", email: "c@example.com", age: 40 },
      ]);

      expect(created).toHaveLength(3);

      const count = await harness.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM "${USERS_TABLE}"`,
      );
      expect(count.rows[0].count).toBe(3);
    });

    // The reliable bulk-update primitive is driver.updateMany(table, filter, op),
    // which has no LIMIT and touches every matching row.
    it("bulk update via driver.updateMany touches every matching row", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20, role: "member" },
        { name: "B", email: "b@example.com", age: 30, role: "member" },
        { name: "C", email: "c@example.com", age: 40, role: "admin" },
      ]);

      const result = await harness.driver.updateMany(
        USERS_TABLE,
        { role: "member" },
        { $set: { city: "Cairo" } },
      );

      expect(result.modifiedCount).toBe(2);

      const members = await harness.query<{ city: string | null }>(
        `SELECT city FROM "${USERS_TABLE}" WHERE role = 'member'`,
      );
      expect(members.rows.every((row) => row.city === "Cairo")).toBe(true);

      const adminCity = await harness.query<{ city: string | null }>(
        `SELECT city FROM "${USERS_TABLE}" WHERE role = 'admin'`,
      );
      expect(adminCity.rows[0].city).toBeNull();
    });

    // BUG: Model.findAndUpdate is documented as updating *multiple* matching
    // records, but on Postgres it updates only one. It routes through
    // performAtomic -> driver.atomic, and PostgresDriver.atomic always calls
    // buildUpdateQuery(..., limit = 1), which wraps the UPDATE in
    // `WHERE ctid IN (SELECT ctid ... LIMIT 1)` (postgres-driver.ts atomic:888,
    // buildUpdateQuery:1117). So only a single matching row is mutated even
    // though findAndUpdate then re-fetches and returns all matches.
    it.skip("BUG: findAndUpdate updates every matching record", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20, role: "member" },
        { name: "B", email: "b@example.com", age: 30, role: "member" },
      ]);

      const updated = await QUser.findAndUpdate({ role: "member" }, { $set: { city: "Cairo" } });

      expect(updated.every((row) => row.get("city") === "Cairo")).toBe(true);
    });

    it("bulk delete via Model.delete removes every matching row and returns the count", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 20, role: "member" },
        { name: "B", email: "b@example.com", age: 30, role: "member" },
        { name: "C", email: "c@example.com", age: 40, role: "admin" },
      ]);

      const deleted = await QUser.delete({ role: "member" });

      expect(deleted).toBe(2);

      const remaining = await harness.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM "${USERS_TABLE}"`,
      );
      expect(Number(remaining.rows[0].count)).toBe(1);
    });

    it("Model.delete with a no-match filter returns 0", async () => {
      const deleted = await QUser.delete({ role: "nope" });

      expect(deleted).toBe(0);
    });
  });

  describe("upsert", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${UPSERT_TABLE}" RESTART IDENTITY CASCADE`);
    });

    class QUpsert extends QUser {
      public static table = UPSERT_TABLE;
    }

    it("inserts when no conflicting row exists", async () => {
      const row = await QUpsert.upsert(
        { email: "new@example.com" },
        { email: "new@example.com", name: "New", visits: 1 },
        { conflictColumns: ["email"] },
      );

      expect(row.get("name")).toBe("New");

      const count = await harness.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM "${UPSERT_TABLE}"`,
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });

    it("updates the existing row on conflict instead of inserting a duplicate", async () => {
      await QUpsert.upsert(
        { email: "dup@example.com" },
        { email: "dup@example.com", name: "First", visits: 1 },
        { conflictColumns: ["email"] },
      );

      const row = await QUpsert.upsert(
        { email: "dup@example.com" },
        { email: "dup@example.com", name: "Second", visits: 9 },
        { conflictColumns: ["email"] },
      );

      expect(row.get("name")).toBe("Second");

      const rows = await harness.query<{ name: string; visits: number }>(
        `SELECT name, visits FROM "${UPSERT_TABLE}" WHERE email = $1`,
        ["dup@example.com"],
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]).toEqual({ name: "Second", visits: 9 });
    });
  });

  describe("increment / decrement", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${USERS_TABLE}" RESTART IDENTITY CASCADE`);
    });

    // The atomic-update path (driver.atomic with $inc) numbers its bind params
    // correctly, so Model.atomic / model.atomicIncrement are the reliable way to
    // bump a field by filter. (The query-builder's own increment() is buggy with
    // a WHERE filter — see the skipped BUG specs below.)
    it("Model.atomic with $inc bumps a field for the matching row", async () => {
      const user = await QUser.create({ name: "A", email: "a@example.com", age: 30 });

      const modified = await QUser.atomic({ id: user.id }, { $inc: { age: 3 } });

      expect(modified).toBe(1);

      const raw = await harness.query<{ age: number }>(
        `SELECT age FROM "${USERS_TABLE}" WHERE id = $1`,
        [user.id],
      );
      expect(raw.rows[0].age).toBe(33);
    });

    it("instance atomicIncrement / atomicDecrement adjust the DB value", async () => {
      const user = await QUser.create({ name: "A", email: "a@example.com", age: 30 });

      await user.atomicIncrement("age", 5);
      await user.atomicDecrement("age", 2);

      const raw = await harness.query<{ age: number }>(
        `SELECT age FROM "${USERS_TABLE}" WHERE id = $1`,
        [user.id],
      );
      expect(raw.rows[0].age).toBe(33);
    });

    // `age` is an INTEGER column so node-pg returns the RETURNING value as a JS
    // number; a NUMERIC column would come back as a string and the builder does
    // not coerce increment results. No WHERE filter here, which is the one
    // increment() shape that binds correctly.
    it("builder increment / decrement (no filter) returns the new value", async () => {
      const user = await QUser.create({ name: "A", email: "a@example.com", age: 30 });

      const bumped = await harness.driver.queryBuilder(USERS_TABLE).increment("age", 4);
      expect(bumped).toBe(34);

      const lowered = await harness.driver.queryBuilder(USERS_TABLE).decrement("age", 1);
      expect(lowered).toBe(33);

      const raw = await harness.query<{ age: number }>(
        `SELECT age FROM "${USERS_TABLE}" WHERE id = $1`,
        [user.id],
      );
      expect(raw.rows[0].age).toBe(33);
    });

    // BUG: PostgresQueryBuilder.increment() / incrementMany() mis-number bind
    // params when a WHERE filter is present. They hardcode the amount as `$1`
    // and append `buildFilter()`'s params, but `buildFilter()` itself numbers
    // its placeholders from `$1` too (postgres-query-builder.ts increment:808
    // incrementMany:829, buildFilter:1797). The result is a placeholder
    // collision: Postgres reports "bind message supplies N parameters, but
    // prepared statement requires 1", or "operator does not exist: integer +
    // text" when the filter value lands in the amount slot. Model.increase /
    // Model.decrease route through this path, so they are affected too.
    it.skip("BUG: Model.increase bumps a field by filter and returns the new value", async () => {
      const user = await QUser.create({ name: "A", email: "a@example.com", age: 30 });

      const newAge = await QUser.increase({ id: user.id }, "age", 3);

      expect(newAge).toBe(33);
    });

    it.skip("BUG: incrementMany bumps every matching row (filtered)", async () => {
      await QUser.createMany([
        { name: "A", email: "a@example.com", age: 30, role: "member" },
        { name: "B", email: "b@example.com", age: 31, role: "member" },
        { name: "C", email: "c@example.com", age: 32, role: "admin" },
      ]);

      const affected = await QUser.query().where("role", "member").incrementMany("age", 10);

      expect(affected).toBe(2);
    });
  });

  describe("delete strategies", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${ARTICLES_TABLE}" RESTART IDENTITY CASCADE`);
    });

    it("permanent delete removes the row from the table", async () => {
      const article = await QArticle.create({ title: "Doomed", views: 0 });

      const result = await article.destroy({ strategy: "permanent" });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("permanent");

      const raw = await harness.query(`SELECT id FROM "${ARTICLES_TABLE}"`);
      expect(raw.rowCount).toBe(0);
    });

    it("soft delete hides the row from scoped queries but keeps it in the table", async () => {
      const article = await QArticle.create({ title: "Soft", views: 5 });

      const result = await article.destroy({ strategy: "soft" });

      expect(result.strategy).toBe("soft");

      // Hidden from the default (scoped) query path.
      const visible = await QArticle.all();
      expect(visible).toHaveLength(0);
      expect(await QArticle.find(article.id)).toBeNull();

      // Still physically present with deletedAt populated.
      const raw = await harness.query<{ id: number; deletedAt: Date | null }>(
        `SELECT id, "deletedAt" FROM "${ARTICLES_TABLE}" WHERE id = $1`,
        [article.id],
      );
      expect(raw.rowCount).toBe(1);
      expect(raw.rows[0].deletedAt).not.toBeNull();
    });

    it("withoutGlobalScope surfaces soft-deleted rows", async () => {
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

    it("restore clears deletedAt and the row reappears in scoped queries", async () => {
      const article = await QArticle.create({ title: "Phoenix", views: 2 });
      await article.destroy({ strategy: "soft" });

      expect(await QArticle.all()).toHaveLength(0);

      await QArticle.restore(article.id);

      const visible = await QArticle.all();
      expect(visible.map((row) => row.get("title"))).toEqual(["Phoenix"]);

      const raw = await harness.query<{ deletedAt: Date | null }>(
        `SELECT "deletedAt" FROM "${ARTICLES_TABLE}" WHERE id = $1`,
        [article.id],
      );
      expect(raw.rows[0].deletedAt).toBeNull();
    });
  });
});
