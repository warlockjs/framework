/**
 * The derived half of a snapshot, kept on disk so that a read-only command
 * (`warlock scry`, the MCP tools) never computes it again.
 *
 * `runGrimoire` writes `grimoire/book/.cache/derived.json` after the book and
 * the collected files: the parsed written files, the owners, the matched apps,
 * the proofs, the test results, the book maps and the annotations. Together
 * with `manifest.json` and `.cache/facts.json` it is the whole snapshot.
 * `openStoredGrimoire` loads it and compares the files with the fingerprint it
 * was written with, so it can say that the book is behind without rebuilding.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readJson, writeBookFile } from "../book/io";
import type { BookAnnotations } from "../contracts/book";
import type { CollectedFiles, Ownership } from "../contracts/bookmap";
import type { BookHost } from "../contracts/adapter";
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSettings } from "../contracts/settings";
import type { ShotsState } from "../contracts/shots";
import type { AppMatch, GrimoireSnapshot } from "../contracts/snapshot";
import type { ProofLine, TestResultsStore } from "../contracts/test-results";
import type { WrittenGrimoire } from "../contracts/written";
import { GRIMOIRE_PATHS } from "../paths";
import { resolveResultsFile } from "../test-results";

/** Where `runGrimoire` keeps the derived data. */
export const DERIVED_PATH = `${GRIMOIRE_PATHS.book}/.cache/derived.json`;

/** Bump when the shape below changes: an older file is treated as missing. */
export const DERIVED_SCHEMA_VERSION = 3;

/** The written folders whose every file is part of the fingerprint. */
const WRITTEN_TREES = [
  GRIMOIRE_PATHS.features,
  GRIMOIRE_PATHS.apps,
  GRIMOIRE_PATHS.releases,
  GRIMOIRE_PATHS.tasks,
  GRIMOIRE_PATHS.screenshots,
  GRIMOIRE_PATHS.approved,
  // A single file: `filesUnder` returns it as it is.
  GRIMOIRE_PATHS.settings,
];

/** What a snapshot holds besides the book. */
export type DerivedSnapshot = {
  written: WrittenGrimoire;
  structure: GrimoireFinding[];
  ownership: Ownership;
  apps: Record<string, AppMatch>;
  proofs: ProofLine[];
  proofFindings: GrimoireFinding[];
  results: TestResultsStore | null;
  resultsFile: string;
  collected: CollectedFiles;
  annotations: BookAnnotations;
  host: BookHost | null;
  settings: GrimoireSettings | null;
  shots: ShotsState | null;
};

/** The file as stored. */
export type StoredDerived = {
  schemaVersion: number;
  grimoireVersion: string;
  /** `manifest.builtAt` of the book this was derived from: a build that stopped between the two writes leaves a mismatch. */
  builtAt: string;
  /** Project-relative POSIX path → `size:mtimeMs`, of every written file and the test results file. */
  inputs: Record<string, string>;
  snapshot: DerivedSnapshot;
};

/** Every file below `folder`, absolute and sorted; a missing folder gives none. */
async function filesUnder(folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;

    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      // A written file that is not a folder (`settings.md`) is listed as it is.
      if (await stat(current).then((info) => info.isFile(), () => false)) found.push(current);

      return;
    }

    for (const entry of entries) {
      const next = path.join(current, entry.name);

      if (entry.isDirectory()) await walk(next);
      else found.push(next);
    }
  };

  await walk(folder);

  return found.sort();
}

/** `size:mtimeMs` of every written file and of the test results file (`-` when it is missing). */
export async function derivedInputs(
  root: string,
  testResultsFile?: string,
): Promise<Record<string, string>> {
  const files = (
    await Promise.all(WRITTEN_TREES.map((tree) => filesUnder(path.join(root, ...tree.split("/")))))
  ).flat();
  const results = resolveResultsFile(root, testResultsFile);
  const inputs: Record<string, string> = {};

  for (const file of [...files, results]) {
    const key = path.relative(root, file).split(path.sep).join("/");

    try {
      const info = await stat(file);

      inputs[key] = `${info.size}:${info.mtimeMs}`;
    } catch {
      inputs[key] = "-";
    }
  }

  return inputs;
}

/** How many of the stored inputs differ from the files now (changed, added or removed). */
export function movedInputs(
  stored: Record<string, string>,
  current: Record<string, string>,
): number {
  let moved = 0;

  for (const [file, stamp] of Object.entries(current)) {
    if (stored[file] !== stamp && !(stored[file] === undefined && stamp === "-")) moved++;
  }

  for (const [file, stamp] of Object.entries(stored)) {
    if (current[file] === undefined && stamp !== "-") moved++;
  }

  return moved;
}

/** Keep the derived half of `snapshot` (the file is rewritten only when its content changed). */
export async function writeDerived(
  root: string,
  snapshot: GrimoireSnapshot,
  version: string,
  testResultsFile?: string,
): Promise<void> {
  const stored: StoredDerived = {
    schemaVersion: DERIVED_SCHEMA_VERSION,
    grimoireVersion: version,
    builtAt: snapshot.book.manifest.builtAt,
    inputs: await derivedInputs(root, testResultsFile),
    snapshot: {
      written: snapshot.written,
      structure: snapshot.structure,
      ownership: snapshot.ownership,
      apps: snapshot.apps,
      proofs: snapshot.proofs,
      proofFindings: snapshot.proofFindings,
      results: snapshot.results,
      resultsFile: snapshot.resultsFile,
      collected: snapshot.collected,
      annotations: snapshot.annotations,
      host: snapshot.host ?? null,
      settings: snapshot.settings ?? null,
      shots: snapshot.shots ?? null,
    },
  };
  const previous = await readJson<StoredDerived>(path.join(root, ...DERIVED_PATH.split("/")));

  // A rerun with nothing changed writes nothing.
  if (previous !== null && JSON.stringify(previous) === JSON.stringify(stored)) return;

  await writeBookFile(root, DERIVED_PATH, `${JSON.stringify(stored)}\n`);
}

/** The stored derived data; `null` when missing, unreadable, or written by another schema or version. */
export async function readDerived(root: string, version: string): Promise<StoredDerived | null> {
  const stored = await readJson<StoredDerived>(path.join(root, ...DERIVED_PATH.split("/")));

  if (
    stored === null ||
    stored.schemaVersion !== DERIVED_SCHEMA_VERSION ||
    stored.grimoireVersion !== version ||
    typeof stored.builtAt !== "string" ||
    typeof stored.inputs !== "object" ||
    stored.inputs === null ||
    typeof stored.snapshot !== "object" ||
    stored.snapshot === null
  ) {
    return null;
  }

  return stored;
}
