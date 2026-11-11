import { describe, expect, it, vi } from "vitest";
import { PostgresDialect } from "./postgres-dialect";
import { PostgresDriver } from "./postgres-driver";
import { PostgresQueryParser } from "./postgres-query-parser";
import { camelToSnake, snakeKeysToCamel, snakeToCamel } from "./naming";

describe("Postgres snake_case naming", () => {
  it("converts naming helper values", () => {
    expect(camelToSnake("createdAt")).toBe("created_at");
    expect(camelToSnake("userID")).toBe("user_id");
    expect(camelToSnake("id")).toBe("id");
    expect(camelToSnake("already_snake")).toBe("already_snake");
    expect(snakeToCamel("created_at")).toBe("createdAt");
    expect(snakeToCamel("user_id")).toBe("userId");
  });
  it("emits snake_case columns while preserving table names", () => {
    const parser = new PostgresQueryParser({
      table: "userProfiles",
      dialect: new PostgresDialect({ naming: "snake_case" }),
      operations: [
        { type: "select", data: { fields: ["createdAt"] } },
        { type: "where", data: { field: "createdAt", operator: "=", value: 1 } },
        { type: "orderBy", data: { field: "createdAt", direction: "asc" } },
      ],
    });

    expect(parser.parse().query).toBe(
      'SELECT "userProfiles"."created_at" FROM "userProfiles" WHERE "userProfiles"."created_at" = $1 ORDER BY "userProfiles"."created_at" ASC',
    );
  });

  it("converts insert columns and returned rows", async () => {
    const driver = new PostgresDriver({ database: "test", naming: "snake_case" });
    const query = vi.fn().mockResolvedValue({
      rows: [{ first_name: "a" }],
      rowCount: 1,
      fields: [],
      command: "INSERT",
    });
    driver.query = query;

    await driver.insert("userProfiles", { firstName: "a" });

    expect(query).toHaveBeenCalledWith(
      'INSERT INTO "userProfiles" ("first_name") VALUES ($1) RETURNING *',
      ["a"],
    );
    expect(driver.dialect.quoteIdentifier("firstName")).toBe('"first_name"');
    expect(driver.deserialize({ first_name: "a" })).toEqual({ firstName: "a" });
  });

  it("preserves the current default SQL", () => {
    const parser = new PostgresQueryParser({
      table: "userProfiles",
      operations: [{ type: "where", data: { field: "createdAt", operator: "=", value: 1 } }],
    });

    expect(parser.parse().query).toBe(
      'SELECT * FROM "userProfiles" WHERE "userProfiles"."createdAt" = $1',
    );
  });

  it("converts each column name once and reuses it for later rows", () => {
    snakeKeysToCamel({ created_at: 1, user_id: 2 });

    const replace = vi.spyOn(String.prototype, "replace");
    const rows = [
      { created_at: 1, user_id: 2 },
      { created_at: 3, user_id: 4 },
    ].map((row) => snakeKeysToCamel(row));
    const calls = replace.mock.calls.length;
    replace.mockRestore();

    expect(rows).toEqual([
      { createdAt: 1, userId: 2 },
      { createdAt: 3, userId: 4 },
    ]);
    expect(calls).toBe(0);
    expect(camelToSnake("createdAt")).toBe("created_at");
    expect(camelToSnake("createdAt")).toBe("created_at");
  });

  it("never writes a __proto__ column to the prototype", () => {
    const row = snakeKeysToCamel(JSON.parse('{"__proto__": 1, "a_b": 2}'));

    expect(Object.keys(row)).toEqual(["_Proto__", "aB"]);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });
});
