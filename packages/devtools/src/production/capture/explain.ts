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

/** Words that write, lock, call or create something. A read statement holds none of them. */
const FORBIDDEN_WORDS =
  /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|call|copy|vacuum|reindex|lock|into|refresh|execute|prepare|nextval|setval|pg_sleep\w*|pg_advisory\w*|lo_\w+|dblink\w*)\b/i;

const isIdentifierCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(character);

/** The index after the comment starting at `index` (`--` or a nested block comment), or `-1` when it is not closed. */
function commentEnd(sql: string, index: number): number {
  if (sql.startsWith("--", index)) {
    const newline = sql.indexOf("\n", index + 2);

    return newline === -1 ? sql.length : newline + 1;
  }

  let depth = 0;
  let at = index;

  while (at < sql.length) {
    if (sql.startsWith("/*", at)) {
      depth++;
      at += 2;
    } else if (sql.startsWith("*/", at)) {
      depth--;
      at += 2;

      if (depth === 0) return at;
    } else {
      at++;
    }
  }

  return -1;
}

/**
 * `sql` as the server reads it, with every comment turned into a space and
 * every string, quoted identifier and dollar-quoted body into `?`; `null`
 * when one of them is not closed. `backslashEscapes` reads a backslash as an
 * escape in every string (`standard_conforming_strings = off`); escape
 * strings (`E'…'`) always use it.
 */
function maskSql(sql: string, backslashEscapes: boolean): string | null {
  let out = "";
  let at = 0;

  while (at < sql.length) {
    const character = sql[at] as string;

    if (sql.startsWith("--", at) || sql.startsWith("/*", at)) {
      const end = commentEnd(sql, at);

      if (end === -1) return null;

      out += " ";
      at = end;
      continue;
    }

    if (character === "'" || character === '"') {
      const escapes =
        character === "'" &&
        (backslashEscapes || (/[eE]/.test(sql[at - 1] ?? "") && !isIdentifierCharacter(sql[at - 2])));
      let closed = false;

      at++;

      while (at < sql.length) {
        const current = sql[at];

        if (escapes && current === "\\") {
          at += 2;
        } else if (current === character) {
          at++;

          if (sql[at] !== character) {
            closed = true;
            break;
          }

          at++;
        } else {
          at++;
        }
      }

      if (!closed) return null;

      out += " ? ";
      continue;
    }

    if (character === "$" && !isIdentifierCharacter(sql[at - 1])) {
      const tag = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(sql.slice(at));

      const opener = tag?.[0];

      if (opener !== undefined) {
        const end = sql.indexOf(opener, at + opener.length);

        if (end === -1) return null;

        out += " ? ";
        at = end + opener.length;
        continue;
      }
    }

    out += character;
    at++;
  }

  return out;
}

/** `sql` without its leading whitespace and comments, or `null` when a leading comment is not closed. */
function withoutLeadingNoise(sql: string): string | null {
  let at = 0;

  while (at < sql.length) {
    if (/\s/.test(sql[at] as string)) {
      at++;
    } else if (sql.startsWith("--", at) || sql.startsWith("/*", at)) {
      const end = commentEnd(sql, at);

      if (end === -1) return null;

      at = end;
    } else {
      break;
    }
  }

  return sql.slice(at);
}

/** Whether the masked statement is one read: it starts with SELECT or WITH, ends at most at one `;`, writes nothing. */
function isOneRead(masked: string | null): boolean {
  if (masked === null) return false;

  const bare = masked.trim().replace(/;\s*$/, "");

  return /^(select|with)\b/i.test(bare) && !bare.includes(";") && !FORBIDDEN_WORDS.test(bare);
}

/**
 * The statement to explain when `sql` is one plain read (`SELECT` or `WITH`,
 * one statement, nothing that writes, locks or calls a function with side
 * effects), without its leading comments; `null` otherwise. Strings, quoted
 * identifiers, dollar-quoted bodies and nested comments are read the way the
 * server reads them, under both settings of `standard_conforming_strings`, so
 * a `;` or a keyword cannot hide inside what only looks like a string.
 */
