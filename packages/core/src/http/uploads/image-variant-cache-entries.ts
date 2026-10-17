import fs from "node:fs/promises";
import path from "node:path";

const SHARD = /^[a-f0-9]{2}$/;
const SOURCE = /^[a-f0-9]{64}$/;
const GENERATION = /^(?:\d+--?\d+|[a-f0-9]{64})$/;
const DERIVATIVE = /^[a-f0-9]{64}\.(?:jpg|png|webp|avif)$/;
const TEMPORARY =
  /^(?:[a-f0-9]{64}\.(?:jpg|png|webp|avif)\.tmp-[a-f0-9]{16}|\.source\.json\.[a-f0-9]{12}\.tmp)$/;

type VariantCacheEntry = {
  target: string;
  type: "derivative" | "manifest" | "temporary";
};

async function entries(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Recognize only files emitted by the image writers; never traverse symlinks. */
export async function* variantSourceCacheEntries(
  sourceDirectory: string,
): AsyncGenerator<VariantCacheEntry> {
  try {
    if (!(await fs.lstat(sourceDirectory)).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const generation of await entries(sourceDirectory)) {
    if (!generation.isDirectory() || !GENERATION.test(generation.name)) continue;
    const directory = path.join(sourceDirectory, generation.name);
    for (const file of await entries(directory)) {
      if (!file.isFile()) continue;
      const type = DERIVATIVE.test(file.name)
        ? "derivative"
        : file.name === "source.json"
          ? "manifest"
          : TEMPORARY.test(file.name)
            ? "temporary"
            : undefined;
      if (type) yield { target: path.join(directory, file.name), type };
    }
  }
}

/** Every directory component must match the generated cache layout. */
export async function* variantCacheEntries(
  cacheDirectory: string,
): AsyncGenerator<VariantCacheEntry> {
  for (const shard of await entries(cacheDirectory)) {
    if (!shard.isDirectory() || !SHARD.test(shard.name)) continue;
    const directory = path.join(cacheDirectory, shard.name);
    for (const source of await entries(directory)) {
      if (!source.isDirectory() || !SOURCE.test(source.name) || !source.name.startsWith(shard.name))
        continue;
      yield* variantSourceCacheEntries(path.join(directory, source.name));
    }
  }
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
