import { log } from "@warlock.js/logger";
import type { DevtoolsExplainResult } from "../contracts";
import { createErrorRef, DevtoolsApiError } from "../errors";
import type { DevtoolsQuery } from "../../types";
import type {
  DevtoolsExplainRunner,
  DevtoolsExplainStatement,
  DevtoolsQueryStats,
} from "./types";

type ExplainStatement = DevtoolsExplainStatement;
type ExplainRunner = DevtoolsExplainRunner;

const LEADING_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;
const STRING_OR_QUOTED_IDENTIFIER =
  /'(?:''|[^'])*'|"(?:""|[^"])*"|(\$[A-Za-z_]*\$)[\s\S]*?\1/g;
const COMMENTS = /--[^\n]*|\/\*[\s\S]*?\*\//g;
/** Words that write, lock, call or create something. A read statement holds none of them. */
const FORBIDDEN_WORDS =
  /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|call|copy|vacuum|reindex|lock|into|refresh|execute|prepare|nextval|setval|pg_sleep\w*|pg_advisory\w*|lo_\w+|dblink\w*)\b/i;

/**
 * The statement to explain when `sql` is one plain read (`SELECT` or `WITH`,
 * one statement, nothing that writes, locks or calls a function with side
 * effects), without its leading comments; `null` otherwise.
 */
export function explainableSql(sql: string | undefined): string | null {
  if (sql === undefined) return null;

  let statement = sql;

  while (LEADING_NOISE.test(statement)) statement = statement.replace(LEADING_NOISE, "");

  statement = statement.trimEnd();

  if (!/^(select|with)\b/i.test(statement)) return null;

  const bare = statement
    .replace(COMMENTS, " ")
    .replace(STRING_OR_QUOTED_IDENTIFIER, " ? ")
    .replace(/;\s*$/, "");

  if (bare.includes(";")) return null;
  if (FORBIDDEN_WORDS.test(bare)) return null;

  return statement.replace(/;\s*$/, "");
}

/** Keys of a recorded MongoDB command that an inner `explain` command does not accept. */
const MONGO_SESSION_KEYS = new Set([
  "lsid",
  "txnNumber",
  "autocommit",
  "startTransaction",
  "readConcern",
  "writeConcern",
]);

const MONGO_COMMANDS = new Set(["find", "aggregate", "count"]);

function mongoExplainCommand(
  query: DevtoolsQuery,
  executing: boolean,
): Record<string, unknown> | null {
  const name = query.command;

  if (name === undefined || !MONGO_COMMANDS.has(name) || query.collection === undefined) {
    return null;
  }

  let inner: Record<string, unknown>;
  const recorded = query.pipeline;

  if (recorded !== null && typeof recorded === "object" && !Array.isArray(recorded)) {
    inner = {};

    for (const [key, value] of Object.entries(recorded as Record<string, unknown>)) {
      if (key.startsWith("$") || MONGO_SESSION_KEYS.has(key)) continue;

      inner[key] = value;
    }

    inner[name] = query.collection;
  } else if (name === "aggregate") {
    inner = {
      aggregate: query.collection,
      pipeline: Array.isArray(recorded) ? recorded : [],
      cursor: {},
    };
  } else {
    inner = { [name]: query.collection };
  }

  return { explain: inner, verbosity: executing ? "executionStats" : "queryPlanner" };
}

function statementFor(query: DevtoolsQuery, executing: boolean): ExplainStatement | null {
  if (query.driver === "postgres") {
    const sql = explainableSql(query.sql);

    if (sql === null) return null;

    const prefix = executing ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)" : "EXPLAIN (FORMAT JSON)";

    return { type: "sql", sql: `${prefix} ${sql}` };
  }

  const command = mongoExplainCommand(query, executing);

  return command === null ? null : { type: "mongo", command };
}

/** Runs the statement on the query's own connection through cascade's data source registry. */
const runOnDataSource: ExplainRunner = async (query, statement) => {
  const { dataSourceRegistry } = await import("@warlock.js/cascade");
  const dataSource = dataSourceRegistry.get(query.connection);

  if (statement.type === "sql") {
    const { rows } = await dataSource.raw(statement.sql, query.bindings);

    return rows;
  }

  const driver = dataSource.driver as unknown as {
    getDatabase(): { command(command: Record<string, unknown>): Promise<unknown> };
  };

  return driver.getDatabase().command(statement.command);
};

/**
 * EXPLAIN by shape id from the examples `queries` kept, used by the production
 * capture and by development (`POST /api/queries/:shapeId/explain`). Plain
 * `EXPLAIN (FORMAT JSON)` / MongoDB `queryPlanner` unless `executing`; never
 * an executing plan for anything but a PostgreSQL `SELECT`/`WITH` or a
 * MongoDB `find`/`aggregate`/`count`. `run` executes the statement on the
 * query's own connection (injected for specs; default: cascade's
 * `dataSourceRegistry`).
 */
export function createShapeExplainer(input: {
  queries: DevtoolsQueryStats;
  executing: boolean;
  instance: string;
  run?: ExplainRunner;
}): (shapeId: string) => Promise<DevtoolsExplainResult> {
  const run = input.run ?? runOnDataSource;

  return async (shapeId) => {
    const example = input.queries.example(shapeId);

    if (!example) throw new DevtoolsApiError("explain.elsewhere", { instance: input.instance });

    const statement = statementFor(example, input.executing);

    if (!statement) throw new DevtoolsApiError("explain.unsupported", { instance: input.instance });

    try {
      const plan = await run(example, statement);

      return {
        shapeId,
        driver: example.driver,
        executing: input.executing,
        plan,
        instance: input.instance,
      };
    } catch (cause) {
      const ref = createErrorRef();

      log.error(
        "devtools",
        "explain",
        `EXPLAIN failed for query shape ${shapeId} (ref ${ref}): ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );

      throw new DevtoolsApiError("explain.failed", { ref, cause, instance: input.instance });
    }
  };
}
