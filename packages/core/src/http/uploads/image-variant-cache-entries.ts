import fs from "node:fs/promises";
import path from "node:path";

const SHARD = /^[a-f0-9]{2}$/;
const SOURCE = /^[a-f0-9]{64}$/;
const GENERATION = /^(?:\d+--?\d+|[a-f0-9]{64})$/;
const DERIVATIVE = /^[a-f0-9]{64}\.(?:jpg|png|webp|avif)$/;
const TEMPORARY =
  /^(?:[a-f0-9]{64}\.(?:jpg|png|webp|avif)\.tmp-[a-f0-9]{16}|\.t-[a-f0-9]{16}\.tmp|\.source\.json\.[a-f0-9]{12}\.tmp)$/;

export type VariantCacheEntry = {
  target: string;
  type: "derivative" | "manifest" | "temporary";
};

/** One generation-shaped directory (a real directory, never a symlink) and its recognized files. */
export type VariantCacheGeneration = {
  directory: string;
  entries: VariantCacheEntry[];
};

async function entries(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Recognize only generation directories and files emitted by the image writers; never traverse symlinks. */
export async function* variantSourceCacheGenerations(
  sourceDirectory: string,
  keepGeneration?: string,
): AsyncGenerator<VariantCacheGeneration> {
  try {
    // Checking the final component alone still follows a symlinked shard.
    for (const directory of [path.dirname(sourceDirectory), sourceDirectory]) {
      if (!(await fs.lstat(directory)).isDirectory()) return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const generation of await entries(sourceDirectory)) {
    if (
      generation.name === keepGeneration ||
      !generation.isDirectory() ||
      !GENERATION.test(generation.name)
    )
      continue;
    const directory = path.join(sourceDirectory, generation.name);
    const found: VariantCacheEntry[] = [];
    for (const file of await entries(directory)) {
      if (!file.isFile()) continue;
      const type = DERIVATIVE.test(file.name)
        ? "derivative"
        : file.name === "source.json"
          ? "manifest"
          : TEMPORARY.test(file.name)
            ? "temporary"
            : undefined;
      if (type) found.push({ target: path.join(directory, file.name), type });
    }
    yield { directory, entries: found };
  }
}

/** Every directory component must match the generated cache layout. */
export async function* variantCacheGenerations(
  cacheDirectory: string,
): AsyncGenerator<VariantCacheGeneration> {
  for (const shard of await entries(cacheDirectory)) {
    if (!shard.isDirectory() || !SHARD.test(shard.name)) continue;
    const directory = path.join(cacheDirectory, shard.name);
    for (const source of await entries(directory)) {
      if (!source.isDirectory() || !SOURCE.test(source.name) || !source.name.startsWith(shard.name))
        continue;
      yield* variantSourceCacheGenerations(path.join(directory, source.name));
    }
  }
}

async function* flatten(
  generations: AsyncIterable<VariantCacheGeneration>,
): AsyncGenerator<VariantCacheEntry> {
  for await (const generation of generations) yield* generation.entries;
}

/** Recognized files of one source's generations, optionally skipping the `keepGeneration` directory. */
export function variantSourceCacheEntries(
  sourceDirectory: string,
  keepGeneration?: string,
): AsyncGenerator<VariantCacheEntry> {
  return flatten(variantSourceCacheGenerations(sourceDirectory, keepGeneration));
}

/** Recognized files of every source in the cache. */
export function variantCacheEntries(cacheDirectory: string): AsyncGenerator<VariantCacheEntry> {
  return flatten(variantCacheGenerations(cacheDirectory));
}

/** Keep directories in place so removing cache data cannot remove user folders. */
export async function purgeVariantCacheEntries(
  entries: AsyncIterable<VariantCacheEntry>,
): Promise<boolean> {
  let removed = false;
  for await (const entry of entries) {
    await fs.rm(entry.target, { force: true });
    removed = true;
  }
  return removed;
}
