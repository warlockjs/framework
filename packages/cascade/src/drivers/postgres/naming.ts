/** Convert a JavaScript camelCase key to a PostgreSQL snake_case column name. */
export function camelToSnake(value: string): string {
  if (value === "*" || value.includes("_")) return value;

  return (value.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) ?? [value])
    .map((part) => part.toLowerCase())
    .join("_");
}

/** Convert a PostgreSQL snake_case column name to a JavaScript camelCase key. */
export function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

/** Convert top-level database row keys without rewriting nested JSON values. */
export function snakeKeysToCamel<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [snakeToCamel(key), value]));
}
