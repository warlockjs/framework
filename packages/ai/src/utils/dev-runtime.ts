/**
 * Whether this process looks like a development run: not production, not a
 * test runner. Development-only helpers (tool schema warnings, agent trace
 * recording) are on here and off elsewhere unless the app opts in.
 *
 * Read on every call so a test can flip `NODE_ENV`.
 *
 * @example
 * if (isDevRuntime()) log.warn("ai.tool", "schema.lint", "...");
 */
export function isDevRuntime(): boolean {
  const env = process.env.NODE_ENV;

  return env !== "production" && env !== "test" && !process.env.VITEST;
}
