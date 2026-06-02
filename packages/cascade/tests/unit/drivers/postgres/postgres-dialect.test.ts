import { describe, expect, it } from "vitest";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";

/**
 * Pure-logic tests for the PostgreSQL dialect.
 *
 * `PostgresDialect` carries no I/O — every method is a deterministic string
 * transform — so these tests run without a database. They lock the exact SQL
 * fragments the dialect emits (placeholders, identifier quoting, JSONB paths,
 * type mapping, aggregate translation) so a refactor can't silently change the
 * generated SQL.
 */
describe("PostgresDialect", () => {
  const dialect = new PostgresDialect();

  describe("static metadata", () => {
    it("identifies itself as postgres", () => {
      expect(dialect.name).toBe("postgres");
    });

    it("declares RETURNING support and ON CONFLICT upsert", () => {
      expect(dialect.supportsReturning).toBe(true);
      expect(dialect.upsertKeyword).toBe("ON CONFLICT");
    });
  });

  describe("placeholder()", () => {
    it("uses numbered $N placeholders", () => {
      expect(dialect.placeholder(1)).toBe("$1");
      expect(dialect.placeholder(42)).toBe("$42");
    });
  });

  describe("quoteIdentifier()", () => {
    it("wraps a simple identifier in double quotes", () => {
      expect(dialect.quoteIdentifier("user")).toBe('"user"');
    });

    it("quotes each segment of a qualified name independently", () => {
      expect(dialect.quoteIdentifier("schema.table.column")).toBe('"schema"."table"."column"');
    });

    it("escapes embedded double quotes by doubling them", () => {
      expect(dialect.quoteIdentifier('weird"name')).toBe('"weird""name"');
    });
  });

  describe("booleanLiteral()", () => {
    it("maps booleans to TRUE / FALSE literals", () => {
      expect(dialect.booleanLiteral(true)).toBe("TRUE");
      expect(dialect.booleanLiteral(false)).toBe("FALSE");
    });
  });

  describe("limitOffset()", () => {
    it("emits both clauses when both are provided", () => {
      expect(dialect.limitOffset(10, 20)).toBe("LIMIT 10 OFFSET 20");
    });

    it("emits only LIMIT when offset is omitted", () => {
      expect(dialect.limitOffset(10)).toBe("LIMIT 10");
    });

    it("emits only OFFSET when limit is omitted", () => {
      expect(dialect.limitOffset(undefined, 5)).toBe("OFFSET 5");
    });

    it("emits an empty string when neither is provided", () => {
      expect(dialect.limitOffset()).toBe("");
    });
  });

  describe("jsonExtract()", () => {
    it("uses ->> for a single-level path", () => {
      expect(dialect.jsonExtract("data", "name")).toBe(`"data"->>'name'`);
    });

    it("uses -> for intermediate keys and ->> for the final key on nested paths", () => {
      expect(dialect.jsonExtract("data", "user.name")).toBe(`"data"->'user'->>'name'`);
    });
  });

  describe("jsonContains()", () => {
    it("uses the @> containment operator with a jsonb cast", () => {
      expect(dialect.jsonContains("data", { active: true })).toBe(
        `"data" @> '{"active":true}'::jsonb`,
      );
    });

    it("wraps the value under the path when a path is given", () => {
      expect(dialect.jsonContains("data", "NYC", "city")).toBe(
        `"data" @> '{"city":"NYC"}'::jsonb`,
      );
    });
  });

  describe("likePattern()", () => {
    it("defaults to case-insensitive ILIKE and escapes %, _ and backslash", () => {
      expect(dialect.likePattern("50%_off")).toEqual({
        operator: "ILIKE",
        pattern: "50\\%\\_off",
      });
    });

    it("uses case-sensitive LIKE when caseInsensitive is false", () => {
      expect(dialect.likePattern("foo", false).operator).toBe("LIKE");
    });
  });

  describe("arrayContains()", () => {
    it("builds a `= ANY(column)` expression with a placeholder", () => {
      expect(dialect.arrayContains("tags", 2)).toBe(`$2 = ANY("tags")`);
    });
  });

  describe("getSqlType()", () => {
    it("maps string to VARCHAR(length) when a length is provided", () => {
      expect(dialect.getSqlType("string", { length: 120 })).toBe("VARCHAR(120)");
    });

    it("maps string to TEXT when no length is provided", () => {
      expect(dialect.getSqlType("string")).toBe("TEXT");
    });

    it("maps decimal to DECIMAL(precision, scale)", () => {
      expect(dialect.getSqlType("decimal", { precision: 10, scale: 2 })).toBe("DECIMAL(10, 2)");
    });

    it("maps json to JSONB", () => {
      expect(dialect.getSqlType("json")).toBe("JSONB");
    });

    it("maps timestamp to TIMESTAMPTZ", () => {
      expect(dialect.getSqlType("timestamp")).toBe("TIMESTAMPTZ");
    });

    it("maps vector to VECTOR(dimensions) when dimensions are provided", () => {
      expect(dialect.getSqlType("vector", { dimensions: 1536 })).toBe("VECTOR(1536)");
    });

    it("uppercases an unknown type as a passthrough fallback", () => {
      expect(dialect.getSqlType("customType")).toBe("CUSTOMTYPE");
    });
  });

  describe("aggregateToSql()", () => {
    it("translates count to COUNT(*)", () => {
      expect(dialect.aggregateToSql({ __agg: "count", __field: null })).toBe("COUNT(*)");
    });

    it("translates sum / avg / min / max to their ANSI SQL function over a quoted column", () => {
      expect(dialect.aggregateToSql({ __agg: "sum", __field: "amount" })).toBe(`SUM("amount")`);
      expect(dialect.aggregateToSql({ __agg: "avg", __field: "rating" })).toBe(`AVG("rating")`);
      expect(dialect.aggregateToSql({ __agg: "min", __field: "price" })).toBe(`MIN("price")`);
      expect(dialect.aggregateToSql({ __agg: "max", __field: "price" })).toBe(`MAX("price")`);
    });

    it("throws for MongoDB-only aggregates (distinct/floor/first/last)", () => {
      expect(() => dialect.aggregateToSql({ __agg: "distinct", __field: "color" })).toThrow(
        /MongoDB-only/,
      );
      expect(() => dialect.aggregateToSql({ __agg: "first", __field: "name" })).toThrow(
        /MongoDB-only/,
      );
    });
  });
});
