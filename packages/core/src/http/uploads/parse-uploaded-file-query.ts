import type { UploadedFileQuery } from "./image-variant-types";

const ALLOWED_KEYS = new Set(["variant", "format"]);

/**
 * Read the query string of an uploads request, strictly.
 *
 * It parses the raw URL rather than the framework's parsed query, because the
 * parsed form folds a repeated key into an array and a lone key into a string,
 * and a strict allowlist has to see both. Only `variant` and `format` are
 * accepted, each at most once, and `format` only next to `variant`.
 *
 * @param url - the raw request URL, path and query
 */
export function parseUploadedFileQuery(url: string): UploadedFileQuery {
  const queryStart = url.indexOf("?");
  const rawQuery = queryStart === -1 ? "" : url.slice(queryStart + 1);

  if (rawQuery === "") return { type: "original" };

  const values = new Map<string, string>();

  for (const [key, value] of new URLSearchParams(rawQuery)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { type: "invalid", reason: `Unknown query parameter "${key}".` };
    }

    if (values.has(key)) {
      return { type: "invalid", reason: `Query parameter "${key}" is repeated.` };
    }

    values.set(key, value);
  }

  const variant = values.get("variant");
  const format = values.get("format");

  if (variant === undefined) {
    return values.size === 0
      ? { type: "original" }
      : { type: "invalid", reason: `"format" requires "variant".` };
  }

  if (variant === "") {
    return { type: "invalid", reason: `"variant" must not be empty.` };
  }

  return format === undefined ? { type: "variant", variant } : { type: "variant", variant, format };
}
