import { normalizeRedactKey } from "./default-keys";

const keys = new Set<string>();
const values = new Set<string>();
const MASK = "[REDACTED]";
let orderedValues: string[] = [];
/**
 * One expression matching any registered value, longest first, so a string
 * that holds no secret is cleared in a single pass. `undefined` when it could
 * not be built (then each value is searched for on its own).
 */
let secretPattern: RegExp | undefined;

/**
 * Register credentials for process-lifetime masking in every Logger instance.
 * Empty values are ignored. Old values remain protected after rotation/removal.
 * This safety floor is independent of redact config and custom censors.
 */
export function registerLogSecret(value: string, secretKeys: readonly string[] = []): void {
  for (const key of secretKeys) {
    const normalized = normalizeRedactKey(key);
    if (normalized) keys.add(normalized);
  }
  if (!value || values.has(value)) return;
  values.add(value);
  orderedValues = [...values].sort((left, right) => right.length - left.length);
  secretPattern = buildSecretPattern(orderedValues);
}

/** Above this total length the values are searched for one by one. */
const MAX_PATTERN_LENGTH = 16 * 1024;

function buildSecretPattern(secrets: readonly string[]): RegExp | undefined {
  let total = 0;

  for (const secret of secrets) total += secret.length;

  if (total > MAX_PATTERN_LENGTH) return undefined;

  try {
    return new RegExp(
      secrets.map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    );
  } catch {
    // Too large for one expression; fall back to scanning value by value.
    return undefined;
  }
}

/** Whether the text holds any registered value. */
function containsSecret(text: string): boolean {
  if (secretPattern) {
    try {
      return secretPattern.test(text);
    } catch {
      // The engine gave up on this expression (its message could quote a
      // credential, so it is dropped); scan value by value from now on.
      secretPattern = undefined;
    }
  }

  return orderedValues.some((secret) => text.includes(secret));
}

/** Exact substring masking; no encoding, hashing, or fuzzy matching. */
export function maskRegisteredLogSecrets(text: string): string {
  if (orderedValues.length === 0 || !containsSecret(text)) return text;
  let cursor = 0;
  let result = "";
  while (cursor < text.length) {
    let next = -1;
    let length = 0;
    // Find the leftmost match; length order breaks ties. Literal scanning avoids
    // regex compilation errors whose messages could contain a credential.
    for (const secret of orderedValues) {
      const index = text.indexOf(secret, cursor);
      if (index !== -1 && (next === -1 || index < next)) {
        next = index;
        length = secret.length;
      }
    }
    if (next === -1) return result + text.slice(cursor);
    result += text.slice(cursor, next) + MASK;
    cursor = next + length;
  }
  return result;
}

/**
 * Whether the masking pass below would change anything in `value`: a string
 * or key holding a registered value, a registered key, a function, symbol or
 * accessor, an opaque object, or an object the pass rebuilds rather than
 * copies field for field (class instances, errors, symbol-keyed fields).
 * Read-only: no getter, `toJSON` or inspection hook runs.
 */
function needsMasking(root: unknown): boolean {
  const seen = new WeakSet<object>();

  function check(value: unknown): boolean {
    if (typeof value === "string") return containsSecret(value);
    if (typeof value === "function" || typeof value === "symbol") return true;
    if (value === null || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    const prototype: unknown = Object.getPrototypeOf(value);

    if (value instanceof Map) {
      if (prototype !== Map.prototype) return true;

      for (const [key, child] of Map.prototype.entries.call(value) as IterableIterator<
        [unknown, unknown]
      >) {
        if (typeof key === "string" && keys.has(normalizeRedactKey(key))) return true;
        if (check(key) || check(child)) return true;
      }

      return false;
    }

    if (value instanceof Set) {
      if (prototype !== Set.prototype) return true;

      for (const child of Set.prototype.values.call(value) as IterableIterator<unknown>) {
        if (check(child)) return true;
      }

      return false;
    }

    const isArray = Array.isArray(value);

    // Only plain objects and arrays are returned as they are; anything else is
    // rebuilt by the masking pass, exactly as before.
    const plain = isArray
      ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null;

    if (!plain) return true;

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") return true;
      if (isArray && key === "length") continue;

      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (!descriptor) continue;
      if (!("value" in descriptor)) return true;
      if (keys.has(normalizeRedactKey(key)) || containsSecret(key)) return true;
      if (check(descriptor.value)) return true;
    }

    return false;
  }

  return check(root);
}

/**
 * @internal Final safety pass, after user censors have run. Returns the value
 * itself (same reference) when nothing in it needs masking, so entries that
 * hold no registered secret are never copied.
 */
export function redactRegisteredSecrets<T>(value: T): T {
  if (keys.size === 0 && values.size === 0) return value;
  if (!needsMasking(value)) return value;
  const seen = new WeakMap<object, unknown>();

  function visit(value: unknown): unknown {
    if (typeof value === "string") return maskRegisteredLogSecrets(value);
    if (typeof value === "function" || typeof value === "symbol") return MASK;
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(Date.prototype.getTime.call(value));
    // Opaque objects can expose plaintext via custom serializers or inspection.
    // Mask them entirely; Maps/Sets are handled as inspectable containers below.
    if (
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer ||
      value instanceof WeakMap ||
      value instanceof WeakSet ||
      value instanceof Promise ||
      value instanceof RegExp
    )
      return MASK;
    if (value instanceof Map) {
      const copy = new Map<unknown, unknown>();
      seen.set(value, copy);
      for (const [key, child] of Map.prototype.entries.call(value) as IterableIterator<
        [unknown, unknown]
      >) {
        copy.set(
          visit(key),
          typeof key === "string" && keys.has(normalizeRedactKey(key)) ? MASK : visit(child),
        );
      }
      return copy;
    }
    if (value instanceof Set) {
      const copy = new Set<unknown>();
      seen.set(value, copy);
      for (const child of Set.prototype.values.call(value) as IterableIterator<unknown>)
        copy.add(visit(child));
      return copy;
    }
    const copy: object = value instanceof Error ? new Error() : Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    // Descriptors avoid invoking getters and custom toJSON/inspect methods.
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (typeof key === "symbol") continue;
      const name = maskRegisteredLogSecrets(key);
      const hidden = keys.has(normalizeRedactKey(key));
      const child: unknown = "value" in descriptor ? descriptor.value : MASK;
      Object.defineProperty(copy, name, {
        value: hidden ? MASK : visit(child),
        enumerable: descriptor.enumerable,
        writable: true,
        configurable: true,
      });
    }
    if (value instanceof Error && !Object.hasOwn(copy, "name")) {
      let prototype: object | null = Object.getPrototypeOf(value) as object | null;
      while (prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "name");
        if (descriptor) {
          const name: unknown = "value" in descriptor ? descriptor.value : MASK;
          Object.defineProperty(copy, "name", {
            value: typeof name === "string" ? maskRegisteredLogSecrets(name) : MASK,
            configurable: true,
          });
          break;
        }
        prototype = Object.getPrototypeOf(prototype) as object | null;
      }
    }
    return copy;
  }

  return visit(value) as T;
}
