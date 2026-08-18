import type { LoggingData, RedactCensor, RedactConfig } from "../types";
import {
  DEFAULT_REDACT_KEY_SET,
  normalizeRedactKey,
} from "./default-keys";

const DEFAULT_CENSOR = "[REDACTED]";

/**
 * Per-key redaction settings threaded through the clone walk. Absent when the
 * walk is a plain structural clone (path-only redaction).
 */
type KeyRedaction = {
  /** Normalized key names to censor wherever they appear. */
  keys: ReadonlySet<string>;
  censor: RedactCensor;
  /**
   * Dotted paths the path-glob pass already censored. Skipped here so a
   * function censor is never invoked twice on the same leaf (the second call
   * would receive the already-masked value, not the original).
   */
  alreadyCensored: ReadonlySet<string>;
};

/**
 * Values we copy by reference rather than walking. Expanding these with
 * `Object.keys` would be destructive, not protective — a `Buffer` becomes a
 * multi-thousand-key index map, a `Map`/`Set`/`RegExp` becomes `{}`. Their
 * contents are consequently *not* reachable by redaction; see the residual
 * gaps documented on `applyRedact`.
 */
function isOpaque(value: object): boolean {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Promise ||
    value instanceof RegExp
  );
}

/**
 * Deep-clone a value with structural fidelity for log entries — handles plain
 * objects, arrays, `Date`, `Error`, and primitives. Anything else (buffers,
 * maps, sets, promises, regexes) is copied by reference: we only redact
 * through walkable structures anyway, and rebuilding e.g. a `Buffer` would
 * change semantics.
 *
 * Purpose-built rather than reaching for `structuredClone`: `Error` instances
 * lose their `message`/`stack` under `structuredClone` in some Node versions,
 * and the logger pipeline carries them often.
 *
 * When `redaction` is supplied, keys matching its denylist are censored during
 * the same pass — one traversal, not two.
 */
function cloneEntry<T>(
  value: T,
  seen = new WeakMap<object, any>(),
  redaction?: KeyRedaction,
  trail: string[] = [],
): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const asObject = value as unknown as object;

  if (seen.has(asObject)) {
    return seen.get(asObject);
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (isOpaque(asObject)) {
    return value;
  }

  if (value instanceof Error) {
    return cloneError(value, seen, redaction, trail) as unknown as T;
  }

  if (Array.isArray(value)) {
    const arr: any[] = [];
    seen.set(asObject, arr);
    value.forEach((item, index) => {
      // Array indices are positions, not names — never key-matched, but the
      // trail still carries them so function censors see a usable path.
      arr.push(cloneEntry(item, seen, redaction, [...trail, String(index)]));
    });
    return arr as unknown as T;
  }

  const out: Record<string, any> = {};
  seen.set(asObject, out);
  copyOwnKeys(value as Record<string, any>, out, seen, redaction, trail);
  return out as unknown as T;
}

/**
 * Copy every own enumerable key from `source` onto `target`, censoring the
 * ones the key denylist matches and recursing into the rest.
 */
function copyOwnKeys(
  source: Record<string, any>,
  target: Record<string, any>,
  seen: WeakMap<object, any>,
  redaction: KeyRedaction | undefined,
  trail: string[],
): void {
  for (const key of Object.keys(source)) {
    const childTrail = [...trail, key];

    if (
      redaction &&
      redaction.keys.has(normalizeRedactKey(key)) &&
      !redaction.alreadyCensored.has(childTrail.join("."))
    ) {
      target[key] = applyCensor(source[key], redaction.censor, childTrail);
      continue;
    }

    target[key] = cloneEntry(source[key], seen, redaction, childTrail);
  }
}

/**
 * Clone an `Error`, preserving its own enumerable properties.
 *
 * Those extra properties matter for redaction: HTTP clients (axios, got)
 * attach `.config`/`.request`/`.response` to the errors they throw, and those
 * routinely carry the *outgoing* `Authorization` header of the failed request.
 * Copying them through the walk is what lets the key denylist reach in and
 * censor them — dropping them instead (the pre-4.15.0 behavior) hid the
 * secret only when redaction happened to be configured, and took `.code` and
 * friends with it.
 *
 * `name`/`message`/`stack` are non-enumerable on `Error`, so they are carried
 * over explicitly.
 */
