import type { CriterionStatus, TestOutcome } from "../contracts/test-results";

/** One proving test of a criterion, with its last result. */
export type CriterionTestResult = {
  result: TestOutcome | "not-run";
  stale: boolean;
};

/**
 * The status of a criterion from its proving tests: `no-test` with none,
 * `fail` when one failed, else `stale` when a result is older than its test
 * file, else `not-run` when one has no result (or was skipped), else `pass`.
 */
export function criterionStatus(tests: readonly CriterionTestResult[]): CriterionStatus {
  if (tests.length === 0) return "no-test";
  if (tests.some((test) => test.result === "fail")) return "fail";
  if (tests.some((test) => test.stale)) return "stale";
  if (tests.some((test) => test.result === "not-run" || test.result === "skip")) return "not-run";

  return "pass";
}
