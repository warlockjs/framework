import { UnsafeFilterError } from "../errors/unsafe-filter.error";

/**
 * Validation and ceilings for page sizes and offsets.
 *
 * `paginate({ limit: request.input("limit") })` is a common shape, so the
 * page size reaching a driver can be anything a client sent. Each value is
 * checked to be a whole number, and a page size is capped at `maxLimit`, so a
 * `?limit=10000000` request cannot load a whole table into memory.
 */

/** Largest page `paginate()` / `cursorPaginate()` return unless `maxLimit` says otherwise. */
export const DEFAULT_PAGINATE_MAX_LIMIT = 1000;

/**
 * Coerce a count (page size, page number, offset) to a safe integer.
 * A string of digits is accepted (query strings carry numbers as text).
 *
 * @param value - The value to check
 * @param label - Name used in the error message (e.g. `limit()`)
 * @param min - Smallest accepted value
 * @throws UnsafeFilterError when the value is not a safe integer of at least
 *   `min` (the value usually comes from a request, so it is the same refusal
 *   as an unsafe filter value)
 */
export function toSafeCount(value: unknown, label: string, min = 0): number {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;

  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min) {
    throw new UnsafeFilterError(
      `${label} must be a whole number of at least ${min}, got ${
        typeof value === "string" ? `"${value.slice(0, 40)}"` : String(value)
      }. Convert request input with Number() and check it before passing it.`,
    );
  }

  return number;
}

/**
 * Resolve the page size for `paginate()` / `cursorPaginate()`: a whole
 * number of at least 1, capped at `maxLimit`.
 *
 * @param limit - Requested page size (default 10)
 * @param maxLimit - Ceiling (default {@link DEFAULT_PAGINATE_MAX_LIMIT}); `Infinity` disables it
 * @param method - Method name used in error messages
 */
export function resolvePageLimit(
  limit: unknown,
  maxLimit: number | undefined,
  method: string,
): number {
  const ceiling = maxLimit ?? DEFAULT_PAGINATE_MAX_LIMIT;

  if (typeof ceiling !== "number" || Number.isNaN(ceiling) || ceiling < 1) {
    throw new Error(`${method}(): "maxLimit" must be a number of at least 1.`);
  }

  const size = toSafeCount(limit ?? 10, `${method}(): "limit"`, 1);

  return Math.min(size, ceiling);
}

/**
 * Resolve the page number for `paginate()`: a whole number of at least 1.
 *
 * @param page - Requested page (default 1)
 */
export function resolvePageNumber(page: unknown): number {
  return toSafeCount(page ?? 1, `paginate(): "page"`, 1);
}