function cloneError(
  value: Error,
  seen: WeakMap<object, any>,
  redaction: KeyRedaction | undefined,
  trail: string[],
): Error {
  let copy: Error;

  try {
    copy = new (value.constructor as ErrorConstructor)(value.message);
  } catch {
    // A subclass whose constructor demands a different signature must not
    // take the whole log call down with it.
    copy = new Error(value.message);
  }

  // Assigned rather than trusted to the constructor: a subclass that derives
  // its message from a structured argument (`new HttpError({ detail })`)
  // produces an empty message when replayed with a plain string. Defined
  // non-enumerably to match native `Error`, so the clone serializes with the
  // same shape as the original.
  for (const [key, source] of [
    ["message", value.message],
    ["name", value.name],
    ["stack", value.stack],
  ] as const) {
    Object.defineProperty(copy, key, {
      value: source,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  seen.set(value, copy);
  copyOwnKeys(value as unknown as Record<string, any>, copy as any, seen, redaction, trail);

  return copy;
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
 * Every censored leaf's dotted path is recorded in `censored` so a following
 * key-denylist pass can leave it alone.
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
  censored: Set<string>,
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
      redactAtPath(target, rest, censor, pathTrail, censored);
    }
    const keys = Array.isArray(target)
      ? target.map((_, index) => String(index))
      : Object.keys(target);
    for (const key of keys) {
      redactAtPath(target[key], segments, censor, [...pathTrail, key], censored);
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
      const leafTrail = [...pathTrail, key];
      target[key] = applyCensor(target[key], censor, leafTrail);
      censored.add(leafTrail.join("."));
    } else {
      redactAtPath(target[key], rest, censor, [...pathTrail, key], censored);
    }
  }
}

/**
 * Cheap pre-scan: does this graph contain any denylisted key at all?
 *
 * Lets the default-on key pass stay allocation-free for the overwhelming
 * majority of entries, which carry no secrets — we only pay for a clone when
 * there is actually something to censor. Also keeps `applyRedact`'s
 * "returns the input by reference when nothing changed" contract intact.
 */
function hasDenylistedKey(
  value: any,
  keys: ReadonlySet<string>,
  seen = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const asObject = value as object;

  if (seen.has(asObject)) return false;
  seen.add(asObject);

  if (value instanceof Date || isOpaque(asObject)) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasDenylistedKey(item, keys, seen));
  }

  for (const key of Object.keys(value)) {
    if (keys.has(normalizeRedactKey(key))) return true;
    if (hasDenylistedKey(value[key], keys, seen)) return true;
  }

  return false;
}

/**
 * Cache of resolved key sets, keyed by the config object they came from.
 * Logger-wide and channel configs are long-lived references, so this makes
 * the per-entry cost a single map lookup. Merged configs (rebuilt per entry
 * by `mergeRedact`) fall out of the `WeakMap` on their own.
 */
const keySetCache = new WeakMap<RedactConfig, ReadonlySet<string>>();

/**
 * Resolve the effective key denylist for a config: the built-in set (unless
 * `defaultKeys: false`) plus any `keys` the application added.
 *
 * Returns `undefined` only when there is nothing to match — i.e. defaults are
 * explicitly off and no custom keys were supplied.
 */
export function resolveRedactKeys(
  config: RedactConfig | undefined,
): ReadonlySet<string> | undefined {
  const useDefaults = config?.defaultKeys !== false;
  const extra = config?.keys;

  if (!extra || extra.length === 0) {
    return useDefaults ? DEFAULT_REDACT_KEY_SET : undefined;
  }

  const cached = config && keySetCache.get(config);
  if (cached) return cached;

  const resolved = new Set<string>(useDefaults ? DEFAULT_REDACT_KEY_SET : []);
  for (const key of extra) {
    resolved.add(normalizeRedactKey(key));
  }

  if (config) keySetCache.set(config, resolved);

  return resolved;
}

