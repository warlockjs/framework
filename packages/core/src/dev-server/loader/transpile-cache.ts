/**
 * Persisted transpile cache.
 *
 * Keyed by a hash of *source content* plus a transform-options fingerprint.
 * Same source + same options → same key → same output, always. Changed
 * content → different key → fresh transpile. There is no path-keyed entry
 * anywhere, so the old "stack trace points at a mangled cache filename" bug
 * class is structurally impossible — the on-disk filename is opaque and the
 * source identity lives only inside the source map.
 *
 * This module is pure and hook-agnostic on purpose: it knows how to read,
 * write and evict cache entries given a key, nothing about the ESM loader,
 * `?v=N` versioning, or esbuild. Phase 2 wires it into the load hook.
 *
 * @example
 *   const fp = computeFingerprint({
 *     esbuildVersion: esbuild.version,
 *     cacheEpoch: CACHE_EPOCH,
 *     compilerOptions,
 *   });
 *   const key = cacheKey(sourceText, fp);
 *   const hit = cache.get(key);
 *   if (!hit) cache.put(key, { code, map });
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * A cached transpile result: the emitted JS and its source map (raw JSON
 * string, exactly as esbuild produced it). Either may be empty for code
 * that produced no map.
 */
export type TranspileEntry = {
  code: string;
  map: string;
};

/**
 * Inputs that change transpiled output for identical source text. Bumping
 * any of these must invalidate every entry — that is achieved structurally
 * by folding them into the key, not by sweeping the cache.
 */
export type FingerprintParts = {
  /** `esbuild.version` — a transform-engine upgrade can change output. */
  esbuildVersion: string;
  /**
   * Monotonic cache-format epoch owned by the framework. Bump it whenever
   * the cache contract (entry shape, map handling, key derivation) changes
   * so old entries are guaranteed to miss after a framework upgrade.
   */
  cacheEpoch: number;
  /**
   * The resolved tsconfig `compilerOptions` blob, hashed wholesale rather
   * than cherry-picking fields — safer against tsconfig drift (a new option
   * that affects output can't silently serve stale code).
   */
  compilerOptions: unknown;
};

/**
 * Current cache-format epoch. Bump on any change to {@link TranspileEntry}
 * shape, the storage layout, or how the loader consumes entries.
 */
export const CACHE_EPOCH = 1;

/**
 * Stable JSON stringify — object keys sorted recursively so semantically
 * equal option blobs always produce the same fingerprint regardless of key
 * insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(key => {
      const child = stableStringify((value as Record<string, unknown>)[key]);
      return `${JSON.stringify(key)}:${child}`;
    });

  return `{${entries.join(",")}}`;
}

/**
 * Fold every output-affecting input into one short hex fingerprint that
 * becomes part of every cache key.
 */
