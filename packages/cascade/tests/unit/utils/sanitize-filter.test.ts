import { describe, expect, it } from "vitest";
import { UndefinedWhereValueError } from "../../../src/errors/undefined-where-value.error";
import { UnsafeFilterError } from "../../../src/errors/unsafe-filter.error";
import { sanitizeFilter, sanitizeFilterValue } from "../../../src/utils/sanitize-filter";

/**
 * `sanitizeFilterValue()` / `sanitizeFilter()` guard every equality-position
 * where-value. Beyond the existing "$"-operator injection check, they must
 * reject `undefined` — a bound `undefined` silently becomes `= NULL` (SQL) /
 * "field missing" (MongoDB), a query that never matches what the caller
 * meant instead of failing loudly. `null` stays a valid, intentional way to
 * match NULL.
 */
describe("sanitizeFilterValue", () => {
  it("throws UndefinedWhereValueError for an undefined value", () => {
    expect(() => sanitizeFilterValue(undefined, "id")).toThrow(UndefinedWhereValueError);
  });

  it("names the offending field on the thrown error", () => {
    try {
      sanitizeFilterValue(undefined, "authorId");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UndefinedWhereValueError);
      expect((error as UndefinedWhereValueError).field).toBe("authorId");
      expect((error as Error).message).toContain("authorId");
    }
  });

  it("still allows null — the explicit way to match NULL", () => {
    expect(() => sanitizeFilterValue(null, "deletedAt")).not.toThrow();
    expect(sanitizeFilterValue(null, "deletedAt")).toBeNull();
  });

  it("passes ordinary values through unchanged", () => {
    expect(sanitizeFilterValue(42, "id")).toBe(42);
    expect(sanitizeFilterValue("active", "status")).toBe("active");
  });

  it("still rejects smuggled operator keys (existing behavior unchanged)", () => {
    expect(() => sanitizeFilterValue({ $ne: null }, "password")).toThrow(UnsafeFilterError);
  });
});

describe("sanitizeFilter", () => {
  it("throws UndefinedWhereValueError when a field's value is undefined", () => {
    expect(() => sanitizeFilter({ id: undefined })).toThrow(UndefinedWhereValueError);
  });

  it("still allows null field values", () => {
    expect(() => sanitizeFilter({ deletedAt: null })).not.toThrow();
  });

  it("still rejects smuggled operator keys (existing behavior unchanged)", () => {
    expect(() => sanitizeFilter({ password: { $ne: null } })).toThrow(UnsafeFilterError);
  });
});
