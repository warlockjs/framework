/**
 * Test results per acceptance criterion.
 *
 * A test proves a criterion with a comment line directly above it:
 * `// @proves <feature>/<flow> AC-<n>`. The Vitest reporter
 * (`@warlock.js/grimoire/vitest`) records the last outcome of every such
 * test in `grimoire/book/test-results.json`; book maps, `scry --flow`, the
 * check and the devtools tab read it.
 */
import type { CriterionId, FlowRef } from "./written";
import type { SourceLocation } from "./location";

/** One `// @proves` line, as `scanProofs()` reads it from a test file. */
export type ProofLine = {
  feature: string;
  flow: string;
  /** `<feature>/<flow>`. */
  ref: FlowRef;
  criterion: CriterionId;
  /** The `it(…)` / `test(…)` call right under the comment, or `null` when there is none. */
  test: { name: string | null; line: number } | null;
  /** The comment line itself. */
  at: SourceLocation;
};

/** Outcome of one test in one run. */
export type TestOutcome = "pass" | "fail" | "skip";

/** The last result of one proving test. */
export type ProofResult = {
  feature: string;
  flow: string;
  criterion: CriterionId;
  /** Project-relative test file. */
  testFile: string;
  /** Full test name as the runner reports it (`describe > it`). */
  testName: string;
  /** Line of the test call. */
  line: number;
  outcome: TestOutcome;
  durationMs: number | null;
  /** ISO time of the run. */
  ranAt: string;
  /** sha256 of the test file when it ran. A different hash now means the result is stale. */
  testFileHash: string;
};

/**
 * `grimoire/book/test-results.json`. A run replaces the results of the test
 * files it ran and keeps the others, so a partial run never forgets results.
 * The book builder never deletes this file.
 */
export type TestResultsStore = {
  schemaVersion: 1;
  /** ISO time of the last run that wrote it. */
  updatedAt: string;
  runner: "vitest";
  results: ProofResult[];
};

/**
 * The status of one criterion, from its proving tests:
 * - `no-test`: no `@proves` line names it;
 * - `fail`: a proving test failed in its last run;
 * - `stale`: none failed, and a result is older than its test file (hash differs);
 * - `not-run`: none failed or is stale, and a proving test has no result;
 * - `pass`: every proving test passed and none is stale.
 *
 * Skipped tests count as not run.
 */
export type CriterionStatus = "pass" | "fail" | "stale" | "not-run" | "no-test";
