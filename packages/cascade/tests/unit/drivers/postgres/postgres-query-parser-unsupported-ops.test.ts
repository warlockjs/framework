import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../../src/data-source/data-source-registry";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../../src/drivers/postgres/postgres-query-builder";
import {
  PostgresQueryParser,
  type PostgresParserOperation,
} from "../../../../src/drivers/postgres/postgres-query-parser";
import { createMockDriver } from "../../../helpers/mock-driver";

function parse(operations: PostgresParserOperation[], table = "sessions") {
  return new PostgresQueryParser({ table, operations }).parse();
}

describe("PostgresQueryParser - ops that used to be silently dropped", () => {
  it("whereDateBefore compares the date portion", () => {
    const { query, bindings } = parse([
      { type: "whereDateBefore", data: { field: "expires_at", value: "2024-05-01" } },
    ] as PostgresParserOperation[]);

    expect(query).toBe(`SELECT * FROM "sessions" WHERE "sessions"."expires_at"::date < $1::date`);
    expect(bindings).toEqual(["2024-05-01"]);
  });

  it("whereDate and whereDateAfter", () => {
    expect(
      parse([{ type: "whereDate", data: { field: "createdAt", value: "2024-05-01" } }] as never)
        .query,
    ).toContain(`"createdAt"::date = $1::date`);
    expect(
      parse([{ type: "whereDateAfter", data: { field: "createdAt", value: "2024-05-01" } }] as never)
        .query,
    ).toContain(`"createdAt"::date > $1::date`);
  });

  it("whereDateBetween is an inclusive date range", () => {
    const { query, bindings } = parse([
      { type: "whereDateBetween", data: { field: "createdAt", range: ["2024-01-01", "2024-02-01"] } },
    ] as never);

    expect(query).toContain(`"createdAt"::date BETWEEN $1::date AND $2::date`);
    expect(bindings).toEqual(["2024-01-01", "2024-02-01"]);
  });

  it("whereNot wraps the nested group in NOT (...)", () => {
    const { query, bindings } = parse(
      [
        {
          type: "whereNot",
          data: { nested: [{ type: "where", data: { field: "role", operator: "=", value: "admin" } }] },
        },
      ] as never,
      "users",
    );

    expect(query).toBe(`SELECT * FROM "users" WHERE NOT ("users"."role" = $1)`);
    expect(bindings).toEqual(["admin"]);
  });

  it("orWhereNot uses OR and renumbers placeholders", () => {
    const { query, bindings } = parse(
      [
        { type: "where", data: { field: "a", operator: "=", value: 1 } },
        {
          type: "orWhereNot",
          data: { nested: [{ type: "where", data: { field: "b", operator: "=", value: 2 } }] },
        },
      ] as never,
      "users",
    );

    expect(query).toBe(`SELECT * FROM "users" WHERE "users"."a" = $1 OR NOT ("users"."b" = $2)`);
    expect(bindings).toEqual([1, 2]);
  });

  it("whereExists / whereNotExists callback forms apply / negate the group", () => {
    const nested = [{ type: "where", data: { field: "x", operator: "=", value: 1 } }];

    expect(parse([{ type: "whereExists", data: { subquery: nested } }] as never, "t").query).toBe(
      `SELECT * FROM "t" WHERE ("t"."x" = $1)`,
    );
    expect(
      parse([{ type: "whereNotExists", data: { subquery: nested } }] as never, "t").query,
    ).toBe(`SELECT * FROM "t" WHERE NOT ("t"."x" = $1)`);
  });

  it("throws on an empty negated group instead of dropping it", () => {
    expect(() => parse([{ type: "whereNot", data: { nested: [] } }] as never)).toThrow(/empty/);
  });

  it("throws on an unknown operation type instead of dropping it", () => {
    expect(() => parse([{ type: "whereBogus", data: {} }] as never)).toThrow(
      /unsupported operation type "whereBogus"/,
    );
  });
});

describe("PostgresQueryBuilder - has / whereHas / doesntHave in write filters", () => {
  let dataSource: DataSource;
  let driver: ReturnType<typeof createMockDriver>;

  class Order {
    public static table = "orders";
    public static primaryKey = "id";
  }

  beforeEach(() => {
    driver = createMockDriver("postgres");
    (driver as any).dialect = new PostgresDialect();
    (driver as any).query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    dataSource = new DataSource({ name: "test", driver, isDefault: true });
    dataSourceRegistry.register(dataSource);
  });

  afterEach(() => {
    dataSourceRegistry.clear();
    vi.clearAllMocks();
  });

  function builder() {
    const qb = new PostgresQueryBuilder("users", dataSource);
    (qb as any).relationDefinitions = {
      orders: { type: "hasMany", model: Order, foreignKey: "user_id", localKey: "id" },
    };
    return qb;
  }

  it("doesntHave(...).delete() emits NOT EXISTS instead of an unfiltered DELETE", async () => {
    await builder().doesntHave("orders").delete();

    const [sql] = (driver as any).query.mock.calls[0];
    expect(sql).toContain(
      `WHERE NOT EXISTS (SELECT 1 FROM "orders" WHERE "orders"."user_id" = "users"."id")`,
    );
  });

  it("whereHas(...).delete() adds the callback conditions inside EXISTS", async () => {
    await builder()
      .whereHas("orders", (q: any) => q.where("status", "=", "paid"))
      .delete();

    const [sql, params] = (driver as any).query.mock.calls[0];
    expect(sql).toContain(`WHERE EXISTS (SELECT 1 FROM "orders" WHERE "orders"."user_id" = "users"."id" AND`);
    expect(sql).toContain(`"status" = $1`);
    expect(params).toEqual(["paid"]);
  });

  it("has(...).delete() emits EXISTS", async () => {
    await builder().has("orders").delete();

    const [sql] = (driver as any).query.mock.calls[0];
    expect(sql).toContain(`WHERE EXISTS (SELECT 1 FROM "orders"`);
  });

  it("an unknown relation throws instead of dropping the filter", async () => {
    await expect(builder().doesntHave("nope").delete()).rejects.toThrow(/not found/);
  });
});