export function computeFingerprint(parts: FingerprintParts): string {
  const canonical = stableStringify({
    esbuildVersion: parts.esbuildVersion,
    cacheEpoch: parts.cacheEpoch,
    compilerOptions: parts.compilerOptions,
  });

  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Derive the cache key for a source file. The NUL separator makes
 * `sourceText` and `fingerprint` unambiguous (no concatenation collision).
 */
export function cacheKey(sourceText: string, fingerprint: string): string {
  return createHash("sha256")
    .update(sourceText)
    .update("\0")
    .update(fingerprint)
    .digest("hex");
}

/** Options for {@link TranspileCache.gc}. */
export type GcOptions = {
  /** Evict least-recently-modified entries once total size exceeds this. */
  maxBytes?: number;
  /** Evict entries whose mtime is older than this many milliseconds. */
  maxAgeMs?: number;
};

type CacheFileInfo = {
  codePath: string;
  mapPath: string;
  size: number;
  mtimeMs: number;
};

/**
 * Content-hash-addressed transpile cache stored on disk.
 *
 * Layout: `<cacheDir>/<first2-of-key>/<key>.js` plus a sibling `.js.map`.
 * Sharding by the first two hex chars keeps any single directory small on
 * large projects. GC metadata is derived from filesystem mtime so there is
 * no second source of truth (no sidecar index to keep consistent).
 */
export class TranspileCache {
  public constructor(private readonly cacheDir: string) {}

  private shardDir(key: string): string {
    return path.join(this.cacheDir, key.slice(0, 2));
  }

  /**
   * `label` is an optional human-readable prefix (e.g. a path slug). It is
   * cosmetic only — the content `key` is still what makes the name unique,
   * so the same `(key, label)` pair must be passed to `get` and `put`.
   */
  private fileName(key: string, label: string | undefined, ext: string): string {
    return label ? `${label}.${key}${ext}` : `${key}${ext}`;
  }

  private codePath(key: string, label?: string): string {
    return path.join(this.shardDir(key), this.fileName(key, label, ".js"));
  }

  private mapPath(key: string, label?: string): string {
    return path.join(this.shardDir(key), this.fileName(key, label, ".js.map"));
  }

  /**
   * Return the cached entry for `key`, or `null` on a miss. Synchronous on
   * purpose: this sits on the module-load hot path and must not pay an
   * event-loop hop per import.
   */
  public get(key: string, label?: string): TranspileEntry | null {
    try {
      const code = readFileSync(this.codePath(key, label), "utf8");
      let map = "";
      try {
        map = readFileSync(this.mapPath(key, label), "utf8");
      } catch {
        // A code entry with no map is valid (e.g. map-less transform).
      }
      return { code, map };
    } catch {
      return null;
    }
  }

  /**
   * Store an entry for `key`. Written atomically (temp file + rename) so a
   * concurrent {@link get} never observes a half-written module.
   */
  public put(key: string, entry: TranspileEntry, label?: string): void {
    const shard = this.shardDir(key);
    mkdirSync(shard, { recursive: true });

    this.atomicWrite(this.codePath(key, label), entry.code);
    if (entry.map) {
      this.atomicWrite(this.mapPath(key, label), entry.map);
    }
  }

  private atomicWrite(filePath: string, content: string): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tempPath, content);
      renameSync(tempPath, filePath);
    } catch (error) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // best effort — original error is the one that matters
      }
      throw error;
    }
  }

  /**
   * Opportunistic eviction. Cheap, runs at boot (not on the hot path).
   * Removes age-expired entries first, then trims to the size budget by
   * evicting least-recently-modified entries. Both bounds are optional;
   * with neither set this is a no-op.
   */
  public gc(options: GcOptions = {}): void {
    const { maxBytes, maxAgeMs } = options;
    if (maxBytes === undefined && maxAgeMs === undefined) return;

    const files = this.scan();
    const now = Date.now();

    let live = files;

    if (maxAgeMs !== undefined) {
      live = [];
      for (const file of files) {
        if (now - file.mtimeMs > maxAgeMs) {
          this.evict(file);
        } else {
          live.push(file);
        }
      }
    }

    if (maxBytes !== undefined) {
      let total = live.reduce((sum, file) => sum + file.size, 0);
      if (total > maxBytes) {
        // Oldest first — least-recently-modified is the eviction order.
        live.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const file of live) {
          if (total <= maxBytes) break;
          total -= file.size;
          this.evict(file);
        }
      }
    }
  }

  private scan(): CacheFileInfo[] {
    const result: CacheFileInfo[] = [];

    let shards: string[];
    try {
      shards = readdirSync(this.cacheDir);
    } catch {
      return result;
    }

    for (const shard of shards) {
      const shardPath = path.join(this.cacheDir, shard);
      let entries: string[];
      try {
        entries = readdirSync(shardPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith(".js")) continue;
        const codePath = path.join(shardPath, entry);
        try {
          const stat = statSync(codePath);
          const mapPath = `${codePath}.map`;
          let mapSize = 0;
          try {
            mapSize = statSync(mapPath).size;
          } catch {
            // no map sidecar — fine
          }
          result.push({
            codePath,
            mapPath,
            size: stat.size + mapSize,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // entry vanished mid-scan — skip
        }
      }
    }

    return result;
  }

  private evict(file: CacheFileInfo): void {
    try {
      rmSync(file.codePath, { force: true });
    } catch {
      // best effort
    }
    try {
      rmSync(file.mapPath, { force: true });
    } catch {
      // best effort
    }
  }

  /** Remove the entire cache directory (used by `--fresh`). */
  public clear(): void {
    try {
      rmSync(this.cacheDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}
