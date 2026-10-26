#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Keeps `packages/core/releases/` an exact copy of the repository's `releases/`.
 *
 * The family release summaries live at the repository root, where they are written.
 * `@warlock.js/core` ships them so `warlock release-notes` can read them offline. The
 * pkgist `clone` list only copies paths inside a package root, so the published copy
 * lives in the package and this script keeps it in step. The release runner runs
 * `sync` before it checks the working tree, so a stale copy shows up as an
 * uncommitted change and refuses the release.
 */

const SUMMARY_FILE = /^\d+\.\d+\.\d+-summary\.md$/;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function summaries(directory) {
  return existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => SUMMARY_FILE.test(name))
        .sort()
    : [];
}

/** Names that differ between the two folders, as `missing`, `stale` and `extra`. */
export function compareReleaseNotes(repositoryRoot = repoRoot) {
  const source = path.join(repositoryRoot, "releases");
  const target = path.join(repositoryRoot, "packages", "core", "releases");
  const sourceNames = summaries(source);
  const targetNames = summaries(target);
  return {
    missing: sourceNames.filter((name) => !targetNames.includes(name)),
    stale: sourceNames.filter(
      (name) =>
        targetNames.includes(name) &&
        !readFileSync(path.join(source, name)).equals(readFileSync(path.join(target, name))),
    ),
    extra: targetNames.filter((name) => !sourceNames.includes(name)),
  };
}

/** Copy every root summary into the core package and drop copies with no source. */
export function syncReleaseNotes(repositoryRoot = repoRoot) {
  const source = path.join(repositoryRoot, "releases");
  const target = path.join(repositoryRoot, "packages", "core", "releases");
  mkdirSync(target, { recursive: true });
  const { missing, stale, extra } = compareReleaseNotes(repositoryRoot);
  for (const name of [...missing, ...stale])
    copyFileSync(path.join(source, name), path.join(target, name));
  for (const name of extra) rmSync(path.join(target, name));
  return { missing, stale, extra };
}

export function assertReleaseNotesInSync(repositoryRoot = repoRoot) {
  const { missing, stale, extra } = compareReleaseNotes(repositoryRoot);
  const problems = [
    ...missing.map((name) => `${name}: missing from packages/core/releases`),
    ...stale.map((name) => `${name}: differs from the copy in packages/core/releases`),
    ...extra.map((name) => `${name}: in packages/core/releases but not in releases`),
  ];
  if (problems.length) {
    throw new Error(
      `packages/core/releases is out of sync with releases:\n${problems.join("\n")}\nRun: node scripts/sync-release-notes.mjs`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.includes("--check")) {
      assertReleaseNotesInSync();
      console.log("Release notes: packages/core/releases matches releases.");
    } else {
      const result = syncReleaseNotes();
      console.log(
        `Release notes synced: ${result.missing.length} added, ${result.stale.length} updated, ${result.extra.length} removed.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
