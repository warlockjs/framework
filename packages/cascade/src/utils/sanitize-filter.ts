import { UnsafeFilterError } from "../errors/unsafe-filter.error";

/**
 * Filter sanitization for equality-position values.
 *
 * `where({ field: value })`, `where(field, value)` and the filter-accepting
 * model statics (`first`, `findAll`, `deleteMany`, …) express *equality*
 * matches. If a request-controlled value such as `{ $ne: null }` is passed
 * through verbatim, MongoDB reinterprets it as an operator query — the classic
 * NoSQL operator-injection / auth-bypass primitive. These helpers reject any
 * `$`-prefixed key found in an equality position instead of forwarding it.
 *
 * Explicit operator APIs (`where(field, operator, value)`, `whereIn`,
 * `whereNull`, object-form `whereRaw({ ... })`, …) are intentionally NOT
 * routed through this check.
 */

/**
 * Returns true for plain objects only (`{}` / `Object.create(null)`).
 * BSON values such as `Date`, `RegExp`, `ObjectId` or `Buffer` are class
 * instances whose keys are not Mongo operators, so they are never traversed.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const rejectOperatorKey = (field: string, key: string): never => {
  throw new UnsafeFilterError(
    `Unsafe filter: value for field "${field}" contains the reserved MongoDB operator key "${key}". ` +
      `Equality filters must not carry "$"-prefixed keys. ` +
      `Use the explicit operator API instead — e.g. where(field, operator, value), whereIn(), whereNull(), or the object form of whereRaw().`,
    field,
    key,
  );
};

const assertNoOperatorKeys = (value: unknown, field: string): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoOperatorKeys(item, field);
    }
    return;
  }

  if (!isPlainObject(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith("$")) {
      rejectOperatorKey(field, key);
    }
    assertNoOperatorKeys(nested, field);
  }
};

/**
 * Assert a single equality-position value carries no `$`-prefixed keys.
 * Scalars, `Date`s and other non-plain objects pass through untouched;
 * plain objects/arrays are checked recursively.
 *
 * @param value - The equality value to check
 * @param field - The field name, used for the error message
 * @returns The value, unchanged
 * @throws UnsafeFilterError when a `$`-prefixed key is found
 */
export function sanitizeFilterValue<T>(value: T, field: string): T {
  assertNoOperatorKeys(value, field);
  return value;
}

/**
 * Assert a `{ field: value }` equality filter carries no `$`-prefixed keys —
 * neither as top-level field names (`{ $where: … }`) nor inside any value
 * (`{ password: { $ne: null } }`). Dotted field paths ("profile.name") and
 * plain nested documents remain valid.
 *
 * @param filter - The filter object to check
 * @returns The filter, unchanged
 * @throws UnsafeFilterError when a `$`-prefixed key is found
 */
export function sanitizeFilter<T extends Record<string, unknown>>(filter: T): T {
  for (const [field, value] of Object.entries(filter)) {
    if (field.startsWith("$")) {
      rejectOperatorKey(field, field);
    }
    assertNoOperatorKeys(value, field);
  }
  return filter;
}
