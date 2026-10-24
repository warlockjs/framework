import assert from "node:assert/strict";
import { test } from "node:test";

import { isExemptSpecFile, isFixtureAppFile } from "./spec-coverage-exemptions.mjs";

test("skips test files inside tests/fixtures app fixtures", () => {
  assert.equal(isFixtureAppFile("tests/fixtures/vitest-exit-app/tests/a.test.ts"), true);
  assert.equal(isFixtureAppFile("tests\\fixtures\\app\\plain.spec.ts"), true);
});

test("does not skip ordinary specs", () => {
  assert.equal(isExemptSpecFile("src/tests/vitest-process-exit.spec.ts"), false);
  assert.equal(isExemptSpecFile("tests/unit/fixtures.spec.ts"), false);
  assert.equal(isExemptSpecFile("fixtures/tests/a.spec.ts"), false);
});

test("still skips scaffold templates", () => {
  assert.equal(isExemptSpecFile("templates/app/a.spec.ts"), true);
});
