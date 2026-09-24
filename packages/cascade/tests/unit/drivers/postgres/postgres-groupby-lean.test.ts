import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../../src/drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../../src/drivers/postgres/postgres-query-builder";
import { createMockDriver } from "../../../helpers/mock-driver";

describe("groupBy clears the model hydrator (K4 B9)", () => {
  afterEach(() => dataSourceRegistry.clear());

  it("pg: groupBy(field, aggregates) and groupByDate drop hydrateCallback", () => {
    const driver = createMockDriver("postgres");
    (driver as any).dialect = new PostgresDialect();
    const dataSource = new DataSource({ name: "t", driver, isDefault: true });

    const qb = new PostgresQueryBuilder("orders", dataSource);
    qb.hydrate(() => "MODEL");
    qb.groupBy("category", { revenue: "SUM(amount)" } as any);
    expect(qb.hydrateCallback).toBeUndefined();

    const qb2 = new PostgresQueryBuilder("orders", dataSource);
    qb2.hydrate(() => "MODEL");
    qb2.groupByDate("created_at", "month");
    expect(qb2.hydrateCallback).toBeUndefined();
  });

  it("mongo: groupBy and groupByDate drop hydrateCallback", () => {
    const dataSource = new DataSource({ name: "t", driver: createMockDriver("mongodb"), isDefault: true });

    const qb = new MongoQueryBuilder("orders", dataSource);
    qb.hydrate(() => "MODEL");
    qb.groupBy("category", { revenue: { $sum: "$amount" } } as any);
    expect(qb.hydrateCallback).toBeUndefined();

    const qb2 = new MongoQueryBuilder("orders", dataSource);
    qb2.hydrate(() => "MODEL");
    qb2.groupByDate("created_at", "month");
    expect(qb2.hydrateCallback).toBeUndefined();
  });
});

describe("pg scalar aggregates (K4 B10)", () => {
  afterEach(() => dataSourceRegistry.clear());

  function build(row: Record<string, unknown> | undefined) {
    const driver = createMockDriver("postgres");
    (driver as any).dialect = new PostgresDialect();
    (driver as any).query = vi.fn().mockResolvedValue({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    const dataSource = new DataSource({ name: "t", driver, isDefault: true });
    return { driver: driver as any, qb: new PostgresQueryBuilder("users", dataSource) };
  }

  it("quotes the field so an injection payload stays an identifier", async () => {
    const { driver, qb } = build({ sum: "1" });
    await qb.sum("price) FROM users; --");

    const [sql] = driver.query.mock.calls[0];
    expect(sql).toContain('SUM("price) FROM users; --")');
  });

  it("countDistinct quotes the field", async () => {
    const { driver, qb } = build({ count: "2" });
    await qb.countDistinct('a" ,1');
    expect(driver.query.mock.calls[0][0]).toContain("COUNT(DISTINCT \"a\"\" ,1\")");
  });

  it("avg/min/max return null on an empty set", async () => {
    expect(await build({ avg: null }).qb.avg("price")).toBeNull();
    expect(await build({ min: null }).qb.min("price")).toBeNull();
    expect(await build({ max: null }).qb.max("price")).toBeNull();
  });

  it("min/max keep dates and text intact, and parse numeric strings", async () => {
    const date = new Date("2024-03-01T00:00:00Z");
    expect(await build({ min: date }).qb.min<Date>("createdAt")).toBe(date);
    expect(await build({ max: "2024-03-01 10:00:00" }).qb.max<string>("createdAt")).toBe("2024-03-01 10:00:00");
    expect(await build({ max: "12.5" }).qb.max("price")).toBe(12.5);
  });
});
