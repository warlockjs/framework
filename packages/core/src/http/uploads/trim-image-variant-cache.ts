import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedImageVariantsConfig } from "./image-variant-types";

const sweeps = new Map<string, Promise<void>>();

/** Age is measured from generation; hits do not extend a derivative's life. */
export async function freshImageVariant(target: string, maxAgeSeconds: number): Promise<boolean> {
  try {
    const stats = await fs.stat(target);
    return stats.isFile() && Date.now() - stats.mtimeMs < maxAgeSeconds * 1000;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Remove expired derivatives, then the oldest until the byte budget fits.
 * The file about to be served is retained, even if it alone exceeds the budget.
 * Only derivative-shaped paths are considered; symlinks are never followed.
 * Housekeeping is serialized per directory in this process.
 */
export async function trimImageVariantCache(
  images: ResolvedImageVariantsConfig,
  keep: string,
): Promise<void> {
  const previous = sweeps.get(images.cacheDirectory) ?? Promise.resolve();
  const sweep = previous
    .catch(() => {})
    .then(async () => {
      const files: { target: string; size: number; mtimeMs: number }[] = [];
      async function walk(directory: string, depth: number): Promise<void> {
        let entries;
        try {
          entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        for (const entry of entries) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory() && depth < 3) {
            await walk(target, depth + 1);
          } else if (
            entry.isFile() &&
            depth === 3 &&
            /^[a-f0-9]{64}\.(jpg|png|webp|avif)$/.test(entry.name)
          ) {
            try {
              const stats = await fs.stat(target);
              files.push({ target, size: stats.size, mtimeMs: stats.mtimeMs });
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          }
        }
        // Empty source/generation directories otherwise accumulate after eviction.
        if (depth > 0) {
          try {
            await fs.rmdir(directory);
          } catch (error) {
            if (
              !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            )
              throw error;
          }
        }
      }
      await walk(images.cacheDirectory, 0);
      let total = files.reduce((sum, file) => sum + file.size, 0);
      const cutoff = Date.now() - images.maxCacheAge * 1000;
      for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (file.target === keep) continue;
        if (file.mtimeMs <= cutoff || total > images.maxCacheBytes) {
          await fs.rm(file.target, { force: true });
          total -= file.size;
          let parent = path.dirname(file.target);
          while (parent !== images.cacheDirectory) {
            try {
              await fs.rmdir(parent);
            } catch (error) {
              if (
                !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
                  (error as NodeJS.ErrnoException).code ?? "",
                )
              )
                throw error;
              break;
            }
            parent = path.dirname(parent);
          }
        }
      }
    });
  sweeps.set(images.cacheDirectory, sweep);
  try {
    await sweep;
  } finally {
    if (sweeps.get(images.cacheDirectory) === sweep) sweeps.delete(images.cacheDirectory);
  }
}