export function explainableSql(sql: string | undefined): string | null {
  if (sql === undefined) return null;

  const statement = withoutLeadingNoise(sql)?.trimEnd();

  if (statement === undefined || !isOneRead(maskSql(statement, false)) || !isOneRead(maskSql(statement, true))) {
    return null;
  }

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

/** Aggregation stages that write their result to a collection. */
const MONGO_WRITE_STAGES = new Set(["$out", "$merge"]);

/** Whether a recorded command or pipeline has a stage that writes. */
function writesInPipeline(recorded: unknown): boolean {
  const pipeline = Array.isArray(recorded)
    ? recorded
    : recorded !== null && typeof recorded === "object"
      ? (recorded as Record<string, unknown>).pipeline
      : undefined;

  return (
    Array.isArray(pipeline) &&
    pipeline.some(
      (stage) =>
        stage !== null &&
        typeof stage === "object" &&
        Object.keys(stage as Record<string, unknown>).some((key) => MONGO_WRITE_STAGES.has(key)),
    )
  );
}

function mongoExplainCommand(
  query: DevtoolsQuery,
  executing: boolean,
): Record<string, unknown> | null {
  const name = query.command;

  if (name === undefined || !MONGO_COMMANDS.has(name) || query.collection === undefined) {
    return null;
  }

  if (name === "aggregate" && writesInPipeline(query.pipeline)) return null;

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

type ReadOnlyTransaction = {
  context: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown }> };
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

/**
 * Runs `sql` in a read-only transaction on its own pooled client and rolls it
 * back, so nothing the statement reaches (a function with side effects under
 * `ANALYZE`, a second statement) can write.
 */
async function explainReadOnly(
  driver: unknown,
  sql: string,
  bindings: unknown[] | undefined,
): Promise<unknown> {
  const begin = (driver as { beginTransaction?: unknown }).beginTransaction;

  if (typeof begin !== "function") {
    throw new Error("The connection cannot open a read-only transaction, so EXPLAIN was not run.");
  }

  const transaction = (await begin.call(driver, { readOnly: true })) as ReadOnlyTransaction;

  try {
    const { rows } = await transaction.context.query(sql, bindings ?? []);

    return rows;
  } finally {
    await transaction.rollback();
  }
}

/** Runs the statement on the query's own connection through cascade's data source registry. */
const runOnDataSource: ExplainRunner = async (query, statement) => {
  const { dataSourceRegistry } = await import("@warlock.js/cascade");
  const dataSource = dataSourceRegistry.get(query.connection);

  if (statement.type === "sql") {
    return explainReadOnly(dataSource.driver, statement.sql, query.bindings);
  }

  const driver = dataSource.driver as unknown as {
    getDatabase(): { command(command: Record<string, unknown>): Promise<unknown> };
  };

  return driver.getDatabase().command(statement.command);
};

/** Keys of a MongoDB plan whose values come from the query (filters, bounds, the echoed command). */
const MONGO_VALUE_KEYS = new Set([
  "parsedQuery",
  "filter",
  "indexBounds",
  "command",
  "originalCommand",
  "query",
  "pipeline",
]);
/** SQL literals inside a PostgreSQL plan's condition text: `'text'` (with `''`), `E'…'` and numbers. */
const SQL_LITERAL = /(?:(?<!\w)[Ee])?'(?:''|\\.|[^'])*'|(?<![\w.$])-?\d+(?:\.\d+)?(?![\w.])/g;

function maskMongoValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskMongoValues);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, maskMongoValues(inner)]),
    );
  }

  return value === null || value === undefined ? value : "?";
}

function redactMongoPlan(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMongoPlan);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      MONGO_VALUE_KEYS.has(key) ? maskMongoValues(inner) : redactMongoPlan(inner),
    ]),
  );
}

function redactSqlPlan(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SQL_LITERAL, "?");
  if (Array.isArray(value)) return value.map(redactSqlPlan);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, redactSqlPlan(inner)]),
  );
}

/**
 * A plan without the query's values. Plans repeat them: MongoDB echoes the
 * filter (`parsedQuery`, `indexBounds`, the command), PostgreSQL writes them
 * into conditions (`Filter: (email = 'a@b.c'::text)`). Values become `?`;
 * the plan's shape, costs, row counts and index choices stay.
 */
export function redactExplainPlan(plan: unknown, driver: string): unknown {
  return driver === "mongodb" ? redactMongoPlan(plan) : redactSqlPlan(plan);
}

/**
 * EXPLAIN by shape id from the examples `queries` kept, used by the production
 * capture and by development (`POST /api/queries/:shapeId/explain`). Plain
 * `EXPLAIN (FORMAT JSON)` / MongoDB `queryPlanner` unless `executing`; never
 * an executing plan for anything but a PostgreSQL `SELECT`/`WITH` or a
 * MongoDB `find`/`aggregate`/`count` (never an aggregate with `$out` or
 * `$merge`). `run` executes the statement on the query's own connection
 * (injected for specs; default: cascade's `dataSourceRegistry`, PostgreSQL
 * inside a read-only transaction that is always rolled back).
 */
export function createShapeExplainer(input: {
  queries: DevtoolsQueryStats;
  executing: boolean;
  instance: string;
  run?: ExplainRunner;
  /** Remove the query's values from the plan (`redactExplainPlan`); production sets it. */
  redact?: boolean;
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
        plan: input.redact === true ? redactExplainPlan(plan, example.driver) : plan,
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
