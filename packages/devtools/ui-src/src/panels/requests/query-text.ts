import type { DetailQuery } from "./types";

/** The text to show for a query: its SQL, its shape, or the Mongo command. */
export function queryText(query: DetailQuery): string {
  return (
    query.sql ||
    query.shape ||
    `${query.collection || "collection"}.${query.command || "command"}\n${JSON.stringify(query.pipeline ?? {}, null, 2)}`
  );
}

/** Development EXPLAIN works on Postgres SELECT / WITH statements. */
export function canExplainDevelopment(query: DetailQuery): boolean {
  return query.driver === "postgres" && /^(select|with)\b/i.test((query.sql || "").trim());
}
