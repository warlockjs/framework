/**
 * Reading `// @proves <feature>/<flow> AC-<n>` lines from test files (owned
 * by T-129; the Vitest reporter of T-133 uses `scanProofsInText`).
 *
 * A proof line is a line comment on its own line. The test it proves is the
 * first `it(`, `test(`, `it.only(`, `test.each(…)(` … call that starts on the
 * next non-blank, non-comment line; several `@proves` lines may stack above
 * one test (that is `GR4005`). Lines inside block comments are ignored.
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { ProofLine } from "../contracts/test-results";

/** What a scan returns. */
export type ScanProofsResult = {
  proofs: ProofLine[];
  /** `GR4003` (malformed line), `GR4004` (no test under it), `GR4005` (two proofs on one test). */
  findings: GrimoireFinding[];
};

/** Read the proof lines of one test file's content. Pure. */
export function scanProofsInText(text: string, file: string): ScanProofsResult {
  void text;
  void file;
  throw new Error("not implemented");
}

/**
 * Read the proof lines of every test file.
 *
 * @param root Absolute project root.
 * @param testFiles Project-relative test files (`BookFacts.tests`).
 */
export async function scanProofs(root: string, testFiles: readonly string[]): Promise<ScanProofsResult> {
  void root;
  void testFiles;
  throw new Error("not implemented");
}
