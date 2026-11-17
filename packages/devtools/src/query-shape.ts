import type { DevtoolsQuery } from "./types";

type QueryShapeInput = Pick<
  DevtoolsQuery,
  "driver" | "sql" | "collection" | "command" | "pipeline"
>;

const numericLiteral = /(?<![\w$])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?![\w$])/g;
const quotedLiteral = /'(?:''|[^'])*'/g;
const dollarQuotedLiteral = /(\$[A-Za-z_]*\$)[\s\S]*?\1/g;

const postgresShapes = new Map<string, string>();
const POSTGRES_SHAPE_CACHE = 1000;

/** Returns a binding-independent shape for a database query. */
export function queryShape(query: QueryShapeInput): string {
  if (query.driver === "postgres") {
    const sql = query.sql ?? "";
    // An app runs the same few statements over and over; the shape of a statement never changes.
    const known = postgresShapes.get(sql);

    if (known !== undefined) return known;

    const shape = sql
      .replace(quotedLiteral, "?")
      .replace(dollarQuotedLiteral, "?")
      .replace(numericLiteral, "?")
      .replace(/\s+/g, " ")
      .trim();

    // Statements with inlined values are mostly one-off: only short ones are worth remembering.
    if (sql.length <= 4000) {
      if (postgresShapes.size >= POSTGRES_SHAPE_CACHE) postgresShapes.clear();

      postgresShapes.set(sql, shape);
    }

    return shape;
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
