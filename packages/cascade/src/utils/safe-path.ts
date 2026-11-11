import { isPlainObject } from "@mongez/supportive-is";

/**
 * Path segments that can never name a column. Walking a dot path through one of
 * them reaches `Object.prototype` (or a constructor), so a write would change
 * every object in the process instead of the model's data.
 */
const RESERVED_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Throw when a dot-notation field path contains a reserved segment
 * (`__proto__`, `constructor`, `prototype`).
 *
 * @param path - The field path given to `set()` / `unset()`
 * @throws Error naming the path and the offending segment
 */
export function assertSafeFieldPath(path: string): void {
  for (const segment of path.split(".")) {
    if (RESERVED_SEGMENTS.has(segment)) {
      throw new Error(
        `The field path "${path}" contains the reserved segment "${segment}", which can never be a column name. ` +
          `Remove that key from the input (for example the request body) before passing it to set(), merge() or unset().`,
      );
    }
  }
}

/**
 * Throw when a value about to be merged into model data carries a `__proto__`
 * key at any depth (plain objects and arrays are walked).
 *
 * `JSON.parse` keeps `"__proto__"` as an ordinary own key, so request bodies,
 * queue payloads and webhook bodies can carry one; merging it would write into
 * `Object.prototype`. `constructor` / `prototype` keys inside a value stay
 * allowed: they are only ever stored as the object's own data.
 *
 * @param value - The value to check
 * @param path - Field path of `value`, used in the error message
 * @throws Error naming the path of the offending key
 */
export function assertSafeValueKeys(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertSafeValueKeys(value[index], path ? `${path}.${index}` : String(index));
    }

    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    const keyPath = path ? `${path}.${key}` : key;

    if (key === "__proto__") {
      throw new Error(
        `The data contains the reserved key "${keyPath}", which can never be a column name. ` +
          `Remove that key from the input (for example the request body) before passing it to set() or merge().`,
      );
    }

    assertSafeValueKeys((value as Record<string, unknown>)[key], keyPath);
  }
}
