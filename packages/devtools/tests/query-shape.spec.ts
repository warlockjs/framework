import { describe, expect, it } from "vitest";

import { queryShape } from "../src/query-shape";

describe("queryShape", () => {
  it("normalizes Postgres literals without changing placeholders", () => {
    expect(
      queryShape({
        driver: "postgres",
        sql: " SELECT  *  FROM users WHERE id = 5 AND name = 'O''Brien' ",
      }),
    ).toBe("SELECT * FROM users WHERE id = ? AND name = ?");
    expect(queryShape({ driver: "postgres", sql: "SELECT * FROM users WHERE id = $1" })).toBe(
      "SELECT * FROM users WHERE id = $1",
    );
  });

  it("normalizes Mongo leaf values and collapses leaf arrays", () => {
    expect(
      queryShape({
        driver: "mongodb",
        collection: "users",
        command: "find",
        pipeline: [{ $match: { id: { $in: [1, 2, 3] }, active: true } }],
      }),
    ).toBe('users.find [{"$match":{"id":{"$in":["?"]},"active":"?"}}]');
    expect(
      queryShape({
        driver: "mongodb",
        collection: "users",
        command: "find",
        pipeline: [{ $match: { id: { $in: [4] } } }],
      }),
    ).toBe('users.find [{"$match":{"id":{"$in":["?"]}}}]');
  });
});
