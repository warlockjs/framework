import { afterEach, describe, expect, it } from "vitest";
import { DataSource } from "../../../src/data-source/data-source";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { MongoQueryBuilder } from "../../../src/drivers/mongodb/mongodb-query-builder";
import { PostgresDialect } from "../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../src/drivers/postgres/postgres-query-builder";
import { PostgresQueryParser } from "../../../src/drivers/postgres/postgres-query-parser";
import { createMockDriver } from "../../helpers/mock-driver";

describe("whereNot shorthand forms", () => {
  afterEach(() => dataSourceRegistry.clear());

  const pgSql = (build: (q: PostgresQueryBuilder) => void) => {
    const driver = createMockDriver("postgres");
    (driver as any).dialect = new PostgresDialect();
    const qb = new PostgresQueryBuilder(
      "users",
      new DataSource({ name: "t", driver, isDefault: true }),
    );
    build(qb);
    return new PostgresQueryParser({
      table: "users",
      dialect: (driver as any).dialect,
      operations: qb.operations as any,
    }).parse();
  };

  it("postgres: whereNot(field, value) negates the equality", () => {
    const { query, bindings } = pgSql((q) => q.whereNot("status", "archived"));

    expect(query).toContain("NOT");
    expect(query).toContain(`"status" =`);
    expect(bindings).toEqual(["archived"]);
  });

  it("postgres: whereNot(field, operator, value) and object form negate", () => {
    const op = pgSql((q) => q.whereNot("age", "<", 18));
    expect(op.query).toContain("NOT");
    expect(op.bindings).toEqual([18]);

    const obj = pgSql((q) => q.whereNot({ status: "banned" }));
    expect(obj.query).toContain("NOT");
    expect(obj.bindings).toEqual(["banned"]);
  });

  it("postgres: callback form still works and orWhereNot accepts a field and value", () => {
    const cb = pgSql((q) => q.whereNot((s) => s.where("status", "banned")));
    expect(cb.query).toContain("NOT");

    const or = pgSql((q) => q.where("a", 1).orWhereNot("status", "archived"));
    expect(or.query).toContain("OR NOT");
    expect(or.bindings).toEqual([1, "archived"]);
  });

  it("mongodb: whereNot(field, value) records a negated match", () => {
    const driver = createMockDriver("mongodb") as unknown as {
      database: { collection: (name: string) => unknown };
    };
    driver.database = { collection: (name: string) => ({ collectionName: name }) };
    const qb = new MongoQueryBuilder(
      "users",
      new DataSource({ name: "t", driver: driver as never, isDefault: true }),
    );
    qb.whereNot("status", "archived");
    qb.orWhereNot("age", "<", 18);

    const filter = JSON.stringify(qb.parse().pipeline);
    expect(filter).toContain("$nor");
    expect(filter).toContain("archived");
  });
});
