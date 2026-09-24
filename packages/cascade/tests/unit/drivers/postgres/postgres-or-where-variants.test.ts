import { describe, expect, it } from "vitest";
import {
  PostgresQueryParser,
  type PostgresParserOperation,
} from "../../../../src/drivers/postgres/postgres-query-parser";
import { QueryBuilder } from "../../../../src/query-builder/query-builder";

function parse(operations: unknown[]) {
  return new PostgresQueryParser({
    table: "users",
    operations: operations as PostgresParserOperation[],
  }).parse();
}

describe("W2b postgres or* where variants", () => {
  it("orWhereIn / orWhereNotIn / orWhereNull / orWhereNotNull / orWhereBetween use OR", () => {
    const base = { type: "where", data: { field: "a", operator: "=", value: 1 } };
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["orWhereIn", { field: "s", values: [1, 2] }, / OR .*= ANY\(\$2\)/],
      ["orWhereNotIn", { field: "s", values: [1] }, / OR .*!= ALL\(\$2\)/],
      ["orWhereNull", { field: "s" }, / OR .*IS NULL/],
      ["orWhereNotNull", { field: "s" }, / OR .*IS NOT NULL/],
      ["orWhereBetween", { field: "s", range: [1, 5] }, / OR .*BETWEEN \$2 AND \$3/],
    ];

    for (const [type, data, expected] of cases) {
      const { query } = parse([base, { type, data }]);
      expect(query, type).toMatch(expected);
    }
  });

  it("whereStartsWith('%') escapes the wildcard and states ESCAPE", () => {
    const builder = new QueryBuilder("users") as any;
    builder.whereStartsWith("name", "%");
    const { query, bindings } = parse(builder.getOps("whereLike"));

    expect(bindings).toEqual(["\\%%"]);
    expect(query).toContain("ESCAPE '\\'");
  });

  it("whereEndsWith escapes %, _ and backslash", () => {
    const builder = new QueryBuilder("users") as any;
    builder.whereEndsWith("name", "a%_\\");
    const { bindings } = parse(builder.getOps("whereLike"));

    expect(bindings).toEqual(["%a\\%\\_\\\\"]);
  });
});
