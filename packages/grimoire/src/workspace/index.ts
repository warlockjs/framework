/**
 * The pipeline every command runs first (owned by T-128):
 *
 * 1. `parseGrimoire(root)`;
 * 2. `buildBook(root, adapter, { routes })`;
 * 3. `matchApps`, `resolveOwnership`, `scanProofs`, `readTestResults`;
 * 4. `buildCollectedFiles`, `annotationsFrom`;
 * 5. when `write` is not `false`: `writeBook` and `writeCollectedFiles`.
 *
 * A second run with nothing changed calls no adapter method and writes no file.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchApps } from "../apps";
import { buildBook, writeBook } from "../book";
import { annotationsFrom, buildCollectedFiles, writeCollectedFiles, type CollectedInput } from "../bookmap";
import type { BookAdapter } from "../contracts/adapter";
import type { BuildBookOptions } from "../contracts/book";
import type { GrimoireSnapshot, OpenGrimoireOptions } from "../contracts/snapshot";
import { resolveOwnership } from "../ownership";
import { toPosixPath } from "../paths";
import { scanProofs } from "../proves";
import { readTestResults } from "../test-results";
import { parseGrimoire } from "../written";

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
  const write = options.write !== false;
  const { written, findings: structure } = await parseGrimoire(root);

  const bookOptions: BuildBookOptions & { write?: boolean } = { routes: options.routes ?? "cached" };

  if (options.force !== undefined) bookOptions.force = options.force;
  if (options.now !== undefined) bookOptions.now = options.now;
  if (!write) bookOptions.write = false;

  const { book } = await buildBook(root, adapter, bookOptions);
  const apps = matchApps(written.apps, book.facts);
  const ownership = resolveOwnership(written, book.facts);
  const { proofs, findings: proofFindings } = await scanProofs(root, book.facts.tests);
  const results = await readTestResults(root);
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

  if (write) {
    await writeBook(book, annotations);
    await writeCollectedFiles(root, collected);
  }

  return {
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
  };
}
