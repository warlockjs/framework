import { UnsafeFilterError } from "../../errors/unsafe-filter.error";

/**
 * Guards for MongoDB filter helpers whose arguments land in an operator or
 * aggregation-expression position.
 *
 * Inside `$expr`, an object value is evaluated as an expression (including
 * `$function`, which runs JavaScript in the database), and a `$`-prefixed
 * field name in a filter is an operator (`$where` runs JavaScript on the
 * update/delete commands). Values that only make sense as primitives are
 * therefore checked before they are recorded.
 */

/**
 * Assert a field name is a document path, not a MongoDB operator: it must not
 * start with `$` or hold a `$`-prefixed path segment (`a.$where`).
 *
 * @param field - The field name passed to a where helper
 * @throws UnsafeFilterError when the name is an operator
 */
export function assertSafeFieldName(field: unknown): void {
  if (typeof field !== "string") return;

  if (field.startsWith("$") || field.includes(".$")) {
    throw new UnsafeFilterError(
      `Unsafe filter: "${field}" is not a field name; a "$"-prefixed name is a MongoDB operator. ` +
        `Use a plain field path, or whereRaw({ ... }) for an intentional operator filter.`,
      field,
      field,
    );
  }
}

/**
 * Assert a value is a finite number (a day, month, year, length or size).
 *
 * @param value - The value passed by the caller
 * @param field - The field name, used in the error message
 * @param method - The helper name, used in the error message
 * @throws UnsafeFilterError when the value is not a finite number
 */
export function assertFiniteNumber(value: unknown, field: string, method: string): void {
  if (typeof value === "number" && Number.isFinite(value)) return;

  throw new UnsafeFilterError(
    `Unsafe filter: ${method}("${field}", …) expects a finite number, got ${describe(value)}. ` +
      `Convert request input with Number() and check it before passing it.`,
    field,
  );
}

/** `HH:MM` or `HH:MM:SS`. */
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Assert a value is a time string (`HH:MM` or `HH:MM:SS`).
 *
 * @param value - The value passed by the caller
 * @param field - The field name, used in the error message
 * @throws UnsafeFilterError when the value is not a time string
 */
export function assertTimeString(value: unknown, field: string): void {
  if (typeof value === "string" && TIME_PATTERN.test(value)) return;

  throw new UnsafeFilterError(
    `Unsafe filter: whereTime("${field}", …) expects a time string such as "14:30", got ${describe(value)}.`,
    field,
  );
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return `the string "${value.slice(0, 40)}"`;

  return typeof value;
}
