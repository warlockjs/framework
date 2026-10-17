import { log } from "@warlock.js/logger";
import fs from "node:fs/promises";
import type { ResolvedImageVariantsConfig } from "./image-variant-types";
import { variantCacheGenerations } from "./image-variant-cache-entries";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * A writer's temporary file older than this is an orphan left by a crashed
 * write and is removed by the sweep. Younger ones are never touched: a writer
 * may still be renaming them into place.
 */
export const ORPHAN_TEMP_AGE_MS = 60 * 60_000;

/**
 * A generation directory left without derivatives is removed only when it
 * was last changed longer ago than this, so a directory a writer has just
 * created for its first derivative survives. The writers also retry once when
 * their directory vanishes between `mkdir` and the rename.
 */
export const EMPTY_GENERATION_GRACE_MS = 5 * 60_000;

type CacheState = {
  sweep?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  /** When the last scheduled check ran, whether or not it walked the cache. */
  lastSweep: number;
  /** When the cache was last walked. */
  lastWalk: number;
  bytes: number;
  sizes: Map<string, number>;
  keep: Set<string>;
  /** True once a walk has reconciled `bytes` with the disk. */
  reconciled: boolean;
  /** The oldest retained derivative's mtime; undefined when none is known. */
  oldestMtimeMs?: number;
};
const caches = new Map<string, CacheState>();
function cacheState(directory: string): CacheState {
  let state = caches.get(directory);
  if (!state) {
    state = {
      lastSweep: 0,
      lastWalk: 0,
      bytes: 0,
      sizes: new Map(),
      keep: new Set(),
      reconciled: false,
    };
    caches.set(directory, state);
  }
  return state;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Age is measured from generation; hits do not extend a derivative's life. */
export async function freshImageVariant(target: string, maxAgeSeconds: number): Promise<boolean> {
  try {
    const stats = await fs.stat(target);
    return stats.isFile() && Date.now() - stats.mtimeMs < maxAgeSeconds * 1000;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

/**
 * Whether a scheduled check must walk the cache. It may skip only when a walk
 * has already reconciled the byte estimate, the cache is within its byte
 * budget, nothing retained has expired (new writes are always younger than
 * the oldest retained derivative), and a walk ran within the last
 * `maxCacheAge`, which also bounds how long an orphaned temporary can linger.
 */
function sweepIsDue(state: CacheState, images: ResolvedImageVariantsConfig): boolean {
  const maxAgeMs = images.maxCacheAge * 1000;
  const now = Date.now();
  return (
    !state.reconciled ||
    state.bytes > images.maxCacheBytes ||
    (state.oldestMtimeMs !== undefined && state.oldestMtimeMs <= now - maxAgeMs) ||
    now - state.lastWalk >= maxAgeMs
  );
}

/**
 * Schedule housekeeping only after a write. Hits do no cache-directory I/O.
 * Writes update a running byte estimate; at most one background check per
 * minute walks the cache, and only when it may have something to reclaim
 * (see {@link sweepIsDue}).
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
      state.oldestMtimeMs = Math.min(state.oldestMtimeMs ?? stats.mtimeMs, stats.mtimeMs);
      if (state.timer) return;
      const delay = Math.max(0, state.lastSweep + SWEEP_INTERVAL_MS - Date.now());
      state.timer = setTimeout(() => {
        state.timer = undefined;
        if (!sweepIsDue(state, images)) {
          state.lastSweep = Date.now();
          return;
        }
        void trimImageVariantCache(images, target).catch((error: unknown) => {
          log.warn("uploads", "image-variants", error);
        });
      }, delay);
      state.timer.unref();
    })
    .catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") log.warn("uploads", "image-variants", error);
    });
}

type Derivative = { target: string; size: number; mtimeMs: number; generation: Generation };
type Generation = {
  directory: string;
  /** The directory's mtime before this sweep removed anything from it. */
  mtimeMs: number;
  derivatives: number;
  manifest?: string;
};

/** Remove a temporary only when it is a regular file older than {@link ORPHAN_TEMP_AGE_MS}. */
async function removeOrphanTemporary(target: string): Promise<void> {
  try {
    const stats = await fs.lstat(target);
    if (stats.isFile() && Date.now() - stats.mtimeMs > ORPHAN_TEMP_AGE_MS) {
      await fs.rm(target, { force: true });
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/**
 * Remove a generation left without derivatives: its manifest, then the
 * directory itself with a non-recursive `rmdir`, so anything a writer has put
 * there since the walk keeps the directory in place.
 */
async function removeEmptyGeneration(generation: Generation): Promise<void> {
  if (generation.derivatives > 0) return;
  if (Date.now() - generation.mtimeMs <= EMPTY_GENERATION_GRACE_MS) return;
  if (generation.manifest) await fs.rm(generation.manifest, { force: true });
  try {
    if (!(await fs.lstat(generation.directory)).isDirectory()) return;
    await fs.rmdir(generation.directory);
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
  }
}

/**
 * Join an in-flight sweep rather than queueing another walk. Retain the file
 * about to be served, even if it alone exceeds the byte budget. Only paths in
 * the generated cache layout are touched and symlinks are never followed:
 * expired and oldest derivatives are evicted, writer temporaries older than
 * {@link ORPHAN_TEMP_AGE_MS} are removed, and a generation directory left
 * without derivatives loses its manifest and the directory itself once it is
 * older than {@link EMPTY_GENERATION_GRACE_MS}. The cache root, shard and
 * source directories, user folders and unrelated files stay in place.
 */
export async function trimImageVariantCache(
  images: ResolvedImageVariantsConfig,
  keep: string,
): Promise<void> {
  const state = cacheState(images.cacheDirectory);
  state.keep.add(keep);
  if (state.sweep) return state.sweep;
  state.lastSweep = Date.now();
  state.lastWalk = state.lastSweep;
  const sweep = (async () => {
    const files: Derivative[] = [];
    const generations: Generation[] = [];
    for await (const found of variantCacheGenerations(images.cacheDirectory)) {
      let mtimeMs: number;
      try {
        mtimeMs = (await fs.lstat(found.directory)).mtimeMs;
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        throw error;
      }
      const generation: Generation = { directory: found.directory, mtimeMs, derivatives: 0 };
      generations.push(generation);
      for (const entry of found.entries) {
        if (entry.type === "manifest") {
          generation.manifest = entry.target;
        } else if (entry.type === "temporary") {
          await removeOrphanTemporary(entry.target);
        } else {
          try {
            const stats = await fs.stat(entry.target);
            files.push({
              target: entry.target,
              size: stats.size,
              mtimeMs: stats.mtimeMs,
              generation,
            });
            generation.derivatives += 1;
          } catch (error) {
            if (errorCode(error) !== "ENOENT") throw error;
          }
        }
      }
    }
    state.sizes = new Map(files.map((file) => [file.target, file.size]));
    state.bytes = files.reduce((sum, file) => sum + file.size, 0);
    const cutoff = Date.now() - images.maxCacheAge * 1000;
    let oldestMtimeMs: number | undefined;
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (
        !state.keep.has(file.target) &&
        (file.mtimeMs <= cutoff || state.bytes > images.maxCacheBytes)
      ) {
        await fs.rm(file.target, { force: true });
        state.bytes -= file.size;
        state.sizes.delete(file.target);
        file.generation.derivatives -= 1;
        continue;
      }
      oldestMtimeMs = Math.min(oldestMtimeMs ?? file.mtimeMs, file.mtimeMs);
    }
    for (const generation of generations) await removeEmptyGeneration(generation);
    state.oldestMtimeMs = oldestMtimeMs;
    state.reconciled = true;
  })();
  state.sweep = sweep;
  try {
    await sweep;
  } finally {
    state.sweep = undefined;
    state.keep.clear();
  }
}
