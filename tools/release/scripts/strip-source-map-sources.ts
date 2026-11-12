import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Check, before a built package is packed, that every source map of a code
 * file carries its original sources, and refuse to pack one that does not.
 *
 * The maps are packed exactly as the builder wrote them: nothing is removed.
 * Each `sources` entry names a file in the framework's own repository (for
 * example `../../../../packages/web/src/metadata.ts`), which does not exist in
 * an installed app. A dev server that loads a package file reads its map and,
 * for every source without an embedded `sourcesContent` entry, resolves the
 * source path and reads that file; a path outside the package, or a file that
 * is missing, logs a warning for every module. With `sourcesContent` embedded
 * nothing is looked up, so the maps stay quiet and stack traces keep their
 * file names and lines.
 *
 * A source needs no embedded content when it is empty, a URL, a virtual id,
 * or a file that exists inside the package. Declaration maps (`.d.ts.map`,
 * `.d.mts.map`, `.d.cts.map`) are only read by editors and are not checked.
 * A JSON value that is not a source map with `version` and `mappings` is
 * ignored, the same way a dev server ignores it.
 *
 * A missing directory is not an error (nothing to check). Returns the number
 * of code source maps checked.
 */
export async function assertSourceMapsSelfContained(directory: string): Promise<number> {
  let entries;

  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  const packageRoot = path.resolve(directory);
  const incomplete: string[] = [];
  let checked = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".map") || DECLARATION_MAP.test(entry.name))
      continue;

    const file = path.join(entry.parentPath, entry.name);
    const relativeFile = path.relative(packageRoot, file);
    let map: unknown;

    try {
      map = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw new Error(
        `Cannot pack source map ${file}: it is not valid JSON. Rebuild the package, or remove the file if it is not a source map.`,
      );
    }

    if (!isSourceMap(map)) continue;

    checked++;

    if (!Array.isArray(map.sources)) {
      incomplete.push(`${relativeFile} (no "sources" list)`);
      continue;
    }

    const missing = await sourcesWithoutContent(map, map.sources, path.dirname(file), packageRoot);

    if (missing.length > 0) incomplete.push(`${relativeFile} (${missing.join(", ")})`);
  }

  if (incomplete.length > 0) {
    const listed = incomplete.slice(0, 5).map((line) => `  - ${line}`);
    const more = incomplete.length > 5 ? [`  - and ${incomplete.length - 5} more`] : [];

    throw new Error(
      [
        `Cannot pack ${packageRoot}: ${incomplete.length} source map(s) name source files that are not in the package and do not embed their content, so every app's dev server would warn about each one:`,
        ...listed,
        ...more,
        'Keep "sourcesContent" in the built source maps (do not strip it before packing), or ship the named source files inside the package.',
      ].join("\n"),
    );
  }

  return checked;
}

const DECLARATION_MAP = /\.d\.[cm]?ts\.map$/;
const EXTERNAL_URL = /^([a-z]+:)?\/\//;
const VIRTUAL_SOURCE = /^(?:dep:|browser-external:|virtual:)|\0/;

type SourceMapShape = {
  version: unknown;
  mappings: unknown;
  sources?: unknown;
  sourceRoot?: unknown;
  sourcesContent?: unknown;
};

function isSourceMap(value: unknown): value is SourceMapShape {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "version" in value &&
    "mappings" in value &&
    Boolean((value as { mappings: unknown }).mappings)
  );
}

/**
 * The `sources` entries of one map that a dev server would have to read from
 * disk and could not find inside the package.
 */
async function sourcesWithoutContent(
  map: SourceMapShape,
  sources: unknown[],
  mapDirectory: string,
  packageRoot: string,
): Promise<string[]> {
  const sourceRoot = typeof map.sourceRoot === "string" ? map.sourceRoot : "";

  if (sourceRoot && EXTERNAL_URL.test(sourceRoot)) return [];

  const contents = Array.isArray(map.sourcesContent) ? (map.sourcesContent as unknown[]) : [];
  const missing: string[] = [];

  for (const [index, source] of sources.entries()) {
    if (contents[index] != null) continue;
    if (
      typeof source !== "string" ||
      !source ||
      EXTERNAL_URL.test(source) ||
      VIRTUAL_SOURCE.test(source)
    )
      continue;

    const resolved = path.resolve(mapDirectory, sourceRoot, decodeSourcePath(source));
    const inside = resolved.startsWith(packageRoot + path.sep);

    if (!inside || !(await isFile(resolved))) missing.push(source);
  }

  return missing;
}

function decodeSourcePath(source: string): string {
  const withoutQuery = source.replace(/[?#].*$/s, "");

  try {
    return decodeURI(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
