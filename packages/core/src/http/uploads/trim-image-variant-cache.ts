import { log } from "@warlock.js/logger";
import fs from "node:fs/promises";
import type { ResolvedImageVariantsConfig } from "./image-variant-types";
import { variantCacheEntries } from "./image-variant-cache-entries";

const SWEEP_INTERVAL_MS = 60_000;
type CacheState = {
  sweep?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  lastSweep: number;
  bytes: number;
  sizes: Map<string, number>;
  keep: Set<string>;
};
const caches = new Map<string, CacheState>();
function cacheState(directory: string): CacheState {
  let state = caches.get(directory);
  if (!state) {
    state = { lastSweep: 0, bytes: 0, sizes: new Map(), keep: new Set() };
    caches.set(directory, state);
  }
  return state;
}

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
 * Schedule housekeeping only after a write. Hits do no cache-directory I/O.
 * Writes update a running byte estimate; one background sweep per minute
 * reconciles that estimate with disk and reclaims expired/oldest derivatives.
 */
export function scheduleImageVariantCacheTrim(
  images: ResolvedImageVariantsConfig,
  target: string,
): void {
  const state = cacheState(images.cacheDirectory);
  void fs
    .stat(target)
    .then((stats) => {
      state.bytes += stats.size - (state.sizes.get(target) ?? 0);
      state.sizes.set(target, stats.size);
      if (state.timer) return;
      const delay = Math.max(0, state.lastSweep + SWEEP_INTERVAL_MS - Date.now());
      state.timer = setTimeout(() => {
        state.timer = undefined;
        void trimImageVariantCache(images, target).catch((error: unknown) => {
          log.warn("uploads", "image-variants", error);
        });
      }, delay);
      state.timer.unref();
    })
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        log.warn("uploads", "image-variants", error);
    });
}

/**
 * Join an in-flight sweep rather than queueing another walk. Retain the file
 * about to be served, even if it alone exceeds the byte budget. Only known
 * derivative-shaped paths are touched; symlinks are never followed. Empty
 * directories stay in place so trimming cannot race a generator's mkdir/save.
 */
export async function trimImageVariantCache(
  images: ResolvedImageVariantsConfig,
  keep: string,
): Promise<void> {
  const state = cacheState(images.cacheDirectory);
  state.keep.add(keep);
  if (state.sweep) return state.sweep;
  state.lastSweep = Date.now();
  const sweep = (async () => {
    const files: { target: string; size: number; mtimeMs: number }[] = [];
    for await (const entry of variantCacheEntries(images.cacheDirectory)) {
      if (entry.type !== "derivative") continue;
      try {
        const stats = await fs.stat(entry.target);
        files.push({ target: entry.target, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    state.sizes = new Map(files.map((file) => [file.target, file.size]));
    state.bytes = files.reduce((sum, file) => sum + file.size, 0);
    const cutoff = Date.now() - images.maxCacheAge * 1000;
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (state.keep.has(file.target)) continue;
      if (file.mtimeMs <= cutoff || state.bytes > images.maxCacheBytes) {
        await fs.rm(file.target, { force: true });
        state.bytes -= file.size;
        state.sizes.delete(file.target);
      }
    }
  })();
  state.sweep = sweep;
  try {
    await sweep;
  } finally {
    state.sweep = undefined;
    state.keep.clear();
  }
}
