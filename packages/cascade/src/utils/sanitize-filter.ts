import { UndefinedWhereValueError } from "../errors/undefined-where-value.error";
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
 * Reject a bound `undefined` value in an equality position. `undefined`
 * silently becomes `= NULL` (SQL) / "field missing" (MongoDB) — a query that
 * never matches what the caller meant, instead of failing loudly. `null` is
 * the explicit, intentional way to match NULL and is never rejected here.
 *
 * @param value - The equality value to check
 * @param field - The field name, used for the error message
 * @throws UndefinedWhereValueError when `value` is `undefined`
 */
export const assertDefined = (value: unknown, field: string): void => {
  if (value === undefined) {
    throw new UndefinedWhereValueError(field);
  }
};

/**
 * Assert a single equality-position value carries no `$`-prefixed keys and
 * is not `undefined`. Scalars, `Date`s and other non-plain objects pass
 * through untouched; plain objects/arrays are checked recursively for
 * operator keys.
 *
 * @param value - The equality value to check
 * @param field - The field name, used for the error message
 * @returns The value, unchanged
 * @throws UnsafeFilterError when a `$`-prefixed key is found
 * @throws UndefinedWhereValueError when `value` is `undefined`
 */
export function sanitizeFilterValue<T>(value: T, field: string): T {
  assertDefined(value, field);
  assertNoOperatorKeys(value, field);
  return value;
}

/**
 * Assert a `{ field: value }` equality filter carries no `$`-prefixed keys —
 * neither as top-level field names (`{ $where: … }`) nor inside any value
 * (`{ password: { $ne: null } }`) — and that no field's value is `undefined`.
 * Dotted field paths ("profile.name") and plain nested documents remain
 * valid.
 *
 * @param filter - The filter object to check
 * @returns The filter, unchanged
 * @throws UnsafeFilterError when a `$`-prefixed key is found
 * @throws UndefinedWhereValueError when a field's value is `undefined`
 */
export function sanitizeFilter<T extends Record<string, unknown>>(filter: T): T {
  for (const [field, value] of Object.entries(filter)) {
    if (field.startsWith("$")) {
      rejectOperatorKey(field, field);
    }
    assertDefined(value, field);
    assertNoOperatorKeys(value, field);
  }
  return filter;
}