/**
 * Produce a new `LoggingData` with sensitive data censored:
 *
 * 1. every path in `config.paths` (opt-in globs), then
 * 2. every key matching the denylist — the built-in
 *    {@link DEFAULT_REDACT_KEYS} plus `config.keys`, at any depth of
 *    `context`, `message`, and an `Error`'s own enumerable properties.
 *
 * Step 2 runs **with no config at all**: passing `undefined` still censors
 * `password`, `authorization`, `token`, `apiKey` and friends. Pass
 * `{ defaultKeys: false }` to opt out.
 *
 * Paths run first so a function censor sees the original value rather than a
 * mask; leaves the path pass already censored are skipped by the key pass.
 *
 * The original entry is never mutated — channels and other call sites can
 * hold references to the input safely. Returns the input **by reference**
 * when nothing matched, so the fast path stays allocation-free.
 *
 * ## Residual gaps (by design, documented rather than silently absent)
 *
 * - **Secrets interpolated into a `message` string** (`` `token=${t}` ``)
 *   cannot be reached — neither a path nor a key names a substring.
 * - **`Map`/`Set`/`Buffer` contents** are not traversed (see {@link isOpaque}).
 * - **Non-enumerable / getter-backed properties** are not walked, so an HTTP
 *   client that exposes request config behind a getter still slips through.
 *   Enumerable ones (axios's `.config`, `.response`) *are* covered.
 */
export function applyRedact(
  data: LoggingData,
  config: RedactConfig | undefined,
): LoggingData {
  const paths = config?.paths ?? [];
  const keys = resolveRedactKeys(config);

  if (paths.length === 0 && !keys) {
    return data;
  }

  const censor = config?.censor ?? DEFAULT_CENSOR;

  let result = data;
  const censored = new Set<string>();

  if (paths.length > 0) {
    result = cloneEntry(data);

    for (const pattern of paths) {
      const segments = pattern.split(".").filter((segment) => segment.length > 0);
      if (segments.length === 0) continue;
      redactAtPath(result, segments, censor, [], censored);
    }
  }

  if (keys && hasDenylistedKey(result, keys)) {
    result = cloneEntry(result, new WeakMap(), {
      keys,
      censor,
      alreadyCensored: censored,
    });
  }

  return result;
}

/**
 * Combine two redact configs into one effective config. Used to merge a
 * channel's additive paths on top of the logger-wide floor.
 *
 * - `paths` and `keys` are concatenated; duplicates are kept (the matcher
 *   tolerates them, and de-duping cross-config would mask a developer typo).
 * - `censor` from the channel wins; falls back to the logger's; falls back
 *   to the default `"[REDACTED]"`.
 * - `defaultKeys` follows the additive-only contract: a channel can turn the
 *   built-in denylist back *on* (`true`) but can never turn off one the
 *   logger-wide floor left enabled. When the channel is silent, the logger's
 *   choice is inherited — opting out logger-wide is not quietly undone by
 *   any channel that happens to set a `redact` option.
 */
export function mergeRedact(
  base: RedactConfig | undefined,
  extra: RedactConfig | undefined,
): RedactConfig | undefined {
  if (!base && !extra) return undefined;

  if (!base) {
    // An absent logger-wide config still means "built-in denylist on" — it is
    // the floor, not the absence of one. A channel may not switch it off, so
    // its `defaultKeys: false` is overridden here rather than inherited.
    return extra!.defaultKeys === false
      ? { ...extra!, defaultKeys: true }
      : extra;
  }

  if (!extra) return base;

  return {
    paths: [...(base.paths ?? []), ...(extra.paths ?? [])],
    keys: [...(base.keys ?? []), ...(extra.keys ?? [])],
    defaultKeys: extra.defaultKeys === true ? true : base.defaultKeys,
    censor: extra.censor ?? base.censor,
  };
}
