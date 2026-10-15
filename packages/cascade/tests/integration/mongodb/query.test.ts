import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORDERS_TABLE, QOrder, QUser, USERS_TABLE } from "../fixtures/query/models";
import { startMongodbHarness, type MongodbHarness } from "../helpers";

/**
 * Query EXECUTION coverage for the MongoDB driver against a REAL container.
 *
 * Mirrors the Postgres query suite: every WHERE-operator family, ordering,
 * limit/skip, page pagination, aggregates, groupBy/having, and distinct — but
 * asserts MongoDB semantics (e.g. `whereLike` compiles to a case-insensitive
 * `$regex`, so patterns are substrings rather than SQL `%` wildcards).
 *
 * Collections are auto-created on first write and dropped per-test for
 * isolation; ids are auto-generated sequential integers.
 */

let harness: MongodbHarness;

async function seedUsers(): Promise<void> {
  await QUser.create({
    name: "Alice",
    email: "alice@example.com",
    age: 30,
    role: "admin",
    city: "Cairo",
    isActive: true,
    score: 9.5,
  });
  await QUser.create({
    name: "Bob",
    email: "bob@example.com",
    age: 41,
    role: "member",
    city: "Cairo",
    isActive: true,
    score: 4,
  });
  await QUser.create({
    name: "Carol",
    email: "carol@example.com",
    age: 25,
    role: "member",
    city: "Giza",
    isActive: false,
    score: 7.25,
  });
  await QUser.create({
    name: "Dave",
    email: null,
    age: 50,
    role: "member",
    city: "Giza",
    isActive: true,
    score: null,
  });
  await QUser.create({
    name: "Erin",
    email: "erin@example.com",
    age: 19,
    role: "admin",
    city: "Luxor",
    isActive: false,
    score: 2,
  });
}

