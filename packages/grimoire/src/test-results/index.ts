/**
 * Test results per criterion (owned by T-133; `criterionStatus` is shared).
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { ProofResult, TestResultsStore } from "../contracts/test-results";

export { criterionStatus, type CriterionTestResult } from "./criterion-status";

/** Read `grimoire/book/test-results.json`; `null` when absent or unreadable. */
export async function readTestResults(root: string): Promise<TestResultsStore | null> {
  void root;
  throw new Error("not implemented");
}

/**
 * Merge one run into the store: results of the test files the run covered
 * replace the old ones; results of other files stay. Pure.
 *
 * @param ranFiles Test files the run executed (even those with no proving test).
 */
export function mergeTestResults(
  store: TestResultsStore | null,
  run: readonly ProofResult[],
  ranFiles: readonly string[],
  now: Date,
): TestResultsStore {
  void store;
  void run;
  void ranFiles;
  void now;
  throw new Error("not implemented");
}

/** Write the store (atomically: temp file, then rename). */
export async function writeTestResults(root: string, store: TestResultsStore): Promise<void> {
  void root;
  void store;
  throw new Error("not implemented");
}

/** The GR4006–GR4008 rules. Read-only; nothing when no results exist. */
export function checkTestResults(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;
  throw new Error("not implemented");
}
