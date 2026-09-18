import { InvalidSitemapEntryError } from "./errors";

/**
 * Serialises a `lastmod` value.
 *
 * A `Date` becomes W3C datetime, which is what the schema wants and what
 * `toISOString()` already produces. A string is passed through UNTOUCHED: a
 * caller who already holds an ISO string gets it back verbatim rather than
 * having us re-parse it and risk shifting it across a timezone.
 */
export function formatLastmod(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new InvalidSitemapEntryError("lastmod is an invalid Date");
    }

    return value.toISOString();
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidSitemapEntryError("lastmod must be a non-empty string or a Date");
  }

  return value;
}