describe("MongoDB integration — query execution", () => {
  beforeAll(async () => {
    harness = await startMongodbHarness();
  });

  afterAll(async () => {
    await harness.dropCollections(USERS_TABLE, ORDERS_TABLE);
    await harness.stop();
  });

  describe("WHERE operators", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE);
      await seedUsers();
    });

    it("equality matches exactly one document", async () => {
      const rows = await QUser.where("name", "Alice").get();

      expect(rows).toHaveLength(1);
      expect(rows[0].get("email")).toBe("alice@example.com");
    });

    it("not-equal excludes the matching value", async () => {
      const rows = await QUser.query().where("role", "!=", "member").get();

      expect(rows.map((row) => row.get("name")).sort()).toEqual(["Alice", "Erin"]);
    });

    it("greater-than / greater-than-or-equal", async () => {
      const gt = await QUser.query().where("age", ">", 41).get();
      expect(gt.map((row) => row.get("name"))).toEqual(["Dave"]);

      const gte = await QUser.query().where("age", ">=", 41).get();
      expect(gte.map((row) => row.get("name")).sort()).toEqual(["Bob", "Dave"]);
    });

    it("less-than / less-than-or-equal", async () => {
      const lt = await QUser.query().where("age", "<", 25).get();
      expect(lt.map((row) => row.get("name"))).toEqual(["Erin"]);

      const lte = await QUser.query().where("age", "<=", 25).get();
      expect(lte.map((row) => row.get("name")).sort()).toEqual(["Carol", "Erin"]);
    });

    it("whereIn / whereNotIn", async () => {
      const inRows = await QUser.query().whereIn("city", ["Giza", "Luxor"]).get();
      expect(inRows.map((row) => row.get("name")).sort()).toEqual(["Carol", "Dave", "Erin"]);

      const notInRows = await QUser.query().whereNotIn("city", ["Giza", "Luxor"]).get();
      expect(notInRows.map((row) => row.get("name")).sort()).toEqual(["Alice", "Bob"]);
    });

    it("whereLike compiles to a case-insensitive regex (substring)", async () => {
      const rows = await QUser.query().whereLike("name", "ar").get();
      expect(rows.map((row) => row.get("name"))).toEqual(["Carol"]);

      const upper = await QUser.query().whereLike("email", "ALICE").get();
      expect(upper.map((row) => row.get("name"))).toEqual(["Alice"]);
    });

    it("whereBetween is inclusive of both bounds", async () => {
      const rows = await QUser.query().whereBetween("age", [25, 41]).orderBy("age").get();

      expect(rows.map((row) => row.get("age"))).toEqual([25, 30, 41]);
    });

    it("whereNotBetween excludes the inclusive range", async () => {
      const rows = await QUser.query().whereNotBetween("age", [25, 41]).orderBy("age").get();

      expect(rows.map((row) => row.get("age"))).toEqual([19, 50]);
    });

    it("whereNull / whereNotNull", async () => {
      const nullRows = await QUser.query().whereNull("email").get();
      expect(nullRows.map((row) => row.get("name"))).toEqual(["Dave"]);

      const notNullRows = await QUser.query().whereNotNull("email").get();
      expect(notNullRows).toHaveLength(4);
    });

    it("whereStartsWith / whereEndsWith", async () => {
      const starts = await QUser.query().whereStartsWith("name", "Ca").get();
      expect(starts.map((row) => row.get("name"))).toEqual(["Carol"]);

      const ends = await QUser.query().whereEndsWith("email", "ob@example.com").get();
      expect(ends.map((row) => row.get("name"))).toEqual(["Bob"]);
    });

    it("AND-chained where narrows the result set", async () => {
      const rows = await QUser.query().where("role", "member").where("isActive", true).get();

      // Bob and Dave are the active members; Carol (member) is inactive.
      expect(rows.map((row) => row.get("name")).sort()).toEqual(["Bob", "Dave"]);
    });

    it("orWhere widens the result set", async () => {
      const rows = await QUser.query().where("role", "admin").orWhere("city", "Giza").get();

      expect(rows.map((row) => row.get("name")).sort()).toEqual(["Alice", "Carol", "Dave", "Erin"]);
    });

    it("object-form where matches every key", async () => {
      const rows = await QUser.where({ role: "member", city: "Cairo" }).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Bob"]);
    });

    it("empty result set returns an empty array, not null", async () => {
      const rows = await QUser.query().where("name", "Nobody").get();

      expect(rows).toEqual([]);
    });

    it("a large whereIn list matches all present values", async () => {
      const manyAges = Array.from({ length: 500 }, (_, index) => index);

      const rows = await QUser.query().whereIn("age", manyAges).get();

      expect(rows.map((row) => row.get("age")).sort((a, b) => a - b)).toEqual([19, 25, 30, 41, 50]);
    });
  });

  describe("ordering, limit, skip, pagination", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE);
      await seedUsers();
    });

    it("orderBy ascending and descending", async () => {
      const asc = await QUser.query().orderBy("age", "asc").get();
      expect(asc.map((row) => row.get("age"))).toEqual([19, 25, 30, 41, 50]);

      const desc = await QUser.query().orderByDesc("age").get();
      expect(desc.map((row) => row.get("age"))).toEqual([50, 41, 30, 25, 19]);
    });

    it("multi-column ordering breaks ties with the second key", async () => {
      const rows = await QUser.query().orderBy("city", "asc").orderBy("age", "desc").get();

      expect(rows.map((row) => `${row.get("city")}:${row.get("age")}`)).toEqual([
        "Cairo:41",
        "Cairo:30",
        "Giza:50",
        "Giza:25",
        "Luxor:19",
      ]);
    });

    it("limit caps the document count", async () => {
      const rows = await QUser.query().orderBy("id").limit(2).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Alice", "Bob"]);
    });

    it("skip skips leading documents", async () => {
      const rows = await QUser.query().orderBy("id").skip(3).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Dave", "Erin"]);
    });

    it("skip + limit returns a window", async () => {
      // Mongo builds the pipeline in chain order and `$skip`/`$limit` stages are
      // order-sensitive, so skip is applied before limit (the standard Mongo
      // windowing idiom) — unlike SQL's order-independent LIMIT/OFFSET.
      const rows = await QUser.query().orderBy("id").skip(1).limit(2).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Bob", "Carol"]);
    });

    it("paginate returns data plus page metadata", async () => {
      const page = await QUser.query().orderBy("id").paginate({ page: 2, limit: 2 });

      expect(page.data.map((row) => row.get("name"))).toEqual(["Carol", "Dave"]);
      expect(page.pagination).toEqual({ total: 5, page: 2, limit: 2, pages: 3 });
    });

    it("paginate past the last page yields an empty data window with correct totals", async () => {
      const page = await QUser.query().orderBy("id").paginate({ page: 99, limit: 2 });

      expect(page.data).toEqual([]);
      expect(page.pagination).toEqual({ total: 5, page: 99, limit: 2, pages: 3 });
    });

    it("cursorPaginate walks forward by id", async () => {
      const firstPage = await QUser.query().cursorPaginate({ limit: 2, column: "id" });
      expect(firstPage.data.map((row) => row.get("name"))).toEqual(["Alice", "Bob"]);
      expect(firstPage.pagination.hasMore).toBe(true);

      const secondPage = await QUser.query().cursorPaginate({
        limit: 2,
        column: "id",
        cursor: firstPage.pagination.nextCursor,
      });
      expect(secondPage.data.map((row) => row.get("name"))).toEqual(["Carol", "Dave"]);
    });
  });

  describe("aggregates, groupBy / having, distinct", () => {
    beforeEach(async () => {
      await harness.dropCollections(USERS_TABLE, ORDERS_TABLE);
      await seedUsers();

      await QOrder.create({ userId: 1, status: "paid", amount: 100, quantity: 2 });
      await QOrder.create({ userId: 1, status: "paid", amount: 50, quantity: 1 });
      await QOrder.create({ userId: 2, status: "pending", amount: 30, quantity: 3 });
      await QOrder.create({ userId: 3, status: "paid", amount: 20, quantity: 1 });
      await QOrder.create({ userId: 3, status: "cancelled", amount: 75, quantity: 5 });
    });

    it("count of all documents and of a filtered subset", async () => {
      expect(await QUser.query().count()).toBe(5);
      expect(await QUser.query().where("role", "member").count()).toBe(3);
    });

    it("sum / avg / min / max over a numeric field", async () => {
      expect(await QOrder.query().sum("amount")).toBe(275);
      expect(await QOrder.query().avg("amount")).toBe(55);
      expect(await QOrder.query().min("amount")).toBe(20);
      expect(await QOrder.query().max("amount")).toBe(100);
    });

    it("aggregates respect the active filter", async () => {
      const paidTotal = await QOrder.query().where("status", "paid").sum("amount");

      expect(paidTotal).toBe(170);
    });

    it("groupBy with aggregates buckets documents per key", async () => {
      // The two-arg groupBy renames the `$group` `_id` back to the grouped field,
      // so each result carries `status` plus the aggregate aliases (hydrated onto
      // the model, read via .get()).
      const rows = await QOrder.query()
        .groupBy("status", { total: { $sum: "$amount" }, orders: { $sum: 1 } })
        .get();

      const byStatus = Object.fromEntries(
        rows.map((row) => [
          row.get("status"),
          { total: row.get("total"), orders: row.get("orders") },
        ]),
      );

      expect(byStatus.paid).toEqual({ total: 170, orders: 3 });
      expect(byStatus.pending).toEqual({ total: 30, orders: 1 });
      expect(byStatus.cancelled).toEqual({ total: 75, orders: 1 });
    });

    it("distinct returns unique field values", async () => {
      const cities = await QUser.query().distinct<string>("city");

      expect([...cities].sort()).toEqual(["Cairo", "Giza", "Luxor"]);
    });

    it("countDistinct counts unique values", async () => {
      expect(await QUser.query().countDistinct("city")).toBe(3);
    });

    it("pluck returns one field across documents", async () => {
      const names = await QUser.query().orderBy("id").pluck<string>("name");

      expect(names).toEqual(["Alice", "Bob", "Carol", "Dave", "Erin"]);
    });

    it("exists / notExists reflect presence of matches", async () => {
      expect(await QUser.query().where("role", "admin").exists()).toBe(true);
      expect(await QUser.query().where("role", "ghost").exists()).toBe(false);
      expect(await QUser.query().where("role", "ghost").notExists()).toBe(true);
    });
  });
});
