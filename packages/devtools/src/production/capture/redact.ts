import type {
  DevtoolsSampleDetail,
  DevtoolsSampleQuery,
  DevtoolsSampleSummary,
} from "../contracts";
import type { DevtoolsStoredSample } from "../store/types";
import type { DevtoolsQuery, DevtoolsRequest } from "../../types";
import { queryShape } from "../../query-shape";
import { shapeIdOf, truncate } from "./stats-stores";

const SHAPE_MAX = 2000;
const ERROR_MAX = 500;
const QUERY_ERROR_MAX = 300;
const LOG_MESSAGE_MAX = 1000;

const QUOTED = /'(?:''|[^'])*'|"(?:\\.|[^"\\])*"/g;
const BRACES = /\{[^{}]*\}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Error text without the values a driver or a handler put in it (a duplicate
 * key message carries the key): quoted strings, emails and `{ … }` documents
 * become `?`, then the text is cut to `max` characters.
 */
export function scrubErrorText(text: string, max: number): string {
  return truncate(text.replace(QUOTED, "?").replace(EMAIL, "?").replace(BRACES, "{?}"), max);
}

/** A database error message without the values the driver quoted in it. */
export function scrubQueryError(message: string): string {
  return scrubErrorText(message, QUERY_ERROR_MAX);
}

function redactQuery(query: DevtoolsQuery): DevtoolsSampleQuery {
  const shape = truncate(query.shape || queryShape(query), SHAPE_MAX);
  const sample: DevtoolsSampleQuery = {
    id: query.id,
    connection: query.connection,
    driver: query.driver,
    sql: shape,
    shape,
    shapeId: shapeIdOf(query.shape || shape),
    startedAt: query.startedAt,
    durationMs: query.durationMs,
  };

  if (query.collection !== undefined) sample.collection = query.collection;
  if (query.command !== undefined) sample.command = query.command;
  if (query.rowCount !== undefined) sample.rowCount = query.rowCount;
  if (query.error !== undefined) sample.error = scrubQueryError(query.error);

  return sample;
}

/**
 * Turns a sampled request into a stored sample with every value removed: SQL
 * replaced by its shape, no bindings, no Mongo pipeline, no log context, no
 * phase attributes, cache operations reduced to counts, no caller paths.
 * Headers, bodies, query strings and parameters are not part of a request
 * record and never appear.
 */
export function toStoredSample(
  request: DevtoolsRequest,
  instance: string,
  droppedQueries: number,
): DevtoolsStoredSample {
  const path = request.path.split("?")[0] ?? request.path;
  const summary: DevtoolsSampleSummary = {
    id: request.id,
    method: request.method,
    path,
    startedAt: request.startedAt,
    queryCount: request.queries.length + droppedQueries,
    warningCount: request.warnings.length,
    instance,
  };

  if (request.route !== undefined) summary.route = request.route;
  if (request.status !== undefined) summary.status = request.status;
  if (request.durationMs !== undefined) summary.durationMs = request.durationMs;

  let hits = 0;
  let misses = 0;
  let writes = 0;

  for (const operation of request.cache) {
    if (operation.type === "hit") hits++;
    else if (operation.type === "miss") misses++;
    else if (operation.type === "set") writes++;
  }

  const detail: DevtoolsSampleDetail = {
    ...summary,
    phases: request.phases.map((phase) => ({
      name: phase.name,
      startedAt: phase.startedAt,
      durationMs: phase.durationMs,
    })),
    queries: request.queries.map(redactQuery),
    cache: { hits, misses, writes },
    logs: request.logs.map((entry) => ({
      level: entry.level,
      module: entry.module,
      action: entry.action,
      message: truncate(entry.message, LOG_MESSAGE_MAX),
      at: entry.at,
    })),
    warnings: request.warnings.map((warning) => ({
      type: warning.type,
      message: warning.message,
      shape: truncate(warning.shape, SHAPE_MAX),
      count: warning.count,
    })),
    droppedQueries,
  };

  if (request.error !== undefined) detail.error = scrubErrorText(request.error, ERROR_MAX);

  return { id: request.id, instance, startedAt: request.startedAt, summary, detail };
}
