/** `foo.spec.ts`, `foo.test.tsx`, `foo.spec.mjs` … — a file only a test runner can load. */
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * Whether a path names a test file. Folder-scanning commands (`warlock seed`,
 * `warlock migrate`) skip these: a spec that sits beside the seeder it tests
 * calls `vi.mock()` at import time, which throws outside Vitest.
 */
export function isTestFile(filePath: string): boolean {
  return TEST_FILE.test(filePath);
}
