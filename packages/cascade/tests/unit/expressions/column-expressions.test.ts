import { describe, expect, it } from "vitest";
import {
  $expr,
  isColumnExpression,
  toColumnExpression,
} from "../../../src/expressions/column-expressions";

/**
 * Pure-shape tests for the typed column-expression DSL.
 *
 * The builders are grouped under `$expr` (mirroring `$agg`). They carry no I/O
 * — each returns a plain, closed node — so the tests lock the exact tree shape
 * every combinator emits. Driver translation of these nodes lives in the
 * per-dialect tests (Postgres `columnExpressionToSql`, Mongo
 * `columnExpressionToMongo`).
 */
describe("Column Expressions ($expr)", () => {
  describe("$expr.col()", () => {
    it("builds a column-reference node", () => {
      expect($expr.col("price")).toEqual({ __expr: "column", column: "price" });
    });
  });

  describe("$expr.lit()", () => {
    it("builds a numeric literal node", () => {
      expect($expr.lit(1.2)).toEqual({ __expr: "literal", value: 1.2 });
    });

    it("builds a boolean literal node", () => {
      expect($expr.lit(true)).toEqual({ __expr: "literal", value: true });
    });
  });

  describe("$expr.mul()", () => {
    it("is variadic and normalizes bare strings to column references", () => {
      expect($expr.mul("price", "quantity")).toEqual({
        __expr: "multiply",
        operands: [
          { __expr: "column", column: "price" },
          { __expr: "column", column: "quantity" },
        ],
      });
    });

    it("nests expression nodes and literals", () => {
      expect($expr.mul("price", $expr.lit(1.2))).toEqual({
        __expr: "multiply",
        operands: [
          { __expr: "column", column: "price" },
          { __expr: "literal", value: 1.2 },
        ],
      });
    });
  });

  describe("$expr.add()", () => {
    it("is variadic", () => {
      expect($expr.add("a", "b", "c")).toEqual({
        __expr: "add",
        operands: [
          { __expr: "column", column: "a" },
          { __expr: "column", column: "b" },
          { __expr: "column", column: "c" },
        ],
      });
    });
  });

  describe("$expr.sub() / $expr.div()", () => {
    it("sub() takes exactly two operands (left, right)", () => {
      expect($expr.sub("a", "b")).toEqual({
        __expr: "subtract",
        operands: [
          { __expr: "column", column: "a" },
          { __expr: "column", column: "b" },
        ],
      });
    });

    it("div() takes exactly two operands (left, right)", () => {
      expect($expr.div($expr.lit(100), "count")).toEqual({
        __expr: "divide",
        operands: [
          { __expr: "literal", value: 100 },
          { __expr: "column", column: "count" },
        ],
      });
    });
  });

  describe("$expr.raw()", () => {
    it("wraps a verbatim string as a raw node", () => {
      expect($expr.raw("price * quantity")).toEqual({
        __expr: "raw",
        expression: "price * quantity",
      });
    });
  });

  describe("isColumnExpression()", () => {
    it("accepts a typed node", () => {
      expect(isColumnExpression($expr.col("a"))).toBe(true);
      expect(isColumnExpression($expr.mul("a", "b"))).toBe(true);
    });

    it("rejects a bare string, null, and a plain object", () => {
      expect(isColumnExpression("price")).toBe(false);
      expect(isColumnExpression(null)).toBe(false);
      expect(isColumnExpression({ column: "price" })).toBe(false);
    });
  });

  describe("toColumnExpression()", () => {
    it("treats a bare string as a column reference", () => {
      expect(toColumnExpression("price")).toEqual({ __expr: "column", column: "price" });
    });

    it("passes an existing node through unchanged", () => {
      const node = $expr.mul("price", "quantity");
      expect(toColumnExpression(node)).toBe(node);
    });
  });
});
