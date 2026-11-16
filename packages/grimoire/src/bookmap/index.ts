/**
 * Book maps and collected indexes (owned by T-128).
 */
import type { BookFacts, BookManifest } from "../contracts";
import type { BookAnnotations } from "../contracts/book";
import type { CollectedFiles, Ownership } from "../contracts/bookmap";
import type { AppMatch } from "../contracts/snapshot";
import type { ProofLine, TestResultsStore } from "../contracts/test-results";
import type { WrittenGrimoire } from "../contracts/written";

/** Everything the book maps are computed from. */
export type CollectedInput = {
  written: WrittenGrimoire;
  facts: BookFacts;
  ownership: Ownership;
  apps: Record<string, AppMatch>;
  proofs: ProofLine[];
  results: TestResultsStore | null;
  /** Test file → current sha256 (a result with another hash is stale). */
  testHashes: Record<string, string>;
};

/** Every feature and flow book map, `features/index.json` and `tasks/index.json`. Pure. */
export function buildCollectedFiles(input: CollectedInput): CollectedFiles {
  void input;
  throw new Error("not implemented");
}

/** The per-file owner, borrowers and flows the book entries show. Pure. */
export function annotationsFrom(
  input: CollectedInput,
  collected: CollectedFiles,
  manifest: Pick<BookManifest, "tests">,
): BookAnnotations {
  void input;
  void collected;
  void manifest;
  throw new Error("not implemented");
}

/**
 * Write the collected files under `grimoire/features` and `grimoire/tasks`,
 * only those whose content changed, and remove book maps of features and flows
 * that no longer exist.
 *
 * @returns Project-relative files written and removed.
 */
export async function writeCollectedFiles(
  root: string,
  collected: CollectedFiles,
): Promise<{ written: string[]; removed: string[] }> {
  void root;
  void collected;
  throw new Error("not implemented");
}
