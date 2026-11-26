import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { MongoQueryBuilder } from "../drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../drivers/postgres/postgres-query-builder";
import { Model } from "../model/model";

afterEach(() => {
  dataSourceRegistry.clear();
  vi.clearAllMocks();
});

function postgresModel() {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const driver = {
    name: "postgres",
    dialect: new PostgresDialect(),
    query,
    serialize: (fields: Record<string, unknown>) => fields,
    modelDefaults: {},
    on: vi.fn(),
  };
  const dataSource = new DataSource({ name: "postgres-bounded-update", driver: driver as any });

  class Job extends Model {
    public static override table = "bounded_jobs";
    public static override dataSource = dataSource;
    public static override builder = PostgresQueryBuilder as any;
  }

  return { Job, query };
}

describe("bounded update() on PostgreSQL", () => {
  it("limits the update through a ctid subquery with the chain's order", async () => {
    const { Job, query } = postgresModel();

    const count = await Job.where("status", "queued")
      .orderBy("createdAt", "asc")
      .limit(1)
      .update({ status: "running" });

    expect(count).toBe(1);

    const [sql, params] = query.mock.calls[0]!;

    expect(sql).toContain('UPDATE "bounded_jobs" SET "status" = $2');
    expect(sql).toContain('WHERE ctid IN (SELECT ctid FROM "bounded_jobs" WHERE');
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("LIMIT 1");
    expect(params).toEqual(["queued", "running"]);
  });

  it("keeps an unbounded update as a plain filtered UPDATE", async () => {
    const { Job, query } = postgresModel();

    await Job.where("status", "queued").update({ status: "running" });

    const [sql] = query.mock.calls[0]!;

    expect(sql).not.toContain("ctid");
    expect(sql).not.toContain("LIMIT");
  });
});

function mongoBuilder() {
  const driver = {
    database: { collection: () => ({}) },
    findOneAndUpdate: vi.fn().mockResolvedValue({ _id: "a" }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
  };
  const dataSource: any = { driver, relationDefaults: undefined };

  return { driver, builder: new MongoQueryBuilder<any>("bounded_jobs", dataSource) };
}

describe("bounded update() on MongoDB", () => {
  it("limit(1) updates one document using the chain's sort", async () => {
    const { driver, builder } = mongoBuilder();

    const count = await builder
      .where("status", "queued")
      .orderBy("createdAt", "desc")
      .limit(1)
      .update({ status: "running" });

    expect(count).toBe(1);
    expect(driver.updateMany).not.toHaveBeenCalled();
    expect(driver.findOneAndUpdate).toHaveBeenCalledWith(
      "bounded_jobs",
      { status: "queued" },
      { $set: { status: "running" } },
      { sort: { createdAt: -1 }, returnDocument: "after" },
    );
  });

  it("limit(n) selects the ids first, then updates them by _id", async () => {
    const { driver, builder } = mongoBuilder();

    vi.spyOn(builder, "pluck").mockResolvedValue(["a", "b"]);

    const count = await builder.where("status", "queued").limit(2).update({ status: "running" });

    expect(count).toBe(2);
    expect(driver.updateMany).toHaveBeenCalledWith(
      "bounded_jobs",
      { _id: { $in: ["a", "b"] } },
      { $set: { status: "running" } },
    );
  });

  it("without a limit it still updates every match", async () => {
    const { driver, builder } = mongoBuilder();

    await builder.where("status", "queued").update({ status: "running" });

    expect(driver.updateMany).toHaveBeenCalledWith(
      "bounded_jobs",
      { status: "queued" },
      { $set: { status: "running" } },
    );
  });
});
