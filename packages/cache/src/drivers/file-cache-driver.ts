import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  atomicWriteJsonAsync,
  ensureDirectoryAsync,
  getJsonFileAsync,
  listDirectoriesAsync,
  removeDirectoryAsync,
} from "@warlock.js/fs";
import path from "path";
import type {
  CacheData,
  CacheDriver,
  CacheKey,
  CacheSetOptions,
  CacheSetResult,
  CacheTtl,
  FileCacheOptions,
} from "../types";
import { CacheConfigurationError, CacheError, CacheUnsupportedError } from "../types";
import { BaseCacheDriver } from "./base-cache-driver";

/**
 * How many times an exclusive write (or a compare-and-delete) retries while
 * another caller is removing the same entry.
 */
const EXCLUSIVE_ATTEMPTS = 50;

/**
 * A removal guard older than this belongs to a process that died while
 * holding it (the guarded step takes a few milliseconds).
 */
const STALE_GUARD_MS = 10_000;

export class FileCacheDriver
  extends BaseCacheDriver<FileCacheDriver, FileCacheOptions>
  implements CacheDriver<FileCacheDriver, FileCacheOptions>
{
  /**
   * {@inheritdoc}
   */
  public name = "file";

  /**
   * {@inheritdoc}
   */
  public setOptions(options: FileCacheOptions) {
    if (!options.directory) {
      throw new CacheConfigurationError(
        "File driver requires 'directory' option to be configured.",
      );
    }

    return super.setOptions(options);
  }

  /**
   * Get the cache directory
   */
  public get directory() {
    const directory = this.options.directory;

    if (typeof directory === "function") {
      return directory();
    }

    throw new CacheConfigurationError(
      "Cache directory is not defined, please define it in the file driver options",
    );
  }

  /**
   * Get file name
   */
  public get fileName() {
    const fileName = this.options.fileName;

    if (typeof fileName === "function") {
      return fileName();
    }

    return "cache.json";
  }

  /**
   * Map a parsed cache key (or namespace) to its on-disk directory.
   *
   * The key must become exactly one directory component: `%` and the path
   * separators are percent-encoded so a hostile key (`../../etc`,
   * `..\\..\\evil`) turns into an inert directory name instead of a path
   * traversal, while distinct keys can never collide after encoding. Dots are
   * left untouched — the `.`-delimited namespace scheme is purely logical and
   * only ever produces a single filesystem component here.
   */
  protected keyDirectory(parsedKey: string): string {
    // An empty key would resolve to the cache root — `remove("{}")` must never
    // be able to wipe it.
    if (parsedKey === "") {
      throw new CacheConfigurationError("Cache key must not be empty.");
    }

    return this.containedPath(this.encodeKeySegment(parsedKey));
  }

  /**
   * Percent-encode a parsed key into an inert, single-component directory
   * name. Dots are left untouched — see {@link keyDirectory}.
   */
  protected encodeKeySegment(parsedKey: string): string {
    return parsedKey.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/\\/g, "%5C");
  }

  /**
   * Reverse of {@link encodeKeySegment} — recovers the logical, dot-delimited
   * parsed key from an on-disk directory name. Used by {@link removeNamespace}
   * to test which sibling directories logically belong to a namespace, since
   * dotted keys (`ns.a`) are stored as sibling directories rather than nested
   * ones (see {@link keyDirectory}'s doc comment).
   */
  protected decodeKeySegment(encoded: string): string {
    return encoded.replace(/%2F/g, "/").replace(/%5C/g, "\\").replace(/%25/g, "%");
  }

  /**
   * Resolve `segment` against the cache root and throw when the result lands
   * outside it — the last line of defense against path traversal, independent
   * of how the key was encoded.
   */
  protected containedPath(segment: string): string {
    const base = path.resolve(this.directory);
    const resolved = path.resolve(base, segment);
    const relative = path.relative(base, resolved);

    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new CacheError(`Cache key resolves outside the cache directory: "${segment}"`);
    }

    return resolved;
  }

  /**
   * {@inheritdoc}
   *
   * Dotted keys (`ns.a`) are stored as sibling directories, not nested ones
   * (see {@link keyDirectory}) — a directory literally named `<namespace>`
   * rarely exists on its own. Namespace removal therefore has to scan the
   * cache root's immediate children and remove every directory whose
   * *logical* (decoded) name equals the namespace or starts with
   * `<namespace>.`, mirroring the `key = $1 OR key LIKE $2` boundary
   * semantics the `pg` driver already uses for the same contract.
   */
  public async removeNamespace(namespace: string) {
    const parsedNamespace = this.parseKey(namespace);

    this.log("clearing", namespace);

    try {
      const root = this.containedPath("");

      if (parsedNamespace === "") {
        await removeDirectoryAsync(root);
        this.log("cleared", namespace);
        return this;
      }

      const prefix = `${parsedNamespace}.`;
      const entries = await listDirectoriesAsync(root).catch(() => [] as string[]);

      await Promise.all(
        entries.map(async (entryPath) => {
          const decoded = this.decodeKeySegment(path.basename(entryPath));

          if (decoded === parsedNamespace || decoded.startsWith(prefix)) {
            await removeDirectoryAsync(entryPath);
          }
        }),
      );

      this.log("cleared", namespace);
    } catch (error) {
      //
    }

    return this;
  }

  /**
   * {@inheritdoc}
   *
   * `onConflict: "create"` is exclusive (temp file + hard link, so `lock()`
   * is safe across concurrent writers). `onConflict: "update"` is NOT atomic:
   * the existence probe and the write are separate steps.
   */
  public async set(
    key: CacheKey,
    value: any,
    ttlOrOptions?: CacheTtl | CacheSetOptions,
  ): Promise<any> {
    const parsedKey = this.parseKey(key);
    const { ttl, tags, onConflict, vector, staleAt } = this.resolveSetOptions(ttlOrOptions);

    if (vector) {
      throw new CacheUnsupportedError(
        "'file' driver does not support similarity retrieval — use a memory driver, 'pg' (with pgvector), or 'redis' (with RediSearch).",
      );
    }

    this.log("caching", parsedKey);

    const existing =
      onConflict === "upsert" || onConflict === "create" ? null : await this.get(key);
    const exists = existing !== null;

    if (onConflict === "update" && !exists) {
      const result: CacheSetResult = { wasSet: false, existing: null };
      return result;
    }

    const data = this.prepareDataForStorage(value, ttl, staleAt);

    const fileDirectory = this.keyDirectory(parsedKey);

    await ensureDirectoryAsync(fileDirectory);

    const filePath = path.resolve(fileDirectory, this.fileName);

    if (onConflict === "create") {
      const conflict = await this.writeExclusive(filePath, data);

      if (conflict) {
        const result: CacheSetResult = { wasSet: false, existing: conflict.existing };
        return result;
      }
    } else {
      await atomicWriteJsonAsync(filePath, data);
    }

    if (tags && tags.length > 0) {
      await this.applyTags(key, tags);
    }

    this.log("cached", parsedKey);

    await this.emit("set", { key: parsedKey, value, ttl });

    if (onConflict === "create" || onConflict === "update") {
      const result: CacheSetResult = { wasSet: true, existing: null };
      return result;
    }

    return this;
  }

  /**
   * Create `filePath` only if it does not exist. Writes a temp file, then
   * hard-links it to the target (EEXIST = already present). An existing but
   * expired entry is removed under the key's removal guard (see
   * {@link withRemovalGuard}), so of several contenders only one can ever
   * win the retried link.
   *
   * Returns `null` when written, or `{ existing }` on conflict.
   */
  protected async writeExclusive(
    filePath: string,
    data: CacheData,
  ): Promise<{ existing: any } | null> {
    const tempPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;

    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2));

      for (let attempt = 0; attempt < EXCLUSIVE_ATTEMPTS; attempt++) {
        try {
          await fs.promises.link(tempPath, filePath);
          return null;
        } catch (error: any) {
          if (error?.code !== "EEXIST") {
            throw error;
          }
        }

        const current = await this.readEntryFile(filePath);

        // Removed between the link and the read: try the link again.
        if (!current) continue;

        // Unreadable (corrupt) file: treat as held, never delete it.
        if (!current.entry) return { existing: null };

        if (!isExpiredEntry(current.entry)) {
          return { existing: current.entry.data ?? null };
        }

        const guarded = await this.withRemovalGuard(filePath, async () => {
          // Re-read inside the guard: only the expired file that was judged
          // is removed, never one written since.
          const latest = await this.readEntryFile(filePath);

          if (latest?.entry && latest.inode === current.inode && isExpiredEntry(latest.entry)) {
            await fs.promises.unlink(filePath).catch(ignoreMissing);
          }
        });

        // Another contender is removing it: give it a moment, then retry.
        if (!guarded) await delay(1);
      }

      return { existing: null };
    } finally {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
  }

  /**
   * Run `task` while holding the key's removal guard: a `<file>.guard` file
   * created exclusively. Entry files are only ever created by an exclusive
   * link onto a missing path, so while every removal of a live or expired
   * entry by `writeExclusive` / `deleteIfEquals` happens under this guard, no
   * removal can delete an entry another writer has just created.
   *
   * Returns `false` (without running `task`) when another caller holds the
   * guard. A guard left behind by a crashed process is cleared once it is
   * older than {@link STALE_GUARD_MS}.
   */
  protected async withRemovalGuard(filePath: string, task: () => Promise<void>): Promise<boolean> {
    const guardPath = `${filePath}.guard`;
    let handle: FileHandle;

    try {
      handle = await fs.promises.open(guardPath, "wx");
    } catch (error: any) {
      // The key directory is gone, so is the entry: nothing to remove.
      if (error?.code === "ENOENT") return true;

      if (error?.code !== "EEXIST") throw error;

      await this.clearStaleGuard(guardPath);

      return false;
    }

    try {
      await handle.close();
      await task();

      return true;
    } finally {
      await fs.promises.unlink(guardPath).catch(() => undefined);
    }
  }

  /**
   * Remove a removal guard whose holder died (older than {@link STALE_GUARD_MS}).
   */
  protected async clearStaleGuard(guardPath: string): Promise<void> {
    try {
      const { mtimeMs } = await fs.promises.stat(guardPath);

      if (Date.now() - mtimeMs > STALE_GUARD_MS) {
        await fs.promises.unlink(guardPath).catch(ignoreMissing);
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  /**
   * Read an entry file together with its inode, so a later step can tell
   * whether the file at the same path is still the one that was read.
   * `undefined` when the file does not exist; `entry: undefined` when it
   * cannot be parsed.
   */
  protected async readEntryFile(
    filePath: string,
  ): Promise<{ entry: CacheData | undefined; inode: number } | undefined> {
    let handle: FileHandle;

    try {
      handle = await fs.promises.open(filePath, "r");
    } catch (error: any) {
      if (error?.code === "ENOENT") return undefined;

      throw error;
    }

    try {
      const { ino } = await handle.stat();
      const text = await handle.readFile("utf-8");

      try {
        const entry = JSON.parse(text) as CacheData | null;

        return { entry: entry && typeof entry === "object" ? entry : undefined, inode: ino };
      } catch {
        return { entry: undefined, inode: ino };
      }
    } finally {
      await handle.close();
    }
  }

  /**
   * {@inheritdoc}
   *
   * Compare-and-delete under the key's removal guard, so a lock released just
   * as it expired never deletes a successor's lock.
   */
  protected async deleteIfEquals(key: CacheKey, expected: unknown): Promise<boolean> {
    const parsedKey = this.parseKey(key);
    const fileDirectory = this.keyDirectory(parsedKey);
    const filePath = path.resolve(fileDirectory, this.fileName);
    let deleted = false;

    for (let attempt = 0; attempt < EXCLUSIVE_ATTEMPTS; attempt++) {
      const guarded = await this.withRemovalGuard(filePath, async () => {
        const current = await this.readEntryFile(filePath);

        if (!current?.entry || isExpiredEntry(current.entry) || current.entry.data !== expected) {
          return;
        }

        await fs.promises.unlink(filePath).catch(ignoreMissing);
        deleted = true;
      });

      if (guarded) break;

      await delay(1);
    }

    if (!deleted) return false;

    // Drop the key directory when nothing else was written into it meanwhile.
    await fs.promises.rmdir(fileDirectory).catch(() => undefined);

    this.log("removed", parsedKey);
    await this.emit("removed", { key: parsedKey });

    return true;
  }

  /**
   * {@inheritdoc}
   *
   * File driver does not yet ship with a file-lock primitive, so concurrent
   * writers could clobber each other. Rather than ship an unsafe default, we
   * throw — consumers can fall back to memory/redis for `update` until a
   * proper file lock lands (tracked in `domains/cache/backlog.md`).
   */
  public async update(): Promise<never> {
    throw new CacheUnsupportedError(
      "`update()` is not supported on the file driver. Use the memory or redis driver, or wait for the file-lock primitive (see domains/cache/backlog.md).",
    );
  }

  /**
   * {@inheritdoc}
   */
  public async merge(): Promise<never> {
    throw new CacheUnsupportedError(
      "`merge()` is not supported on the file driver. Use the memory or redis driver.",
    );
  }

  /**
   * Read the raw {@link CacheData} wrapper from disk, including `staleAt`
   * metadata. Returns `null` for missing or expired files — `swr()`
   * consumes this to branch on freshness.
   */
  protected async getEntry(key: CacheKey): Promise<CacheData | null> {
    const parsedKey = this.parseKey(key);
    const fileDirectory = this.keyDirectory(parsedKey);

    try {
      const entry = (await getJsonFileAsync(path.resolve(fileDirectory, this.fileName))) as
        | CacheData
        | undefined;

      if (!entry) {
        return null;
      }

      // `Infinity` (no expiry) is written to JSON as `null`; `null <= now`
      // is true, so only a real deadline may count as expired.
      if (typeof entry.expiresAt === "number" && entry.expiresAt <= Date.now()) {
        return null;
      }

      return entry;
    } catch {
      return null;
    }
  }

  /**
   * {@inheritdoc}
   */
  public async get(key: CacheKey) {
    const parsedKey = this.parseKey(key);

    this.log("fetching", parsedKey);

    const fileDirectory = this.keyDirectory(parsedKey);

    let value: CacheData | undefined;

    try {
      value = (await getJsonFileAsync(path.resolve(fileDirectory, this.fileName))) as
        | CacheData
        | undefined;
    } catch {
      // Missing file (ENOENT) or corrupt JSON: a plain miss. Never remove the
      // directory here — it may be mid-write by another process.
      value = undefined;
    }

    if (value === undefined || value === null || typeof value !== "object") {
      this.log("notFound", parsedKey);
      await this.emit("miss", { key: parsedKey });
      return null;
    }

    // Only a successfully parsed but expired entry is removed (inside
    // parseCachedData). The value was just parsed from disk, so it is already
    // a private copy: no clone.
    const result = await this.parseCachedData(parsedKey, value, false);

    if (result === null) {
      await this.emit("miss", { key: parsedKey });
    } else {
      await this.emit("hit", { key: parsedKey, value: result });
    }

    return result;
  }

  /**
   * {@inheritdoc}
   */
  public async remove(key: CacheKey) {
    await this.removeParsed(this.parseKey(key));
  }

  /**
   * {@inheritdoc}
   */
  protected async removeParsed(parsedKey: string): Promise<void> {
    this.log("removing", parsedKey);

    const fileDirectory = this.keyDirectory(parsedKey);

    try {
      await removeDirectoryAsync(fileDirectory);

      this.log("removed", parsedKey);
      // Emit removed event
      await this.emit("removed", { key: parsedKey });
    } catch (error) {
      //
    }
  }

  /**
   * {@inheritdoc}
   */
  public async flush() {
    this.log("flushing");

    if (this.options.globalPrefix) {
      await this.removeNamespace("");
    } else {
      await removeDirectoryAsync(this.directory);
    }

    this.log("flushed");

    // Emit flushed event
    await this.emit("flushed");
  }

  /**
   * {@inheritdoc}
   */
  public async connect() {
    this.log("connecting");
    await ensureDirectoryAsync(this.directory);
    this.log("connected");
    await this.emit("connected");
  }
}

/**
 * Whether a stored entry is past its deadline. `Infinity` (no expiry) is
 * written to JSON as `null`, so only a real number can be expired.
 */
function isExpiredEntry(entry: CacheData): boolean {
  return typeof entry.expiresAt === "number" && entry.expiresAt <= Date.now();
}

function ignoreMissing(error: NodeJS.ErrnoException): void {
  if (error?.code !== "ENOENT") throw error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
