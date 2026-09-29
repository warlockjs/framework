import { describe, expect, it } from "vitest";
import { isTestFile } from "../../../src/utils/is-test-file";

describe("isTestFile", () => {
  it.each([
    "src/app/users/seeds/admin.seed.spec.ts",
    "src/app/users/seeds/admin.seed.test.ts",
    "src/app/posts/migrations/add-body.spec.tsx",
    "C:\\app\\src\\app\\users\\seeds\\admin.seed.spec.mjs",
  ])("recognises %s as a test file", (filePath) => {
    expect(isTestFile(filePath)).toBe(true);
  });

  it.each([
    "src/app/users/seeds/admin.seed.ts",
    "src/app/users/seeds/test-users.seed.ts",
    "src/app/posts/migrations/spec-sheet.migration.ts",
    "src/app/posts/migrations/12-09-2026_add-test.migration.ts",
  ])("keeps %s", (filePath) => {
    expect(isTestFile(filePath)).toBe(false);
  });
});
