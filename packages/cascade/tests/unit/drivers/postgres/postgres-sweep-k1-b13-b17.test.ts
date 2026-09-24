import { describe, expect, it, vi } from "vitest";
import { DataSource } from "../../../../src/data-source/data-source";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import { PostgresQueryBuilder } from "../../../../src/drivers/postgres/postgres-query-builder";
import {
  PostgresQueryParser,
  type PostgresParserOperation,
} from "../../../../src/drivers/postgres/postgres-query-parser";
import { createMockDriver } from "../../../helpers/mock-driver";

function parse(operations: unknown[]) {
  return new PostgresQueryParser({
    table: "users",
    operations: operations as PostgresParserOperation[],
  }).parse();
}

function makeBuilder() {
  const driver = createMockDriver("postgres");
  (driver as any).dialect = new PostgresDialect();
  const query = vi.fn().mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 });
  (driver as any).query = query;
  const dataSource = new DataSource({ name: "k1", driver, isDefault: false } as never);
  return { builder: new PostgresQueryBuilder("users", dataSource), query };
}

describe("K1 B13-B17 postgres", () => {
  it("B13: orWhere in keeps OR", () => {
    const { query } = parse([
      { type: "where", data: { field: "a", operator: "=", value: 1 } },
      { type: "orWhere", data: { field: "s", operator: "in", value: [1, 2] } },
    ]);
    expect(query).toContain(" OR ");
  });

  it("B14: startsWith adds a wildcard, RegExp maps to ~*", () => {
    const starts = parse([
      { type: "where", data: { field: "n", operator: "startsWith", value: "ab" } },
    ]);
    expect(starts.bindings).toEqual(["ab%"]);

    const regex = parse([{ type: "whereLike", data: { field: "n", pattern: /^ab/ } }]);
    expect(regex.query).toContain("~* $1");
    expect(regex.bindings).toEqual(["^ab"]);
  });

  it("B15: whereJsonContains binds the JSON value", () => {
    const { query, bindings } = parse([
      { type: "whereJsonContains", data: { path: "meta", value: "O'Brien" } },
    ]);
    expect(query).toContain("@> $1::jsonb");
    expect(bindings).toEqual([JSON.stringify("O'Brien")]);
  });

  it("B16: exists probes with LIMIT 1 instead of COUNT(*)", async () => {
    const { builder, query } = makeBuilder();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await builder.where("a", 1).exists();
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("LIMIT 1");
    expect(sql).not.toContain("COUNT");
  });

  it("B16: count of a grouped query counts groups", async () => {
    const { builder, query } = makeBuilder();
    await builder.groupBy("country").count();
    expect(query.mock.calls[0][0]).toContain("FROM (SELECT");
  });
});
