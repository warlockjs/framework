/**
 * `openGrimoire()` with the counts `warlock grimoire build` prints: the same
 * steps, in the same order, keeping what `writeBook` and
 * `writeCollectedFiles` report instead of dropping it.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchApps } from "../apps";
import { buildBook, writeBook } from "../book";
import { annotationsFrom, buildCollectedFiles, writeCollectedFiles, type CollectedInput } from "../bookmap";
import type { BookAdapter } from "../contracts/adapter";
import type { BuildBookOptions, WriteBookResult } from "../contracts/book";
import type { GrimoireSnapshot, OpenGrimoireOptions } from "../contracts/snapshot";
import { resolveOwnership } from "../ownership";
import { toPosixPath } from "../paths";
import { scanProofs } from "../proves";
import { readTestResults } from "../test-results";
import { parseGrimoire } from "../written";

/** What one build did, with the snapshot it produced. */
export type GrimoireRun = {
  snapshot: GrimoireSnapshot;
  /** `false` when the book's fingerprint matched and the adapter was not asked for files. */
  rebuilt: boolean;
  /** Source files added, changed or removed since the last build. */
  changed: string[];
  book: WriteBookResult;
  collected: { written: string[]; removed: string[] };
};

async function testFileHashes(
  root: string,
  tests: readonly string[],
  known: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  for (const test of [...new Set(tests.map(toPosixPath))].sort()) {
    const hash = known[test];

    if (hash !== undefined) {
      hashes[test] = hash;
      continue;
    }

    try {
      hashes[test] = createHash("sha256")
        .update(await readFile(path.join(root, ...test.split("/"))))
        .digest("hex");
    } catch {
      // A listed test file that is gone has no hash.
    }
  }

  return hashes;
}

/** Build the book and the collected files, and say what was written. */
export async function runGrimoire(
  root: string,
  adapter: BookAdapter,
  options: Omit<OpenGrimoireOptions, "write"> = {},
): Promise<GrimoireRun> {
  const { written, findings: structure } = await parseGrimoire(root);
  const bookOptions: BuildBookOptions = { routes: options.routes ?? "cached" };

  if (options.force !== undefined) bookOptions.force = options.force;
  if (options.now !== undefined) bookOptions.now = options.now;

  const { book, rebuilt, changed } = await buildBook(root, adapter, bookOptions);
  const apps = matchApps(written.apps, book.facts);
  const ownership = resolveOwnership(written, book.facts);
  const { proofs, findings: proofFindings } = await scanProofs(root, book.facts.tests);
  const results = await readTestResults(root);
  const testHashes = await testFileHashes(root, book.facts.tests, book.manifest.tests);
  const input: CollectedInput = { written, facts: book.facts, ownership, apps, proofs, results, testHashes };
  const collected = buildCollectedFiles(input);
  const annotations = annotationsFrom(input, collected, { tests: testHashes });
  const bookWrite = await writeBook(book, annotations);
  const collectedWrite = await writeCollectedFiles(root, collected);

  return {
    snapshot: {
      root,
      written,
      structure,
      book,
      ownership,
      apps,
      proofs,
      proofFindings,
      results,
      collected,
      annotations,
      routes: book.routes,
    },
    rebuilt,
    changed,
    book: bookWrite,
    collected: collectedWrite,
  };
}
