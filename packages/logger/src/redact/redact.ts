import type { LoggingData, RedactCensor, RedactConfig } from "../types";

/**
 * Deep-clone a value with structural fidelity for log entries — handles plain
 * objects, arrays, `Date`, `Error`, and primitives. Anything else is copied
 * by reference (we only redact paths through plain objects/arrays anyway,
 * and rebuilding e.g. a `Buffer` would change semantics).
 *
 * Purpose-built rather than reaching for `structuredClone`: `Error` instances
 * lose their `message`/`stack` under `structuredClone` in some Node versions,
 * and the logger pipeline carries them often.
 */
function cloneEntry<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value as unknown as object)) {
    return seen.get(value as unknown as object);
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (value instanceof Error) {
    const copy = new (value.constructor as ErrorConstructor)(value.message);
    copy.stack = value.stack;
    copy.name = value.name;
    return copy as unknown as T;
  }

  if (Array.isArray(value)) {
    const arr: any[] = [];
    seen.set(value as unknown as object, arr);
    for (const item of value) {
      arr.push(cloneEntry(item, seen));
    }
    return arr as unknown as T;
  }

  const out: Record<string, any> = {};
  seen.set(value as unknown as object, out);
  for (const key of Object.keys(value as Record<string, any>)) {
    out[key] = cloneEntry((value as Record<string, any>)[key], seen);
  }
  return out as unknown as T;
}

/**
 * Apply a single censor decision to a value. String censors are returned
 * verbatim; function censors receive the original value plus the dotted
 * path so callers can implement value-aware redaction (mask all but the
 * last 4 chars, hash, etc.).
 */
function applyCensor(value: any, censor: RedactCensor, path: string[]): any {
  if (typeof censor === "function") {
    return censor(value, path.join("."));
  }
  return censor;
}

/**
 * Walk `target` following the remaining `segments` of a path pattern,
 * replacing matched leaves via `censor`. Operates in place — the caller
 * is responsible for cloning before calling.
 *
 * Wildcards:
 * - `*` matches exactly one segment (any key on a plain object, any index
 *   on an array — stringified for the path that's passed to a function
 *   censor).
 * - `**` matches zero or more segments greedily; the rest of the pattern
 *   is then attempted at the current level and at every descendant.
 */
function redactAtPath(
  target: any,
  segments: string[],
  censor: RedactCensor,
  pathTrail: string[],
): void {
  if (target === null || typeof target !== "object") {
    return;
  }

  if (segments.length === 0) {
    return;
  }

  const [head, ...rest] = segments;

  if (head === "**") {
    // Try matching `rest` at the current level (the zero-segment match
    // case), then recurse into every child carrying the `**` forward so
    // it keeps matching at deeper levels too.
    if (rest.length > 0) {
      redactAtPath(target, rest, censor, pathTrail);
    }
    const keys = Array.isArray(target)
      ? target.map((_, index) => String(index))
      : Object.keys(target);
    for (const key of keys) {
      redactAtPath(target[key], segments, censor, [...pathTrail, key]);
    }
    return;
  }

  const keysToVisit =
    head === "*"
      ? Array.isArray(target)
        ? target.map((_, index) => String(index))
        : Object.keys(target)
      : Array.isArray(target)
        ? // Numeric segment can index into an array.
          /^\d+$/.test(head) && Number(head) < target.length
          ? [head]
          : []
        : Object.prototype.hasOwnProperty.call(target, head)
          ? [head]
          : [];

  for (const key of keysToVisit) {
    if (rest.length === 0) {
      target[key] = applyCensor(target[key], censor, [...pathTrail, key]);
    } else {
      redactAtPath(target[key], rest, censor, [...pathTrail, key]);
    }
  }
}

/**
 * Produce a new `LoggingData` with every path in `config.paths` replaced
 * by `config.censor`. The original entry is never mutated — channels and
 * other call sites can hold references to the input safely.
 *
 * No-op (returns the input by reference) when `config` is `undefined` or
 * its `paths` array is empty, so the fast path stays fast.
 */
export function applyRedact(
  data: LoggingData,
  config: RedactConfig | undefined,
): LoggingData {
  if (!config || config.paths.length === 0) {
    return data;
  }

  const censor = config.censor ?? "[REDACTED]";
  const cloned = cloneEntry(data);

  for (const pattern of config.paths) {
    const segments = pattern.split(".").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    redactAtPath(cloned, segments, censor, []);
  }

  return cloned;
}

/**
 * Combine two redact configs into one effective config. Used to merge a
 * channel's additive paths on top of the logger-wide floor.
 *
 * - `paths` are concatenated; duplicates are kept (the matcher tolerates
 *   them, and de-duping cross-config would mask a developer typo).
 * - `censor` from the channel wins; falls back to the logger's; falls back
 *   to the default `"[REDACTED]"`.
 */
export function mergeRedact(
  base: RedactConfig | undefined,
  extra: RedactConfig | undefined,
): RedactConfig | undefined {
  if (!base && !extra) return undefined;
  if (!base) return extra;
  if (!extra) return base;

  return {
    paths: [...base.paths, ...extra.paths],
    censor: extra.censor ?? base.censor,
  };
}
