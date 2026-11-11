/**
 * Redaction helpers for the MongoDB query log (`logging: true`).
 *
 * Commands carry the documents and filters an app sends, and those hold
 * password hashes, tokens and API keys. The log records the command name,
 * the collection and the shape of the command only.
 */

/** Command keys the log never needs (session id, cluster clock, database). */
const UNLOGGED_COMMAND_KEYS = new Set(["lsid", "$clusterTime", "$db", "txnNumber", "autocommit"]);

/**
 * Shape of a MongoDB command for the query log: field names and value types,
 * no values. The collection name (the string under the command name) is
 * kept; arrays show their length and the shape of their first element.
 *
 * @example
 * describeCommandShape({ insert: "users", documents: [{ email: "a@b.c", password: "…" }] })
 * // { insert: "users", documents: ["1 ×", { email: "string", password: "string" }] }
 */
export function describeCommandShape(command: Record<string, unknown>): Record<string, unknown> {
  const [commandName] = Object.keys(command ?? {});
  const shape: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(command ?? {})) {
    if (UNLOGGED_COMMAND_KEYS.has(key)) continue;

    shape[key] = key === commandName && typeof value === "string" ? value : shapeOf(value, 0);
  }

  return shape;
}

function shapeOf(value: unknown, depth: number): unknown {
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [`${value.length} ×`, shapeOf(value[0], depth + 1)];
  }

  if (typeof value !== "object") return typeof value;

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    // Date, ObjectId, Decimal128, Buffer, …: the type name is enough.
    return (value as { constructor?: { name?: string } }).constructor?.name ?? "object";
  }

  if (depth >= 4) return "object";

  const nested: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    nested[key] = shapeOf(item, depth + 1);
  }

  return nested;
}

/**
 * A failed command for the error log: the error name and code, and its
 * message without the duplicate-key value MongoDB quotes in it.
 */
export function describeCommandFailure(failure: unknown): Record<string, unknown> {
  if (!failure || typeof failure !== "object") {
    return { message: String(failure) };
  }

  const error = failure as {
    name?: unknown;
    code?: unknown;
    codeName?: unknown;
    message?: unknown;
  };

  return {
    name: error.name,
    code: error.code,
    codeName: error.codeName,
    message:
      typeof error.message === "string"
        ? error.message.replace(/dup key: \{[\s\S]*\}/, "dup key: { … }")
        : undefined,
  };
}
