import { beforeEach, describe, expect, it, vi } from "vitest";

const cascade = vi.hoisted(() => {
  const calls: string[] = [];
  const state = { failQuery: false };
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push(`query:${sql}:${JSON.stringify(params ?? null)}`);

      if (state.failQuery) throw new Error("syntax error");

      return { rows: [{ "QUERY PLAN": [{ Plan: {} }] }] };
    },
  };
  const driver = {
    async beginTransaction(options?: Record<string, unknown>) {
      calls.push(`begin:${JSON.stringify(options ?? null)}`);

      return {
        context: client,
        commit: async () => void calls.push("commit"),
        rollback: async () => void calls.push("rollback"),
      };
    },
  };
  const dataSource = {
    driver,
    async raw(sql: string) {
      calls.push(`raw:${sql}`);

      return { rows: [] };
    },
  };

  return { calls, state, dataSourceRegistry: { get: () => dataSource } };
});

vi.mock("@warlock.js/cascade", () => ({ dataSourceRegistry: cascade.dataSourceRegistry }));

import { createQueryStats, createShapeExplainer } from "../../../src/production/capture";
import { explainableSql } from "../../../src/production/capture/explain";
import { shortId } from "../../../src/production/stats";
import type { DevtoolsQuery } from "../../../src/types";
import { createEngine, runRequest, SECRET } from "./helpers";

function sqlQuery(sql: string, overrides: Partial<DevtoolsQuery> = {}): DevtoolsQuery {
  return {
    id: "q",
    connection: "default",
    driver: "postgres",
    sql,
    bindings: [7],
    startedAt: 1,
    durationMs: 5,
    shape: sql,
    ...overrides,
  };
}

function explainerFor(query: DevtoolsQuery, executing: boolean) {
  const queries = createQueryStats({ maxShapes: 10, instance: "me" });

  queries.rememberExample(query);

  return { explain: createShapeExplainer({ queries, executing, instance: "me" }), id: shortId(query.shape) };
}

describe("the EXPLAIN statement guard", () => {
  it.each([
    // An escape string: `E'\''` is one quote, so the `;` that follows ends the statement.
    "SELECT E'\\'' ;DELETE FROM t; SELECT ''",
    // A string that holds `--` is not a comment.
    "SELECT '--' ; DELETE FROM t",
    "SELECT '/*' ; DELETE FROM t; SELECT '*/'",
    // Block comments nest: the leading one ends at the second `*/`.
    "/* /* */ ; DELETE FROM t; */ SELECT 1; DELETE FROM t",
    // With standard_conforming_strings off, a backslash escapes a quote in a plain string too.
    "SELECT '\\'' ; DELETE FROM t; SELECT ''",
    // A dollar-quoted body is one string.
    "SELECT $q$ x $q$; DELETE FROM t",
    // Unclosed literals and comments are never guessed at.
    "SELECT 'open",
    "SELECT 1 /* open",
  ])("refuses %s", (sql) => {
    expect(explainableSql(sql)).toBeNull();
  });

  it("still accepts plain reads with strings, identifiers, comments and positional parameters", () => {
    expect(explainableSql(`SELECT 'it''s', E'a\\'b', "update", $tag$ ; $tag$ FROM t WHERE a = $1;`)).toBe(
      `SELECT 'it''s', E'a\\'b', "update", $tag$ ; $tag$ FROM t WHERE a = $1`,
    );
    expect(explainableSql("/* a /* nested */ note */ -- list\n  SELECT foo$bar FROM t")).toBe(
      "SELECT foo$bar FROM t",
    );
  });
});

describe("EXPLAIN on PostgreSQL", () => {
  beforeEach(() => {
    cascade.calls.length = 0;
    cascade.state.failQuery = false;
  });

  it.each([false, true])(
    "runs inside a read-only transaction that is rolled back (executing: %s)",
    async (executing) => {
      const { explain, id } = explainerFor(sqlQuery("SELECT * FROM posts WHERE id = $1"), executing);
      const result = await explain(id);

      expect(result.plan).toEqual([{ "QUERY PLAN": [{ Plan: {} }] }]);
      expect(cascade.calls).toEqual([
        'begin:{"readOnly":true}',
        `query:EXPLAIN (${executing ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) SELECT * FROM posts WHERE id = $1:[7]`,
        "rollback",
      ]);
    },
  );

  it("rolls back when the statement fails", async () => {
    cascade.state.failQuery = true;

    const { explain, id } = explainerFor(sqlQuery("SELECT * FROM posts WHERE id = $1"), true);

    await expect(explain(id)).rejects.toMatchObject({ code: "explain.failed" });
    expect(cascade.calls.at(-1)).toBe("rollback");
    expect(cascade.calls).not.toContain("commit");
  });
});

describe("EXPLAIN on MongoDB", () => {
  it.each([[{ $out: "copy" }], [{ $merge: { into: "copy" } }]])(
    "refuses an aggregate that writes (%j), even when executing is allowed",
    async (stage) => {
      const query = sqlQuery("", {
        driver: "mongodb",
        sql: undefined,
        command: "aggregate",
        collection: "posts",
        pipeline: { aggregate: "posts", pipeline: [{ $match: { a: 1 } }, stage], cursor: {} },
        shape: "posts.aggregate([$match, $out])",
      });

      for (const executing of [false, true]) {
        const { explain, id } = explainerFor(query, executing);

        await expect(explain(id)).rejects.toMatchObject({ code: "explain.unsupported" });
      }
    },
  );
});

describe("request errors", () => {
  it.each([
    ["sampled", 0],
    ["kept because it failed", 0.99],
  ])("lose the values in their message and stack (%s)", async (_name, draw) => {
    const { engine, store } = createEngine({ random: () => draw });
    const error = new Error(
      `E11000 duplicate key error dup key: { email: "${SECRET}" } for ada@example.com and '${SECRET}'`,
    );

    runRequest(engine, "req-1", { status: 500, error });
    await engine.flush();

    const answers = JSON.stringify({
      stored: await store?.samples.get("req-1"),
      detail: await engine.requests.get("req-1"),
      memory: engine.collector.getRequest("req-1"),
      errors: engine.errors.snapshot(10),
    });

    expect(answers).toContain("duplicate key error");
    expect(answers).not.toContain(SECRET);
    expect(answers).not.toContain("ada@example.com");
  });
});
