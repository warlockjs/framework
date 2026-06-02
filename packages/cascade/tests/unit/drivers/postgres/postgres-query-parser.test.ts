import { describe, expect, it } from "vitest";
import {
  PostgresQueryParser,
  type PostgresParserOperation,
} from "../../../../src/drivers/postgres/postgres-query-parser";

/**
 * Pure-logic tests for the PostgreSQL query parser.
 *
 * The parser turns an abstract operation list into `{ query, bindings }` with no
 * database connection — it is the single most important pure-logic surface in the
 * Postgres driver. These tests pin the exact SQL string and parameter array each
 * operation type produces (WHERE variants, SELECT, ORDER BY, GROUP BY, LIMIT /
 * OFFSET, JOIN, AND/OR chaining, JSONB paths), so SQL generation can't drift
 * unnoticed.
 *
 * `parse()` is invoked once per parser instance: it mutates internal param state,
 * so each assertion builds a fresh parser.
 */
function parse(operations: PostgresParserOperation[], table = "users") {
  return new PostgresQueryParser({ table, operations }).parse();
}

describe("PostgresQueryParser", () => {
  describe("base query", () => {
    it("selects all columns from the quoted table when no operations are given", () => {
      const result = parse([]);

      expect(result.query).toBe(`SELECT * FROM "users"`);
      expect(result.bindings).toEqual([]);
    });

    it("aliases the table with AS when an alias is supplied", () => {
      const result = new PostgresQueryParser({ table: "users", alias: "u", operations: [] }).parse();

      expect(result.query).toBe(`SELECT * FROM "users" AS "u"`);
    });
  });

  describe("where()", () => {
    it("builds an equality clause with a $1 placeholder and qualified column", () => {
      const result = parse([{ type: "where", data: { field: "name", operator: "=", value: "Alice" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."name" = $1`);
      expect(result.bindings).toEqual(["Alice"]);
    });

    it("maps a comparison operator straight through", () => {
      const result = parse([{ type: "where", data: { field: "age", operator: ">", value: 18 } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."age" > $1`);
      expect(result.bindings).toEqual([18]);
    });

    it("emits IS NULL (no binding) when the value is null", () => {
      const result = parse([{ type: "where", data: { field: "deletedAt", operator: "=", value: null } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."deletedAt" IS NULL`);
      expect(result.bindings).toEqual([]);
    });

    it("emits IS NOT NULL when the operator is != and the value is null", () => {
      const result = parse([{ type: "where", data: { field: "deletedAt", operator: "!=", value: null } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."deletedAt" IS NOT NULL`);
    });

    it("treats a dotted field with no known table prefix as a JSONB path", () => {
      const result = parse([{ type: "where", data: { field: "meta.city", operator: "=", value: "NYC" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."meta"->>'city' = $1`);
      expect(result.bindings).toEqual(["NYC"]);
    });
  });

  describe("whereIn() / whereNotIn()", () => {
    it("uses = ANY($1) for whereIn with the array bound as a single param", () => {
      const result = parse([{ type: "whereIn", data: { field: "id", values: [1, 2, 3] } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."id" = ANY($1)`);
      expect(result.bindings).toEqual([[1, 2, 3]]);
    });

    it("uses != ALL($1) for whereNotIn", () => {
      const result = parse([{ type: "whereNotIn", data: { field: "id", values: [1, 2] } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."id" != ALL($1)`);
      expect(result.bindings).toEqual([[1, 2]]);
    });
  });

  describe("whereNull() / whereNotNull()", () => {
    it("emits IS NULL", () => {
      const result = parse([{ type: "whereNull", data: { field: "deletedAt" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."deletedAt" IS NULL`);
    });

    it("emits IS NOT NULL", () => {
      const result = parse([{ type: "whereNotNull", data: { field: "email" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."email" IS NOT NULL`);
    });
  });

  describe("whereBetween()", () => {
    it("emits BETWEEN $1 AND $2 with both bounds bound", () => {
      const result = parse([{ type: "whereBetween", data: { field: "age", range: [18, 65] } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."age" BETWEEN $1 AND $2`);
      expect(result.bindings).toEqual([18, 65]);
    });
  });

  describe("whereLike()", () => {
    it("uses the dialect's ILIKE operator and binds the pattern", () => {
      const result = parse([{ type: "whereLike", data: { field: "name", pattern: "%foo%" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."name" ILIKE $1`);
      expect(result.bindings).toEqual(["%foo%"]);
    });
  });

  describe("select()", () => {
    it("projects an explicit, qualified column list", () => {
      const result = parse([{ type: "select", data: { fields: ["id", "name"] } }]);

      expect(result.query).toBe(`SELECT "users"."id", "users"."name" FROM "users"`);
    });
  });

  describe("orderBy()", () => {
    it("uppercases the direction and qualifies the column", () => {
      const result = parse([{ type: "orderBy", data: { field: "createdAt", direction: "desc" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" ORDER BY "users"."createdAt" DESC`);
    });

    it("defaults to ASC when no direction is given", () => {
      const result = parse([{ type: "orderBy", data: { field: "name" } }]);

      expect(result.query).toBe(`SELECT * FROM "users" ORDER BY "users"."name" ASC`);
    });
  });

  describe("groupBy()", () => {
    it("emits a GROUP BY clause over quoted columns", () => {
      const result = parse([{ type: "groupBy", data: { fields: ["status"] } }]);

      expect(result.query).toBe(`SELECT * FROM "users" GROUP BY "status"`);
    });
  });

  describe("limit() / offset()", () => {
    it("appends LIMIT and OFFSET in order", () => {
      const result = parse([
        { type: "limit", data: { value: 10 } },
        { type: "offset", data: { value: 20 } },
      ]);

      expect(result.query).toBe(`SELECT * FROM "users" LIMIT 10 OFFSET 20`);
    });
  });

  describe("distinct()", () => {
    it("injects DISTINCT into the SELECT clause", () => {
      const result = parse([{ type: "distinct", data: {} }]);

      expect(result.query).toBe(`SELECT DISTINCT * FROM "users"`);
    });
  });

  describe("boolean chaining", () => {
    it("joins consecutive where clauses with AND, numbering placeholders in order", () => {
      const result = parse([
        { type: "where", data: { field: "a", operator: "=", value: 1 } },
        { type: "where", data: { field: "b", operator: ">", value: 2 } },
      ]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."a" = $1 AND "users"."b" > $2`);
      expect(result.bindings).toEqual([1, 2]);
    });

    it("joins an orWhere with OR", () => {
      const result = parse([
        { type: "where", data: { field: "a", operator: "=", value: 1 } },
        { type: "orWhere", data: { field: "b", operator: "=", value: 2 } },
      ]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE "users"."a" = $1 OR "users"."b" = $2`);
    });
  });

  describe("joins", () => {
    it("qualifies SELECT * with the main table and emits a LEFT JOIN ... ON clause", () => {
      const result = parse([
        { type: "leftJoin", data: { table: "posts", localField: "id", foreignField: "userId" } },
        { type: "where", data: { field: "name", operator: "=", value: "A" } },
      ]);

      expect(result.query).toBe(
        `SELECT "users".* FROM "users" LEFT JOIN "posts" ON "users"."id" = "posts"."userId" WHERE "users"."name" = $1`,
      );
      expect(result.bindings).toEqual(["A"]);
    });
  });

  describe("whereRaw()", () => {
    it("threads ? placeholders into positional $N params", () => {
      const result = parse([
        { type: "whereRaw", data: { expression: "age > ? AND age < ?", bindings: [18, 65] } },
      ]);

      expect(result.query).toBe(`SELECT * FROM "users" WHERE age > $1 AND age < $2`);
      expect(result.bindings).toEqual([18, 65]);
    });
  });
});
