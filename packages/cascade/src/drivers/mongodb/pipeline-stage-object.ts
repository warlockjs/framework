/**
 * Whether a value looks like one MongoDB aggregation stage: a plain object
 * with exactly one key, and that key is a `$`-prefixed stage name
 * (`{ $lookup: { ... } }`, `{ $addFields: { ... } }`).
 *
 * Used to validate caller-built stages (`joinRaw()`, `raw()` results) before
 * they reach the pipeline, so a SQL string or a filter object is rejected with
 * a named error instead of failing at execution time or being ignored.
 *
 * @param value - The candidate stage
 * @returns `true` when the value is a single-stage object
 */
export function isPipelineStageObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const keys = Object.keys(value);

  return keys.length === 1 && keys[0]!.startsWith("$");
}
