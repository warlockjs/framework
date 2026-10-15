import { describe, expect, it } from "vitest";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import {
  PostgresQueryParser,
  type PostgresParserOperation,
} from "../../../../src/drivers/postgres/postgres-query-parser";

function parse(operations: unknown[], table = "users") {
  return new PostgresQueryParser({
    table,
    operations: operations as PostgresParserOperation[],
  }).parse();
}

describe("PostgresQueryParser - SQL injection hardening", () => {
  it("rejects a hostile ::cast suffix", () => {
    expect(() =>
      parse([{ type: "where", data: { field: "meta.age::text; DROP TABLE users--", value: 1 } }]),
    ).toThrow();
  });

  it("accepts innocent casts unchanged", () => {
    const { query } = parse([
      { type: "where", data: { field: "meta.score::numeric(10,2)", value: 1 } },
      { type: "where", data: { field: "meta.tags::text[]", value: "a" } },
      { type: "where", data: { field: "meta.at::timestamp with time zone", value: "a" } },
    ]);

    expect(query).toContain(`("users"."meta"->>'score')::numeric(10,2)`);
    expect(query).toContain(`("users"."meta"->>'tags')::text[]`);
    expect(query).toContain(`::timestamp with time zone`);
  });

  it("doubles single quotes in JSON path keys", () => {
    const { query } = parse([
      { type: "where", data: { field: "meta.a'||pg_sleep(5)||'", value: 1 } },
    ]);

    expect(query).toContain(`->>'a''||pg_sleep(5)||'''`);
  });

  it("leaves innocent JSON path keys unchanged", () => {
    const { query } = parse([{ type: "where", data: { field: "meta.address.city", value: "x" } }]);

    expect(query).toContain(`"users"."meta"->'address'->>'city'`);
  });

  it("rejects a hostile orderBy direction", () => {
    expect(() =>
      parse([{ type: "orderBy", data: { field: "name", direction: "asc; DROP" } }]),
    ).toThrow();
  });

  it("accepts asc/desc with optional NULLS placement", () => {
    const { query } = parse([
      { type: "orderBy", data: { field: "name", direction: "desc" } },
      { type: "orderBy", data: { field: "age", direction: "asc nulls last" } },
    ]);

    expect(query).toContain(`"name" DESC, `);
    expect(query).toContain(`"age" ASC NULLS LAST`);
  });

  it("rejects an unknown where operator", () => {
    expect(() =>
      parse([{ type: "where", data: { field: "id", operator: "= 1 OR 1=1 --", value: 1 } }]),
    ).toThrow();
  });

  it("rejects an unknown having / whereColumn operator", () => {
    expect(() =>
      parse([{ type: "having", data: { field: "n", operator: "= 1 OR 1=1 --", value: 1 } }]),
    ).toThrow();
    expect(() =>
      parse([{ type: "whereColumn", data: { first: "a", operator: "= 1 --", second: "b" } }]),
    ).toThrow();
  });

  it("keeps innocent operators unchanged", () => {
    const { query } = parse([{ type: "where", data: { field: "age", operator: ">=", value: 18 } }]);

    expect(query).toContain(`>= $1`);
  });

  it("rejects a hostile LIMIT / OFFSET", () => {
    const dialect = new PostgresDialect();

    expect(() => dialect.limitOffset("1; DROP" as unknown as number)).toThrow();
    expect(() => dialect.limitOffset(10, "1; DROP" as unknown as number)).toThrow();
    expect(() => dialect.limitOffset(-1)).toThrow();
    expect(() => dialect.limitOffset(1.5)).toThrow();
    expect(() => dialect.limitOffset(Number.NaN)).toThrow();
  });

  it("keeps innocent LIMIT / OFFSET unchanged", () => {
    expect(new PostgresDialect().limitOffset(10, 20)).toBe("LIMIT 10 OFFSET 20");
  });

  it("quotes hostile identifiers instead of splicing them", () => {
    const { query } = parse([{ type: "where", data: { field: 'na"me', value: 1 } }]);

    expect(query).toContain(`"na""me"`);
  });

  it("escapes hostile JSON keys in the dialect helpers", () => {
    const dialect = new PostgresDialect();

    expect(dialect.jsonExtract("data", "a'||pg_sleep(5)||'")).toBe(
      `"data"->>'a''||pg_sleep(5)||'''`,
    );
    expect(() => dialect.dateTruncSql("created_at", "day'); DROP" as "day")).toThrow();
  });
});
