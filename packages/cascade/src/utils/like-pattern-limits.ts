import { UnsafeFilterError } from "../errors/unsafe-filter.error";

/**
 * Bounds on a string `whereLike` / `whereNotLike` pattern compiled to a regex.
 *
 * Each `%` becomes `.*`, and every extra `.*` multiplies how much a regex
 * engine may backtrack against one long value. Two wildcards cover the
 * patterns a search box produces (`%term%`, `prefix%`, `%suffix`); a pattern
 * with more is refused instead of being sent to the database.
 */
export type LikePatternLimits = {
  /**
   * Most `%` wildcards a pattern may hold. A run of `%%%` counts as one.
   *
   * @default 2
   */
  maxWildcards?: number;
  /**
   * Longest pattern accepted, in characters.
   *
   * @default 256
   */
  maxLength?: number;
};

/** Default wildcard cap: keeps `%term%`, `prefix%` and `%suffix` working. */
export const DEFAULT_LIKE_MAX_WILDCARDS = 2;

/** Default pattern length cap. */
export const DEFAULT_LIKE_MAX_LENGTH = 256;

/**
 * Turn a `whereLike` argument into the pattern text, refusing values that
 * cannot be a pattern. Numbers, booleans and bigints match their text form (a
 * numeric query value from a JSON body is a valid search); objects, arrays and
 * nullish values are refused.
 *
 * @param pattern - The raw argument
 * @param field - The field name, used in the error message
 * @throws UnsafeFilterError when the value is not a string or a primitive
 */
export function likePatternText(pattern: unknown, field = "field"): string {
  if (typeof pattern === "string") return pattern;

  if (typeof pattern === "number" || typeof pattern === "boolean" || typeof pattern === "bigint") {
    return String(pattern);
  }

  throw new UnsafeFilterError(
    `Unsafe filter: the LIKE pattern for field "${field}" must be a string, got ${
      pattern === null ? "null" : Array.isArray(pattern) ? "an array" : typeof pattern
    }. Pass the search text as a string.`,
    field,
  );
}

/**
 * Assert a LIKE pattern stays within the wildcard and length caps.
 *
 * @param pattern - The pattern text (before escaping)
 * @param limits - Configured limits; omitted values use the defaults
 * @param field - The field name, used in the error message
 * @throws UnsafeFilterError when a cap is exceeded
 */
export function assertSafeLikePattern(
  pattern: string,
  limits: LikePatternLimits | undefined,
  field = "field",
): void {
  const maxLength = limits?.maxLength ?? DEFAULT_LIKE_MAX_LENGTH;
  const maxWildcards = limits?.maxWildcards ?? DEFAULT_LIKE_MAX_WILDCARDS;

  if (pattern.length > maxLength) {
    throw new UnsafeFilterError(
      `Unsafe filter: the LIKE pattern for field "${field}" is ${pattern.length} characters long; ` +
        `at most ${maxLength} are allowed. Shorten the search text, or raise the "like.maxLength" ` +
        `driver option of the data source.`,
      field,
    );
  }

  const wildcards = pattern.match(/%+/g)?.length ?? 0;

  if (wildcards > maxWildcards) {
    throw new UnsafeFilterError(
      `Unsafe filter: the LIKE pattern for field "${field}" holds ${wildcards} "%" wildcards; ` +
        `at most ${maxWildcards} are allowed (enough for "%term%", "prefix%" and "%suffix"). ` +
        `Search for fewer terms, or raise the "like.maxWildcards" driver option of the data source.`,
      field,
    );
  }
}
