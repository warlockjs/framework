/**
 * Reading `// @proves <feature>/<flow> AC-<n>` lines from test files (owned
 * by T-129; the Vitest reporter of T-133 uses `scanProofsInText`).
 *
 * A proof line is a line comment on its own line. The test it proves is the
 * first `it(`, `test(`, `it.only(`, `test.each(…)(` … call that starts on the
 * next non-blank, non-comment line; several `@proves` lines may stack above
 * one test (that is `GR4005`). Lines inside block comments are ignored.
 */
export { scanProofs, scanProofsInText, type ScanProofsResult } from "./scan-proofs";

/**
 * Reading `// @shows <feature>/<flow> AC-<n>` lines from browser test files:
 * the line sits directly above a `shows()` call that names the same criterion
 * (`GR4013` otherwise); a line naming no flow or criterion is `GR4014`.
 */
export {
  knownCriteria,
  scanShows,
  scanShowsInText,
  type KnownCriteria,
  type ScanShowsResult,
} from "./scan-shows";
