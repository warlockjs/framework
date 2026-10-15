import type { DevtoolsQuery } from "./types";

type QueryShapeInput = Pick<
  DevtoolsQuery,
  "driver" | "sql" | "collection" | "command" | "pipeline"
>;

const numericLiteral = /(?<![\w$])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?![\w$])/g;
const quotedLiteral = /'(?:''|[^'])*'/g;

/** Returns a binding-independent shape for a database query. */
export function queryShape(query: QueryShapeInput): string {
  if (query.driver === "postgres") {
    return (query.sql ?? "")
      .replace(quotedLiteral, "?")
      .replace(numericLiteral, "?")
      .replace(/\s+/g, " ")
      .trim();
  }

  return `${query.collection ?? ""}.${query.command ?? ""} ${JSON.stringify(normalizeMongoValue(query.pipeline))}`;
}

function normalizeMongoValue(value: unknown): unknown {
  if (isMongoLeaf(value)) return "?";

  if (Array.isArray(value)) {
    if (value.every(isMongoLeaf)) return ["?"];
    return value.map(normalizeMongoValue);
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).map((key) => [key, normalizeMongoValue(record[key])]),
  );
}

function isMongoLeaf(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (value instanceof Date) return true;
  const record = value as Record<string, unknown>;
  return typeof record.toHexString === "function" || typeof record.$oid === "string";
}
