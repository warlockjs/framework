import { appendFileSync } from "node:fs";

/**
 * Golden-fixture recorder for the Phase B resolver work.
 *
 * When `WARLOCK_RESOLVE_CAPTURE` points at a file path, every resolution
 * the *current* (tsx-backed) hook performs is appended there as one JSON
 * object per line: `{ specifier, parentURL, url, format }`, all with the
 * `?v=N` HMR token stripped so the record is stable across runs.
 *
 * A full `yarn start` boot then yields the real import graph's resolutions
 * — tsconfig paths, workspace `@warlock.js/*`, relative/extensionless,
 * package `exports`, bare npm, `node:` builtins — as the ground truth the
 * replacement resolver must reproduce exactly.
 *
 * Disabled (the default) it is a single env-var read and an immediate
 * return: no measurable cost on the resolve hot path.
 */

const VERSION_QUERY = /\?v=\d+$/;

let resolvedPath: string | null | undefined;

function targetFile(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  resolvedPath = process.env.WARLOCK_RESOLVE_CAPTURE || null;
  return resolvedPath;
}

export type ResolutionRecord = {
  specifier: string;
  parentURL: string | undefined;
  url: string;
  format: string | undefined;
};

export function captureResolution(record: ResolutionRecord): void {
  const file = targetFile();
  if (!file) return;

  const line =
    JSON.stringify({
      specifier: record.specifier,
      parentURL: record.parentURL?.replace(VERSION_QUERY, ""),
      url: record.url.replace(VERSION_QUERY, ""),
      format: record.format,
    }) + "\n";

  try {
    appendFileSync(file, line);
  } catch {
    // Capture is a diagnostic aid — never let it break resolution.
  }
}
