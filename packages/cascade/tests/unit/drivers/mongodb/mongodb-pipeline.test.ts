import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../../src/drivers/mongodb/mongodb-query-builder";
import { $agg } from "../../../../src/expressions/aggregate-expressions";
import { createMockDriver } from "../../../helpers/mock-driver";

/**
 * Pipeline-shape tests for the MongoDB query builder.
 *
 * These exercise the *pure* translation step — `builder.parse()` turns the
 * recorded operation list into an aggregation pipeline without touching a live
 * database. The mock driver is given a stub `database.collection()` because the
 * builder's `collection` getter reaches through the driver, but no query is ever
 * executed. The assertions lock the exact `$match` / `$sort` / `$project` /
 * `$group` stages each fluent call emits.
 */
describe("MongoQueryBuilder — pipeline shape", () => {
  let dataSource: DataSource;

  beforeEach(() => {
    const driver = createMockDriver("mongodb") as unknown as {
      database: { collection: (name: string) => unknown };
    };

    driver.database = {
      collection: (name: string) => ({ collectionName: name }),
    };

    dataSource = new DataSource({
      name: "test",
      driver: driver as never,
      isDefault: true,
    });

    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.clearAllMocks();
  });

  function builder(table = "users"): MongoQueryBuilder {
    return new MongoQueryBuilder(table, dataSource);
  }

  it("merges consecutive where clauses into one $match stage", () => {
    const pipeline = builder().where("status", "active").where("age", ">", 18).parse().pipeline;

    expect(pipeline).toEqual([{ $match: { status: "active", age: { $gt: 18 } } }]);
  });

  it("builds a $match / $sort / $limit pipeline in declaration order", () => {
    const pipeline = builder()
      .where("status", "active")
      .orderBy("createdAt", "desc")
      .limit(10)
      .parse().pipeline;

    expect(pipeline).toEqual([
      { $match: { status: "active" } },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
    ]);
  });

  it("translates whereIn into an $in match", () => {
    const pipeline = builder().whereIn("id", [1, 2, 3]).parse().pipeline;

    expect(pipeline).toEqual([{ $match: { id: { $in: [1, 2, 3] } } }]);
  });

  it("translates whereBetween into $gte / $lte bounds", () => {
    const pipeline = builder().whereBetween("age", [18, 65]).parse().pipeline;

    expect(pipeline).toEqual([{ $match: { age: { $gte: 18, $lte: 65 } } }]);
  });

  it("translates whereNull to a null match and whereNotNull to a $ne match", () => {
    expect(builder().whereNull("deletedAt").parse().pipeline).toEqual([
      { $match: { deletedAt: null } },
    ]);

    expect(builder().whereNotNull("email").parse().pipeline).toEqual([
      { $match: { email: { $ne: null } } },
    ]);
  });

  it("combines where + orWhere into a single $or match", () => {
    const pipeline = builder().where("a", 1).orWhere("b", 2).parse().pipeline;

    expect(pipeline).toEqual([{ $match: { $or: [{ a: 1 }, { b: 2 }] } }]);
  });

  it("emits a $project stage for select() and a $skip stage for skip()", () => {
    const pipeline = builder().select("id", "name").skip(5).parse().pipeline;

    expect(pipeline).toEqual([{ $project: { id: 1, name: 1 } }, { $skip: 5 }]);
  });

  it("compiles groupBy with aggregates into $group + a renaming $project", () => {
    const pipeline = builder()
      .groupBy("status", { total: $agg.sum("amount"), n: $agg.count() })
      .parse().pipeline;

    expect(pipeline).toEqual([
      { $group: { _id: "$status", total: { $sum: "$amount" }, n: { $sum: 1 } } },
      { $project: { status: "$_id", total: 1, n: 1, _id: 0 } },
    ]);
  });
});
