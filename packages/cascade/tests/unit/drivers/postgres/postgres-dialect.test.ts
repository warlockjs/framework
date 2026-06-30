import { describe, expect, it } from "vitest";
import { PostgresDialect } from "../../../../src/drivers/postgres/postgres-dialect";
import { $expr } from "../../../../src/expressions";

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

    it("translates countDistinct to COUNT(DISTINCT col) over a quoted column", () => {
      expect(dialect.aggregateToSql({ __agg: "countDistinct", __field: "city" })).toBe(
        `COUNT(DISTINCT "city")`,
      );
    });

    it("throws for MongoDB-only aggregates (distinct/floor/first/last)", () => {
      expect(() => dialect.aggregateToSql({ __agg: "distinct", __field: "color" })).toThrow(
        /MongoDB-only/,
      );
      expect(() => dialect.aggregateToSql({ __agg: "first", __field: "name" })).toThrow(
        /MongoDB-only/,
      );
    });

    it("translates $agg.sum over a composed expression to SUM(<expr>)", () => {
      expect(
        dialect.aggregateToSql({ __agg: "sum", __field: null, __expr: $expr.mul("price", "quantity") }),
      ).toBe(`SUM(("price" * "quantity"))`);
    });

    it("emits the raw expression verbatim for $agg.sumRaw", () => {
      expect(
        dialect.aggregateToSql({
          __agg: "sum",
          __field: null,
          __expr: { __expr: "raw", expression: "price * quantity * (1 - discount)" },
        }),
      ).toBe("SUM(price * quantity * (1 - discount))");
    });

    it("throws when a composed expression is used with a non-sum aggregate", () => {
      expect(() =>
        dialect.aggregateToSql({ __agg: "avg", __field: null, __expr: $expr.mul("a", "b") }),
      ).toThrow(/only \$agg\.sum/);
    });
  });

  describe("columnExpressionToSql()", () => {
    it("quotes a column reference", () => {
      expect(dialect.columnExpressionToSql($expr.col("price"))).toBe(`"price"`);
    });

    it("emits a numeric literal verbatim and a boolean as TRUE/FALSE", () => {
      expect(dialect.columnExpressionToSql($expr.lit(1.2))).toBe("1.2");
      expect(dialect.columnExpressionToSql($expr.lit(true))).toBe("TRUE");
    });

    it("parenthesises multiply / add / subtract / divide", () => {
      expect(dialect.columnExpressionToSql($expr.mul("price", "quantity"))).toBe(`("price" * "quantity")`);
      expect(dialect.columnExpressionToSql($expr.add("a", "b"))).toBe(`("a" + "b")`);
      expect(dialect.columnExpressionToSql($expr.sub("a", "b"))).toBe(`("a" - "b")`);
      expect(dialect.columnExpressionToSql($expr.div("a", "b"))).toBe(`("a" / "b")`);
    });

    it("composes nested expressions: price * quantity * (1 - discount)", () => {
      expect(dialect.columnExpressionToSql($expr.mul("price", "quantity", $expr.sub($expr.lit(1), $expr.col("discount"))))).toBe(
        `("price" * "quantity" * (1 - "discount"))`,
      );
    });

    it("emits a raw node verbatim", () => {
      expect(dialect.columnExpressionToSql($expr.raw("price * 1.2"))).toBe("price * 1.2");
    });
  });

  describe("dateTruncSql()", () => {
    it("builds date_trunc('<unit>', \"column\") for each granularity", () => {
      expect(dialect.dateTruncSql("created_at", "day")).toBe(`date_trunc('day', "created_at")`);
      expect(dialect.dateTruncSql("created_at", "week")).toBe(`date_trunc('week', "created_at")`);
      expect(dialect.dateTruncSql("created_at", "month")).toBe(`date_trunc('month', "created_at")`);
      expect(dialect.dateTruncSql("created_at", "year")).toBe(`date_trunc('year', "created_at")`);
    });

    it("quotes a qualified column name segment-by-segment", () => {
      expect(dialect.dateTruncSql("orders.created_at", "month")).toBe(
        `date_trunc('month', "orders"."created_at")`,
      );
    });
  });
});
