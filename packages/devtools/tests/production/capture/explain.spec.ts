import { describe, expect, it, vi } from "vitest";
import { createQueryStats, createShapeExplainer } from "../../../src/production/capture";
import { explainableSql } from "../../../src/production/capture/explain";
import { DevtoolsApiError } from "../../../src/production/errors";
import { shortId } from "../../../src/production/stats";
import type { DevtoolsQuery } from "../../../src/types";

function sqlQuery(sql: string, overrides: Partial<DevtoolsQuery> = {}): DevtoolsQuery {
  return {
    id: "q",
    connection: "default",
    driver: "postgres",
    sql,
    bindings: [7],
    startedAt: 1,
    durationMs: 5,
    shape: sql.replace(/\d+/g, "?").replace(/\s+/g, " ").trim(),
    ...overrides,
  };
}

function setup(query: DevtoolsQuery, executing = false) {
  const queries = createQueryStats({ maxShapes: 10, instance: "me" });
  const run = vi.fn(async () => [{ "QUERY PLAN": [{ Plan: {} }] }]);

  queries.rememberExample(query);

  return { run, explain: createShapeExplainer({ queries, executing, instance: "me", run }), id: shortId(query.shape) };
}

async function failure(promise: Promise<unknown>): Promise<DevtoolsApiError> {
  try {
    await promise;
  } catch (error) {
    return error as DevtoolsApiError;
  }

  throw new Error("expected a rejection");
}

describe("PostgreSQL", () => {
  it("runs plain EXPLAIN with the example's bindings and never ANALYZE by default", async () => {
    const { run, explain, id } = setup(sqlQuery("-- list\n  SELECT * FROM posts WHERE id = $1"));
    const result = await explain(id);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toEqual({
      type: "sql",
      sql: "EXPLAIN (FORMAT JSON) SELECT * FROM posts WHERE id = $1",
    });
    expect(run.mock.calls[0]?.[0].bindings).toEqual([7]);
    expect(result).toMatchObject({ shapeId: id, driver: "postgres", executing: false, instance: "me" });
  });

  it("uses ANALYZE only when executing is allowed", async () => {
    const { run, explain, id } = setup(sqlQuery("WITH a AS (SELECT 1) SELECT * FROM a"), true);
    const result = await explain(id);

    expect(run.mock.calls[0]?.[1]).toEqual({
      type: "sql",
      sql: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) WITH a AS (SELECT 1) SELECT * FROM a",
    });
    expect(result.executing).toBe(true);
  });

  it.each([
    "INSERT INTO t (a) VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t",
    "TRUNCATE t",
    "DROP TABLE t",
    "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
    "SELECT * FROM t FOR UPDATE",
    "SELECT * INTO copy FROM t",
    "SELECT 1; DELETE FROM t",
    "SELECT nextval('seq')",
    "EXPLAIN SELECT 1",
    "CALL cleanup()",
  ])("refuses %s, even when executing is allowed", async (sql) => {
    for (const executing of [false, true]) {
      const { run, explain, id } = setup(sqlQuery(sql), executing);
      const error = await failure(explain(id));

      expect(error.code).toBe("explain.unsupported");
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("is not fooled by a keyword inside a string, an identifier or a comment", () => {
    expect(explainableSql(`SELECT 'delete me', "update" FROM t /* drop */ WHERE a = $1;`)).toBe(
      `SELECT 'delete me', "update" FROM t /* drop */ WHERE a = $1`,
    );
    expect(explainableSql("SELECT updated_at, created_by FROM t")).not.toBeNull();
    expect(explainableSql(undefined)).toBeNull();
  });
});

describe("MongoDB", () => {
  const mongo = (command: string, pipeline: unknown, extra: Partial<DevtoolsQuery> = {}) =>
    sqlQuery("", {
      driver: "mongodb",
      sql: undefined as never,
      collection: "users",
      command,
      pipeline,
      shape: `users.${command} ${JSON.stringify(pipeline)}`.replace(/"[a-z0-9@.]+"(?=[,}\]])/g, '"?"'),
      ...extra,
    });

  it("explains find with queryPlanner and drops session keys", async () => {
    const { run, explain, id } = setup(
      mongo("find", { find: "users", filter: { age: 30 }, lsid: { id: 1 }, $db: "app" }),
    );

    await explain(id);

    expect(run.mock.calls[0]?.[1]).toEqual({
      type: "mongo",
      command: { explain: { find: "users", filter: { age: 30 } }, verbosity: "queryPlanner" },
    });
  });

  it("uses executionStats only when executing is allowed", async () => {
    const { run, explain, id } = setup(
      mongo("aggregate", { aggregate: "users", pipeline: [{ $match: { a: 1 } }], cursor: {} }),
      true,
    );

    await explain(id);

    expect(run.mock.calls[0]?.[1]).toMatchObject({
      type: "mongo",
      command: { verbosity: "executionStats", explain: { aggregate: "users" } },
    });
  });

  it("builds the command from an aggregate pipeline array", async () => {
    const { run, explain, id } = setup(mongo("aggregate", [{ $match: { a: 1 } }]));

    await explain(id);

    expect(run.mock.calls[0]?.[1]).toMatchObject({
      command: { explain: { aggregate: "users", pipeline: [{ $match: { a: 1 } }], cursor: {} } },
    });
  });

  it.each(["insert", "update", "delete", "findAndModify", "drop", "createIndexes"])(
    "refuses %s even when executing is allowed",
    async (command) => {
      const { run, explain, id } = setup(mongo(command, { [command]: "users" }), true);

      expect((await failure(explain(id))).code).toBe("explain.unsupported");
      expect(run).not.toHaveBeenCalled();
    },
  );
});

describe("error codes", () => {
  it("answers explain.elsewhere, with the instance, when this process has no example", async () => {
    const queries = createQueryStats({ maxShapes: 10, instance: "me" });
    const explain = createShapeExplainer({ queries, executing: false, instance: "me", run: vi.fn() });
    const error = await failure(explain("0123456789abcdef"));

    expect(error).toBeInstanceOf(DevtoolsApiError);
    expect(error).toMatchObject({ code: "explain.elsewhere", statusCode: 409, instance: "me" });
  });

  it("answers explain.failed with a reference and keeps the database message out of the answer", async () => {
    const query = sqlQuery("SELECT * FROM t WHERE a = $1");
    const queries = createQueryStats({ maxShapes: 10, instance: "me" });

    queries.rememberExample(query);

    const run = vi.fn(async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const explain = createShapeExplainer({ queries, executing: false, instance: "me", run });
    const error = await failure(explain(shortId(query.shape)));

    expect(error).toMatchObject({ code: "explain.failed", statusCode: 502 });
    expect(error.ref).toMatch(/^[A-Z0-9]{8}$/);
    expect(JSON.stringify(error.toBody())).not.toContain("secret_table");
  });
});
