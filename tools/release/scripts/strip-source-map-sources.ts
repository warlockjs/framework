import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Remove `sourcesContent` from every source map in a built package before it
 * is packed.
 *
 * The builder embeds each module's whole TypeScript source in its `.map`
 * file, which roughly doubled the size of the largest packages. Stack traces
 * (`node --enable-source-maps`, which `warlock start` uses) only need the
 * `sources` paths and the `mappings`, and both are kept, so every mapped
 * file name and line number stays the same.
 *
 * A missing directory is not an error (nothing to strip). Returns the number
 * of map files rewritten.
 */
export async function stripSourceMapSources(directory: string): Promise<number> {
  let entries;

  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  let rewritten = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".map")) continue;

    const file = path.join(entry.parentPath, entry.name);
    const raw = await readFile(file, "utf8");
    let map: unknown;

    try {
      map = JSON.parse(raw);
    } catch {
      throw new Error(`Cannot strip source map ${file}: it is not valid JSON.`);
    }

    if (typeof map !== "object" || map === null || !("sourcesContent" in map)) continue;

    delete (map as { sourcesContent?: unknown }).sourcesContent;
    await writeFile(file, JSON.stringify(map));
    rewritten++;
  }

  return rewritten;
}
