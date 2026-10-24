/** The part of a cascade `query` event the request log reads. */
export type RequestLogQueryEvent = {
  sql?: string;
  collection?: string;
  command?: string;
  durationMs: number;
};

/**
 * The query without its values: SQL with string and number literals replaced
 * by `?`, or `collection.command` for a document store. Two queries with the
 * same shape are "the same query" for N+1 detection, and a shape never holds
 * a bound value, so it is safe to persist.
 */
export function requestLogQueryShape(event: RequestLogQueryEvent): string {
  if (event.sql) {
    return event.sql
      .replace(/'(?:[^']|'')*'/g, "?")
      .replace(/\b\d+(?:\.\d+)?\b/g, "?")
      .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?)")
      .replace(/\s+/g, " ")
      .trim();
  }

  return [event.collection, event.command].filter(Boolean).join(".") || "unknown";
}
