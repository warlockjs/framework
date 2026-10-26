/**
 * Release-summary gate.
 *
 * `@warlock.js/core` ships every family release summary
 * (`releases/<version>-summary.md`) so `warlock release-notes` can answer offline.
 * A release without its own summary would ship a command that cannot describe the
 * version it was installed with, so the runner refuses to publish one.
 *
 * Two files must exist: the summary at the repository root, where it is written,
 * and its copy in `packages/core/releases/`, which `scripts/sync-release-notes.mjs`
 * keeps in step and the core package publishes.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** The monorepo root (tools/release/scripts -> ../../..). */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export interface ReleaseSummaryPaths {
  /** `releases/<version>-summary.md` at the repository root. */
  source: string;
  /** `packages/core/releases/<version>-summary.md`, the copy the package ships. */
  packaged: string;
}

export function releaseSummaryPaths(
  version: string,
  repoRoot: string = REPO_ROOT,
): ReleaseSummaryPaths {
  const file = `${version}-summary.md`;
  return {
    source: path.join(repoRoot, "releases", file),
    packaged: path.join(repoRoot, "packages", "core", "releases", file),
  };
}

/** Throw a clear refusal naming every summary file that is missing for `version`. */
export async function assertReleaseSummaryExists(
  version: string,
  options: {
    repoRoot?: string;
    fileExists?: (filePath: string) => boolean | Promise<boolean>;
  } = {},
): Promise<void> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const fileExists = options.fileExists ?? existsSync;
  const paths = releaseSummaryPaths(version, repoRoot);
  const missing: string[] = [];

  for (const filePath of [paths.source, paths.packaged]) {
    if (!(await fileExists(filePath))) {
      missing.push(path.relative(repoRoot, filePath).split(path.sep).join("/"));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Refusing to release ${version}: its release summary is missing.`,
        ...missing.map((file) => `  - ${file}`),
        `Write releases/${version}-summary.md, then run: node scripts/sync-release-notes.mjs`,
      ].join("\n"),
    );
  }
}
