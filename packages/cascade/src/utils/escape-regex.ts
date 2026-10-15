/**
 * Regex escaping for pattern-matching helpers.
 *
 * `whereLike` / `whereNotLike` / `whereStartsWith` / `whereEndsWith` /
 * `whereSearch` compile their argument into a MongoDB `$regex`. The argument is
 * exactly what a search box hands over (`whereSearch("name", req.query.q)`), so
 * passing it through unescaped gave the caller control of the regex itself:
 *
 * - **injection** — `.*` / `|` / `^` change the intended match semantics, and a
 *   boolean-oracle probe (`^a`, `^b`, …) reads values back one character at a
 *   time from a field the endpoint never meant to expose;
 * - **ReDoS** — nested quantifiers (`(a+)+`) backtrack catastrophically inside
 *   `mongod`, against every document the query scans.
 *
 * A string value is therefore treated as a LITERAL. Only an explicit `RegExp`
 * argument — which cannot come from JSON, so it is developer-authored — reaches
 * the regex engine as a pattern.
 */

/** Characters that carry meaning to the regex engine and must be neutralized. */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Escape every regex metacharacter in a string so it matches itself.
 *
 * @param value - The literal text to match
 * @returns Regex source matching `value` verbatim
 *
 * @example
 * ```typescript
 * escapeRegex("(a+)+$"); // "\\(a\\+\\)\\+\\$"
 * ```
 */
export function escapeRegex(value: string): string {
  return value.replace(REGEX_METACHARACTERS, "\\$&");
}

/**
 * Compile a `whereLike` pattern into regex source.
 *
 * The pattern is escaped first, so nothing the caller typed can act as a regex
 * operator; the SQL `LIKE` wildcard `%` is then translated to `.*` — the one
 * wildcard the API documents (`whereLike("email", "%@gmail.com")`). Runs of `%`
 * collapse into a single `.*`, since `%%%%…` compiles to nothing but extra
 * backtracking work.
 *
 * The result stays unanchored: MongoDB's `whereLike` matches a substring
 * (`whereLike("name", "ar")` finds "Carol"), which is the documented behavior of
 * this driver and is unchanged by the escaping.
 *
 * @param pattern - The user-supplied LIKE pattern
 * @returns Regex source matching the pattern literally, `%` aside
 *
 * @example
 * ```typescript
 * likePatternToRegexSource("%o'brien%"); // ".*o'brien.*"
 * likePatternToRegexSource("a.b");       // "a\\.b"  (a literal dot)
 * ```
 */
export function likePatternToRegexSource(pattern: string): string {
  return escapeRegex(pattern).replace(/%+/g, ".*");
}

/**
 * Resolve a `whereLike`-style argument to regex source.
 *
 * An explicit `RegExp` is developer-authored and passes through as-is; a string
 * is user-shaped input and is treated as a literal LIKE pattern.
 *
 * @param pattern - A `RegExp` (trusted, used verbatim) or a string (escaped)
 * @returns Regex source ready for `$regex`
 */
export function resolveLikePattern(pattern: RegExp | string): string {
  return pattern instanceof RegExp ? pattern.source : likePatternToRegexSource(pattern);
}
