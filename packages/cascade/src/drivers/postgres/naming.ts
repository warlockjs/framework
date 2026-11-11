/**
 * Most names each conversion cache holds. Column names are a small, fixed
 * set, so the caches stay far below this; the cap only bounds memory when
 * identifiers come from somewhere unbounded. A full cache starts over.
 */
const NAME_CACHE_LIMIT = 2048;

const snakeCache = new Map<string, string>();
const camelCache = new Map<string, string>();

function remember(cache: Map<string, string>, key: string, value: string): string {
  if (cache.size >= NAME_CACHE_LIMIT) {
    cache.clear();
  }

  cache.set(key, value);

  return value;
}

/** Convert a JavaScript camelCase key to a PostgreSQL snake_case column name. */
export function camelToSnake(value: string): string {
  if (value === "*" || value.includes("_")) return value;

  const cached = snakeCache.get(value);

  if (cached !== undefined) return cached;

  return remember(
    snakeCache,
    value,
    (value.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) ?? [value])
      .map((part) => part.toLowerCase())
      .join("_"),
  );
}

/** Convert a PostgreSQL snake_case column name to a JavaScript camelCase key. */
export function snakeToCamel(value: string): string {
  const cached = camelCache.get(value);

  if (cached !== undefined) return cached;

  return remember(
    camelCache,
    value,
    value.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase()),
  );
}

/** Convert top-level database row keys without rewriting nested JSON values. */
export function snakeKeysToCamel<T extends Record<string, unknown>>(
  row: T,
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};

  // `snakeToCamel` never yields "__proto__" (it turns "_p" into "P"), so a
  // plain assignment cannot reach the prototype.
  for (const key of Object.keys(row)) {
    converted[snakeToCamel(key)] = row[key];
  }

  return converted;
}
