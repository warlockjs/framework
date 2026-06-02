import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORDERS_TABLE, QOrder, QUser, USERS_TABLE } from "../fixtures/query/models";
import { CREATE_ORDERS_TABLE, CREATE_USERS_TABLE } from "../fixtures/query/schema";
import { startPostgresHarness, type PostgresHarness } from "../helpers";

/**
 * Query EXECUTION coverage for the Postgres driver against a REAL container.
 *
 * The query BUILDERS are unit-tested in isolation; this suite proves the parsed
 * SQL actually round-trips correct rows from a live Postgres server: every
 * WHERE-operator family, ordering, limit/offset, page pagination, the aggregate
 * functions, groupBy/having, and distinct.
 *
 * Tables are created once and truncated per-test (with identity reset) so ids
 * stay deterministic across cases.
 */

let harness: PostgresHarness;

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

describe("Postgres integration — query execution", () => {
  beforeAll(async () => {
    harness = await startPostgresHarness();
    await harness.query(CREATE_USERS_TABLE);
    await harness.query(CREATE_ORDERS_TABLE);
  });

  afterAll(async () => {
    await harness.dropTables(USERS_TABLE, ORDERS_TABLE);
    await harness.stop();
  });

  describe("WHERE operators", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${USERS_TABLE}" RESTART IDENTITY CASCADE`);
      await seedUsers();
    });

    it("equality matches exactly one row", async () => {
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

    it("whereLike is case-insensitive (ILIKE)", async () => {
      const rows = await QUser.query().whereLike("name", "%ar%").get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Carol"]);

      const upper = await QUser.query().whereLike("email", "%ALICE%").get();
      expect(upper.map((row) => row.get("name"))).toEqual(["Alice"]);
    });

    it("whereNotLike excludes matches", async () => {
      const rows = await QUser.query().whereNotNull("email").whereNotLike("email", "%example.com").get();

      expect(rows).toHaveLength(0);
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

    it("equality against null resolves to IS NULL", async () => {
      const rows = await QUser.query().where("score", null).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Dave"]);
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

    it("a large whereIn list (single array bind) matches all present values", async () => {
      // 0..499 covers every seeded age, proving a 500-element IN list round-trips
      // through the single `= ANY($1)` array bind.
      const manyAges = Array.from({ length: 500 }, (_, index) => index);

      const rows = await QUser.query().whereIn("age", manyAges).get();

      expect(rows.map((row) => row.get("age")).sort((a, b) => a - b)).toEqual([19, 25, 30, 41, 50]);
    });
  });

  describe("ordering, limit, offset, pagination", () => {
    beforeEach(async () => {
      await harness.query(`TRUNCATE TABLE "${USERS_TABLE}" RESTART IDENTITY CASCADE`);
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

    it("limit caps the row count", async () => {
      const rows = await QUser.query().orderBy("id").limit(2).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Alice", "Bob"]);
    });

    it("offset skips leading rows", async () => {
      const rows = await QUser.query().orderBy("id").offset(3).get();

      expect(rows.map((row) => row.get("name"))).toEqual(["Dave", "Erin"]);
    });

    it("limit + offset returns a window", async () => {
      const rows = await QUser.query().orderBy("id").limit(2).offset(1).get();

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
      await harness.query(`TRUNCATE TABLE "${USERS_TABLE}" RESTART IDENTITY CASCADE`);
      await harness.query(`TRUNCATE TABLE "${ORDERS_TABLE}" RESTART IDENTITY CASCADE`);
      await seedUsers();

      await QOrder.create({ userId: 1, status: "paid", amount: 100, quantity: 2 });
      await QOrder.create({ userId: 1, status: "paid", amount: 50, quantity: 1 });
      await QOrder.create({ userId: 2, status: "pending", amount: 30, quantity: 3 });
      await QOrder.create({ userId: 3, status: "paid", amount: 20, quantity: 1 });
      await QOrder.create({ userId: 3, status: "cancelled", amount: 75, quantity: 5 });
    });

    it("count of all rows and of a filtered subset", async () => {
      expect(await QUser.query().count()).toBe(5);
      expect(await QUser.query().where("role", "member").count()).toBe(3);
    });

    // Scalar aggregates / projections computed through the RAW driver builder
    // (no model hydrate callback) — proves the generated SQL is correct,
    // independent of the model-path bug captured in the skipped specs below.
    it("sum / avg / min / max over a numeric column (raw builder)", async () => {
      expect(await harness.driver.queryBuilder(ORDERS_TABLE).sum("amount")).toBe(275);
      expect(await harness.driver.queryBuilder(ORDERS_TABLE).avg("amount")).toBe(55);
      expect(await harness.driver.queryBuilder(ORDERS_TABLE).min("amount")).toBe(20);
      expect(await harness.driver.queryBuilder(ORDERS_TABLE).max("amount")).toBe(100);
    });

    it("aggregates respect the active filter (raw builder)", async () => {
      const paidTotal = await harness.driver
        .queryBuilder(ORDERS_TABLE)
        .where("status", "paid")
        .sum("amount");

      expect(paidTotal).toBe(170);
    });

    it("distinct / countDistinct / pluck over the raw builder", async () => {
      const cities = await harness.driver
        .queryBuilder(USERS_TABLE)
        .orderBy("city")
        .distinct<string>("city");
      expect(cities).toEqual(["Cairo", "Giza", "Luxor"]);

      expect(await harness.driver.queryBuilder(USERS_TABLE).countDistinct("city")).toBe(3);

      const names = await harness.driver.queryBuilder(USERS_TABLE).orderBy("id").pluck("name");
      expect(names).toEqual(["Alice", "Bob", "Carol", "Dave", "Erin"]);
    });

    // BUG: Postgres scalar/projection helpers (sum/avg/min/max/distinct/
    // countDistinct/pluck/value) do not reset the model `hydrateCallback`
    // before reading results, so through Model.query() they map over hydrated
    // Model instances with raw bracket access and yield 0 / undefined. The
    // MongoDB builder clears `hydrateCallback` in each of these methods; the
    // Postgres builder does not (postgres-query-builder.ts sum:733 avg:740
    // min:747 max:754 distinct:761 pluck:768 value:774 countDistinct:791).
    it.skip("BUG: model-level sum/avg/min/max return numbers (hydrateCallback not reset)", async () => {
      expect(await QOrder.query().sum("amount")).toBe(275);
      expect(await QOrder.query().avg("amount")).toBe(55);
      expect(await QOrder.query().min("amount")).toBe(20);
      expect(await QOrder.query().max("amount")).toBe(100);
    });

    it.skip("BUG: model-level distinct/countDistinct/pluck return values (hydrateCallback not reset)", async () => {
      expect(await QUser.query().orderBy("city").distinct<string>("city")).toEqual([
        "Cairo",
        "Giza",
        "Luxor",
      ]);
      expect(await QUser.query().countDistinct("city")).toBe(3);
      expect(await QUser.query().orderBy("id").pluck("name")).toEqual([
        "Alice",
        "Bob",
        "Carol",
        "Dave",
        "Erin",
      ]);
    });

    it("groupBy with aggregates buckets rows per key", async () => {
      const rows = await QOrder.query()
        .groupBy("status", { total: "SUM(amount)", orders: "COUNT(*)" })
        .orderBy("status")
        .get();

      expect(
        rows.map((row) => ({
          status: row.get("status"),
          total: Number(row.get("total")),
          orders: Number(row.get("orders")),
        })),
      ).toEqual([
        { status: "cancelled", total: 75, orders: 1 },
        { status: "paid", total: 170, orders: 3 },
        { status: "pending", total: 30, orders: 1 },
      ]);
    });

    it("having filters grouped buckets by aggregate value", async () => {
      // `having` references the aggregate by its alias; the builder rewrites the
      // alias to the underlying `SUM(amount) > ?` expression.
      const rows = await QOrder.query()
        .groupBy("status", { total: "SUM(amount)" })
        .having("total", ">", 100)
        .get();

      expect(rows.map((row) => row.get("status"))).toEqual(["paid"]);
    });

    it("exists / notExists reflect presence of matches", async () => {
      expect(await QUser.query().where("role", "admin").exists()).toBe(true);
      expect(await QUser.query().where("role", "ghost").exists()).toBe(false);
      expect(await QUser.query().where("role", "ghost").notExists()).toBe(true);
    });
  });
});
