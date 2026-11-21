/**
 * The pipeline every command runs first (owned by T-128):
 *
 * 1. `parseGrimoire(root)`;
 * 2. `buildBook(root, adapter, { routes })`;
 * 3. `matchApps`, `resolveOwnership`, `scanProofs`, `readTestResults`;
 * 4. `buildCollectedFiles`, `annotationsFrom`;
 * 5. when `write` is not `false`: `writeBook`, `writeCollectedFiles` and the derived file
 *    (`derived.ts`) that `openStoredGrimoire` reads instead of computing 1–4.
 *
 * A second run with nothing changed calls no adapter method and writes no file.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchApps } from "../apps";
import { buildBook, writeBook } from "../book";
import { grimoireVersion } from "../book/build";
import {
  annotationsFrom,
  buildCollectedFiles,
  writeCollectedFiles,
  type CollectedInput,
} from "../bookmap";
import type { BookAdapter } from "../contracts/adapter";
import type { BuildBookOptions, WriteBookResult } from "../contracts/book";
import type { GrimoireSnapshot, OpenGrimoireOptions } from "../contracts/snapshot";
import { resolveOwnership } from "../ownership";
import { toPosixPath } from "../paths";
import { scanProofs } from "../proves";
import { readTestResults, resultsFileLabel } from "../test-results";
import { parseGrimoire } from "../written";
import { writeDerived } from "./derived";

/** The current sha256 of each test file: the manifest's, else read now (missing files are left out). */
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
      const content = await readFile(path.join(root, ...test.split("/")));
      hashes[test] = createHash("sha256").update(content).digest("hex");
    } catch {
      // A listed test file that is gone has no hash; its results are not marked stale.
    }
  }

  return hashes;
}

/** What one pass of the pipeline did, with the snapshot it produced (`warlock grimoire build` prints it). */
export type GrimoireRun = {
  snapshot: GrimoireSnapshot;
  /** `false` when the book's fingerprint matched and the adapter was not asked for files. */
  rebuilt: boolean;
  /** Source files added, changed or removed since the last build. */
  changed: string[];
  /** Book files written and removed (both empty with `write: false`). */
  book: WriteBookResult;
  /** Collected files (book maps, indexes) written and removed (both empty with `write: false`). */
  collected: { written: string[]; removed: string[] };
};

/**
 * Run the pipeline and say what it wrote. `openGrimoire` is this without the
 * counts.
 *
 * @param root Absolute project root.
 */
export async function runGrimoire(
  root: string,
  adapter: BookAdapter,
  options: OpenGrimoireOptions = {},
): Promise<GrimoireRun> {
  const write = options.write !== false;
  const { written, findings: structure } = await parseGrimoire(root);

  const bookOptions: BuildBookOptions & { write?: boolean } = {
    routes: options.routes ?? "cached",
  };

  if (options.force !== undefined) bookOptions.force = options.force;
  if (options.now !== undefined) bookOptions.now = options.now;
  if (!write) bookOptions.write = false;

  const { book, rebuilt, changed } = await buildBook(root, adapter, bookOptions);
  const apps = matchApps(written.apps, book.facts);
  const ownership = resolveOwnership(written, book.facts);
  const { proofs, findings: proofFindings } = await scanProofs(root, book.facts.tests);
  const resultsFile = resultsFileLabel(root, options.testResultsFile);
  const results = await readTestResults(root, options.testResultsFile);
  const testHashes = await testFileHashes(root, book.facts.tests, book.manifest.tests);

  const input: CollectedInput = {
    written,
    facts: book.facts,
    ownership,
    apps,
    proofs,
    results,
    testHashes,
  };
  const collected = buildCollectedFiles(input);
  const annotations = annotationsFrom(input, collected, { tests: testHashes });
  let bookWrite: WriteBookResult = { written: [], removed: [] };
  let collectedWrite: { written: string[]; removed: string[] } = { written: [], removed: [] };

  if (write) {
    bookWrite = await writeBook(book, annotations);
    collectedWrite = await writeCollectedFiles(root, collected);
  }

  const host = (await adapter.host?.(root)) ?? null;
  const snapshot: GrimoireSnapshot = {
    root,
    written,
    structure,
    book,
    ownership,
    apps,
    proofs,
    proofFindings,
    results,
    resultsFile,
    collected,
    annotations,
    routes: book.routes,
    host,
  };

  // The derived half is kept for the read-only commands (`warlock scry`).
  if (write) await writeDerived(root, snapshot, grimoireVersion(), options.testResultsFile);

  return {
    snapshot,
    rebuilt,
    changed,
    book: bookWrite,
    collected: collectedWrite,
  };
}

/**
 * Load, refresh and return everything about the project's grimoire.
 *
 * @param root Absolute project root.
 */
export async function openGrimoire(
  root: string,
  adapter: BookAdapter,
  options: OpenGrimoireOptions = {},
): Promise<GrimoireSnapshot> {
  return (await runGrimoire(root, adapter, options)).snapshot;
}
