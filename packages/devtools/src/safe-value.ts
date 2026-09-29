const MAX_DEPTH = 6;

/**
 * A JSON-safe snapshot of a value devtools keeps for later display.
 *
 * Log contexts and phase attributes are app data: they can hold live objects
 * (a request, its socket) whose graphs are circular and which must not be kept
 * alive by the collector anyway. Plain objects and arrays are copied; anything
 * with a `toJSON()` is serialized through it; other class instances collapse
 * to `[ClassName]`, cycles to `[Circular]`, and nesting past a fixed depth to
 * `[Object]` / `[Array]`.
 */
export function toSafeValue(value: unknown): unknown {
  return snapshot(value, 0, new WeakSet());
}

function snapshot(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.toString();
    case "function":
      return undefined;
  }

  const object = value as object;

  if (seen.has(object)) return "[Circular]";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };

  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]";

  seen.add(object);

  try {
    if (Array.isArray(value)) return value.map((item) => snapshot(item, depth + 1, seen));

    const prototype = Object.getPrototypeOf(object);

    if (prototype !== Object.prototype && prototype !== null) {
      const toJSON = (object as { toJSON?: unknown }).toJSON;

      if (typeof toJSON === "function") {
        try {
          return snapshot(toJSON.call(object), depth + 1, seen);
        } catch {
          return `[${constructorName(object)}]`;
        }
      }

      return `[${constructorName(object)}]`;
    }

    const copy: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(object)) {
      const safe = snapshot(entry, depth + 1, seen);
      if (safe !== undefined) copy[key] = safe;
    }

    return copy;
  } finally {
    seen.delete(object);
  }
}

function constructorName(object: object): string {
  return (object as { constructor?: { name?: string } }).constructor?.name || "Object";
}
