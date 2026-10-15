import { describe, expect, it } from "vitest";

import { detectNPlusOne } from "../src/n-plus-one";
import { queryShape } from "../src/query-shape";
import type { DevtoolsQuery } from "../src/types";

const query = (id: number, value: number): DevtoolsQuery => ({
  id: `q${id}`,
  connection: "main",
  driver: "postgres",
  sql: `SELECT * FROM posts WHERE id = ${value}`,
  startedAt: id,
  durationMs: 1,
  shape: queryShape({ driver: "postgres", sql: `SELECT * FROM posts WHERE id = ${value}` }),
  caller: { file: "C:/app/posts.ts", line: 10, column: 2 },
});

describe("detectNPlusOne", () => {
  it("fires at five same-shape queries with different bindings, but not four", () => {
    expect(
      detectNPlusOne(
        [1, 2, 3, 4].map((value, index) => query(index, value)),
        5,
      ),
    ).toEqual([]);
    expect(
      detectNPlusOne(
        [1, 2, 3, 4, 5].map((value, index) => query(index, value)),
        5,
      ),
    ).toMatchObject([
      {
        count: 5,
        shape: "SELECT * FROM posts WHERE id = ?",
        caller: { file: "C:/app/posts.ts", line: 10 },
      },
    ]);
  });

  it("does not confuse one whereIn query with repeated queries", () => {
    const whereIn = queryShape({
      driver: "mongodb",
      collection: "posts",
      command: "find",
      pipeline: [{ $match: { id: { $in: [1, 2, 3, 4, 5] } } }],
    });
    const mongo: DevtoolsQuery = {
      id: "q1",
      connection: "main",
      driver: "mongodb",
      collection: "posts",
      command: "find",
      pipeline: [{ $match: { id: { $in: [1, 2, 3, 4, 5] } } }],
      startedAt: 1,
      durationMs: 1,
      shape: whereIn,
    };
    expect(detectNPlusOne([mongo], 5)).toEqual([]);
  });
});
