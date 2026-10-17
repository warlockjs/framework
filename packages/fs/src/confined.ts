import { constants, lstatSync, realpathSync, type BigIntStats, type Dirent } from "node:fs";
import { lstat, open, opendir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { FsLimitExceededError, FsLinkRefusedError, FsPathEscapeError } from "./confined-errors";
import { isPathInside, normalizeConfinedPath } from "./confined-path";
import type { StandardSchemaV1 } from "./facade/standard-schema";
import { validateAgainstSchema } from "./facade/standard-schema";

/** Default `maxFileBytes`: 16 MiB. */
export const CONFINED_DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Default `maxEntries` for `list` and `walk`. */
export const CONFINED_DEFAULT_MAX_ENTRIES = 100_000;
/** Default `maxDepth` for `walk`. */
export const CONFINED_DEFAULT_MAX_DEPTH = 64;

/** Options for {@link createConfinedReader} / `fs.confined`. */
export type ConfinedReaderOptions = {
  /**
   * Follow symbolic links (and Windows junctions) whose resolved target stays
   * inside the root. A link that resolves outside throws
   * {@link FsPathEscapeError} (`link-escape`). With `false` (the default), a
   * link anywhere in a path throws {@link FsLinkRefusedError}.
   *
   * @default false
   */
  followLinks?: boolean;
  /**
   * Accept a root that is itself a symbolic link; the reader is then confined
   * to the link's target. Links in the root's parent folders (macOS `/tmp`,
   * a deploy `current` link) are always accepted: the root is canonicalised
   * once, when the reader is created.
   *
   * @default false
   */
  allowSymlinkedRoot?: boolean;
  /**
   * Largest file `readText` / `readBuffer` / `readJson` return, in bytes.
   * Enforced while reading, so a file that grows after it was checked still
   * stops here. `Infinity` disables the bound.
   *
   * @default 16 MiB
   */
  maxFileBytes?: number;
  /**
   * Most entries one `list` call, or one whole `walk`, may read. `Infinity`
   * disables the bound.
   *
   * @default 100_000
   */
  maxEntries?: number;
  /**
   * Deepest directory level `walk` descends to; entries directly in the
   * starting folder are depth 1. `Infinity` disables the bound.
   *
   * @default 64
   */
  maxDepth?: number;
};

/**
 * An entry's own type, from `lstat` (a link is reported as `symlink`, never as
 * its target). `other` covers FIFOs, sockets and devices.
 */
export type ConfinedEntryType = "file" | "directory" | "symlink" | "other";

/** One entry returned by `list` or yielded by `walk`. */
export type ConfinedEntry = {
  /** Root-relative, `/`-separated path; pass it back to any reader method. */
  path: string;
  name: string;
  type: ConfinedEntryType;
  /** 1 for entries directly in the folder listed or walked, 2 below that, … */
  depth: number;
};

/** What `stat` returns. Links are never reported: they are refused or followed. */
export type ConfinedStats = {
  /** Root-relative, `/`-separated path (`""` for the root). */
  path: string;
  name: string;
  type: "file" | "directory" | "other";
  size: number;
  lastModified: Date;
};

/** Per-call options for the file readers. */
export type ConfinedReadOptions = {
  /** Override the reader's `maxFileBytes` for this call. */
  maxFileBytes?: number;
};

/** `readText` options. */
export type ConfinedReadTextOptions = ConfinedReadOptions & {
  /** @default "utf8" */
  encoding?: BufferEncoding;
};

/** `readJson` options: validate the parsed value against any Standard Schema. */
export type ConfinedReadJsonOptions<T> = ConfinedReadOptions & {
  schema?: StandardSchemaV1<T>;
};

/** `list` options. */
export type ConfinedListOptions = {
  /** Override the reader's `maxEntries` for this call. */
  maxEntries?: number;
};

/** `walk` options. */
export type ConfinedWalkOptions = {
  /** Override the reader's `maxEntries` for this walk (counted across the whole walk). */
  maxEntries?: number;
  /** Override the reader's `maxDepth` for this walk. */
  maxDepth?: number;
};

type Resolved = {
  absolutePath: string;
  relativePath: string;
  stats: BigIntStats;
};

type EntryBudget = { count: number; max: number };

const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Flags for opening a checked file: never follow a link at the last
 * component, and never block on a FIFO swapped in after the check (the
 * identity check then refuses it). `O_NOFOLLOW` / `O_NONBLOCK` are absent on
 * Windows (`undefined` in `fs.constants`), where the identity check alone
 * catches a swapped entry. Read on every open so the constants are looked up
 * where they are used.
 */
function readFlags(): number {
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);

  return code === "ENOENT" || code === "ENOTDIR";
}

function fsError(code: string, message: string, filePath: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  error.path = filePath;

  return error;
}

function entryType(stats: BigIntStats | Dirent): ConfinedEntryType {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";

  return "other";
}

function checkLimit(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    value < 0 ||
    (Number.isFinite(value) && !Number.isInteger(value))
  ) {
    throw new TypeError(
      `confined reader: ${name} must be a non-negative integer or Infinity, got ${String(value)}`,
    );
  }

  return value;
}

function joinRelative(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/**
 * A reader confined to one directory. Create it with
 * {@link createConfinedReader} or `fs.confined(root, options)`.
 *
 * Every call takes a path relative to the root and guarantees:
 *
 * - absolute paths and `..` that climb above the root are refused before any
 *   file-system access ({@link FsPathEscapeError});
 * - every component is checked with `lstat`; a symbolic link (or Windows
 *   junction) anywhere in the path is refused ({@link FsLinkRefusedError}),
 *   unless `followLinks` is on and the link resolves inside the root;
 * - files are opened with `O_NOFOLLOW` where the platform has it, and the
 *   opened handle's device/inode must equal the checked entry's — a file
 *   swapped for a link (or for another file) between the check and the open
 *   is refused;
 * - reads stop at `maxFileBytes` while reading, and `list` / `walk` at
 *   `maxEntries` and `maxDepth` ({@link FsLimitExceededError}).
 *
 * Missing paths throw the usual `ENOENT` / `ENOTDIR` errors.
 */
export class ConfinedReader {
  /** The canonical (realpath) root every path is confined to. */
  public readonly root: string;
  public readonly followLinks: boolean;
  public readonly maxFileBytes: number;
  public readonly maxEntries: number;
  public readonly maxDepth: number;
  private readonly rootStats: BigIntStats;

  public constructor(root: string, options: ConfinedReaderOptions = {}) {
    this.followLinks = options.followLinks === true;
    this.maxFileBytes = checkLimit(
      "maxFileBytes",
      options.maxFileBytes,
      CONFINED_DEFAULT_MAX_FILE_BYTES,
    );
    this.maxEntries = checkLimit("maxEntries", options.maxEntries, CONFINED_DEFAULT_MAX_ENTRIES);
    this.maxDepth = checkLimit("maxDepth", options.maxDepth, CONFINED_DEFAULT_MAX_DEPTH);

    const given = path.resolve(root);

    if (lstatSync(given).isSymbolicLink() && options.allowSymlinkedRoot !== true) {
      throw new FsLinkRefusedError(
        root,
        given,
        "",
        "root-symlink",
        `Confined root "${root}" is a symbolic link; pass { allowSymlinkedRoot: true } to confine reads to its target.`,
      );
    }

    this.root = realpathSync.native(given);
    this.rootStats = lstatSync(this.root, { bigint: true });

    if (!this.rootStats.isDirectory()) {
      throw fsError("ENOTDIR", `Confined root "${root}" is not a directory.`, this.root);
    }
  }

  /** Read a file as text (UTF-8 unless `encoding` says otherwise). */
  public async readText(filePath: string, options: ConfinedReadTextOptions = {}): Promise<string> {
    const buffer = await this.readBuffer(filePath, options);

    return buffer.toString(options.encoding ?? "utf8");
  }

  /** Read a file and parse it as JSON, optionally validating it with `schema`. */
  public async readJson<T = unknown>(
    filePath: string,
    options: ConfinedReadJsonOptions<T> = {},
  ): Promise<T> {
    const buffer = await this.readBuffer(filePath, options);
    const value: unknown = JSON.parse(buffer.toString("utf8"));

    if (options.schema) {
      return validateAgainstSchema(filePath, options.schema, value);
    }

    return value as T;
  }

  /** Read a file's bytes. */
  public async readBuffer(filePath: string, options: ConfinedReadOptions = {}): Promise<Buffer> {
    const max = checkLimit("maxFileBytes", options.maxFileBytes, this.maxFileBytes);
    const resolved = await this.resolve(filePath);
    const { stats, relativePath } = resolved;

    if (stats.isDirectory()) {
      throw fsError("EISDIR", `"${filePath}" is a directory.`, resolved.absolutePath);
    }

    if (!stats.isFile()) {
      throw fsError("EINVAL", `"${filePath}" is not a regular file.`, resolved.absolutePath);
    }

    if (Number(stats.size) > max) {
      throw this.sizeError(relativePath, max, Number(stats.size));
    }

    const handle = await this.openChecked(filePath, resolved);

    try {
      return await this.readBounded(handle, relativePath, max);
    } finally {
      await handle.close();
    }
  }

  /** Stat a path. Links are refused (or, with `followLinks`, reported as their target). */
  public async stat(filePath: string): Promise<ConfinedStats> {
    const { stats, relativePath } = await this.resolve(filePath);
    const type = entryType(stats);

    return {
      path: relativePath,
      name: relativePath === "" ? path.basename(this.root) : path.posix.basename(relativePath),
      type: type === "symlink" ? "other" : type,
      size: Number(stats.size),
      lastModified: stats.mtime,
    };
  }

  /**
   * Whether the path exists. Missing paths (`ENOENT`, `ENOTDIR`) give `false`;
   * an escape or a refused link still throws, so a hostile path is never
   * mistaken for an absent one.
   */
  public async exists(filePath: string): Promise<boolean> {
    try {
      await this.resolve(filePath);

      return true;
    } catch (error) {
      if (isMissing(error)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * The entries directly inside a directory (`""` is the root), sorted by
   * name. Links are listed as `symlink` and never followed.
   */
  public async list(
    directoryPath = "",
    options: ConfinedListOptions = {},
  ): Promise<ConfinedEntry[]> {
    const max = checkLimit("maxEntries", options.maxEntries, this.maxEntries);
    const resolved = await this.resolveDirectory(directoryPath);

    return this.readEntries(resolved, { count: 0, max }, 1);
  }

  /**
   * Walk a directory tree depth-first (a folder before its contents, names
   * sorted), yielding root-relative entries. Throws
   * {@link FsLimitExceededError} once `maxEntries` entries have been read or
   * a folder lies deeper than `maxDepth` — never a silently partial tree.
   * Each directory is walked once, so a link cycle (`followLinks`) or a bind
   * mount cannot loop.
   */
  public async *walk(
    directoryPath = "",
    options: ConfinedWalkOptions = {},
  ): AsyncGenerator<ConfinedEntry, void, undefined> {
    const max = checkLimit("maxEntries", options.maxEntries, this.maxEntries);
    const maxDepth = checkLimit("maxDepth", options.maxDepth, this.maxDepth);
    const start = await this.resolveDirectory(directoryPath);

    yield* this.walkDirectory(start, 1, maxDepth, { count: 0, max }, new Set<string>());
  }

  private async *walkDirectory(
    resolved: Resolved,
    depth: number,
    maxDepth: number,
    budget: EntryBudget,
    visited: Set<string>,
  ): AsyncGenerator<ConfinedEntry, void, undefined> {
    if (depth > maxDepth) {
      throw new FsLimitExceededError(
        resolved.relativePath,
        "maxDepth",
        maxDepth,
        depth,
        `Walking "${resolved.relativePath}" would go deeper than maxDepth (${maxDepth}).`,
      );
    }

    const key = `${resolved.stats.dev}:${resolved.stats.ino}`;

    if (visited.has(key)) {
      return;
    }

    visited.add(key);

    for (const entry of await this.readEntries(resolved, budget, depth)) {
      yield entry;

      const followable = entry.type === "symlink" && this.followLinks;

      if (entry.type !== "directory" && !followable) {
        continue;
      }

      let child: Resolved;

      try {
        child = await this.resolve(entry.path);
      } catch (error) {
        // A followed link that points outside the root, or that dangles, is
        // still yielded (as `symlink`) but not descended into.
        if (followable && (error instanceof FsPathEscapeError || isMissing(error))) {
          continue;
        }

        throw error;
      }

      if (child.stats.isDirectory()) {
        yield* this.walkDirectory(child, depth + 1, maxDepth, budget, visited);
      }
    }
  }

  /**
   * Resolve a root-relative path to a checked absolute path, `lstat`-ing every
   * component from the root down.
   */
  private async resolve(input: string): Promise<Resolved> {
    const segments = normalizeConfinedPath(input, this.root);
    let stats = await lstat(this.root, { bigint: true });

    if (stats.isSymbolicLink() || !sameIdentity(stats, this.rootStats)) {
      throw new FsLinkRefusedError(
        input,
        this.root,
        "",
        stats.isSymbolicLink() ? "root-symlink" : "identity-changed",
        `Confined root "${this.root}" was replaced after the reader was created.`,
      );
    }

    let current = this.root;
    let relative = "";

    for (const segment of segments) {
      const next = path.join(current, segment);
      relative = joinRelative(relative, segment);
      stats = await lstat(next, { bigint: true });

      if (!stats.isSymbolicLink()) {
        current = next;
        continue;
      }

      if (!this.followLinks) {
        throw new FsLinkRefusedError(
          input,
          this.root,
          relative,
          "symlink",
          `"${relative}" is a symbolic link; this confined reader does not follow links.`,
        );
      }

      const target = await realpath(next);

      if (!isPathInside(target, this.root)) {
        throw new FsPathEscapeError(
          input,
          this.root,
          "link-escape",
          `"${relative}" is a link that resolves outside the confined root.`,
        );
      }

      stats = await lstat(target, { bigint: true });

      if (stats.isSymbolicLink()) {
        throw new FsLinkRefusedError(
          input,
          this.root,
          relative,
          "identity-changed",
          `"${relative}" changed while its link was being resolved.`,
        );
      }

      current = target;
    }

    return { absolutePath: current, relativePath: segments.join("/"), stats };
  }

  private async resolveDirectory(directoryPath: string): Promise<Resolved> {
    const resolved = await this.resolve(directoryPath);

    if (!resolved.stats.isDirectory()) {
      throw fsError("ENOTDIR", `"${directoryPath}" is not a directory.`, resolved.absolutePath);
    }

    return resolved;
  }

  /**
   * Open a checked file without following a link, then confirm the handle is
   * the very entry `resolve` checked. This closes the check-then-open race for
   * the last component and, through the identity check, for every parent
   * folder too: a folder swapped for a link to elsewhere makes the open land
   * on a different inode.
   */
  private async openChecked(input: string, resolved: Resolved): Promise<FileHandle> {
    let handle: FileHandle;

    try {
      handle = await open(resolved.absolutePath, readFlags());
    } catch (error) {
      const code = errorCode(error);

      // O_NOFOLLOW on a link: ELOOP on Linux and macOS, EMLINK on FreeBSD.
      if (code === "ELOOP" || code === "EMLINK") {
        throw this.changedError(input, resolved.relativePath, "became a link");
      }

      throw error;
    }

    try {
      const opened = await handle.stat({ bigint: true });

      if (!opened.isFile() || !sameIdentity(opened, resolved.stats)) {
        throw this.changedError(input, resolved.relativePath, "was replaced");
      }
    } catch (error) {
      await handle.close();

      throw error;
    }

    return handle;
  }

  /** Read at most `max` bytes, throwing as soon as one more byte arrives. */
  private async readBounded(
    handle: FileHandle,
    relativePath: string,
    max: number,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    for (;;) {
      // Ask for one byte past the bound so a file that grew is noticed.
      const wanted = Math.min(READ_CHUNK_BYTES, max - total + 1);
      const buffer = Buffer.allocUnsafe(wanted);
      const { bytesRead } = await handle.read(buffer, 0, wanted, null);

      if (bytesRead === 0) {
        break;
      }

      total += bytesRead;

      if (total > max) {
        throw this.sizeError(relativePath, max, total);
      }

      chunks.push(bytesRead === wanted ? buffer : buffer.subarray(0, bytesRead));
    }

    return Buffer.concat(chunks, total);
  }

  /**
   * Read one directory's entries, counting them against `budget`. On Linux
   * the folder is opened with `O_NOFOLLOW | O_DIRECTORY`, its identity checked
   * on the descriptor, and its entries read through `/proc/self/fd/<fd>`, so
   * the entries come from exactly the folder that was checked. Elsewhere (or
   * without `/proc`) the folder is read by path and its identity re-checked
   * after the read.
   */
  private async readEntries(
    resolved: Resolved,
    budget: EntryBudget,
    depth: number,
  ): Promise<ConfinedEntry[]> {
    const entries: ConfinedEntry[] = [];
    const collect = async (directory: string) => {
      const dir = await opendir(directory);

      for await (const dirent of dir) {
        budget.count++;

        if (budget.count > budget.max) {
          throw new FsLimitExceededError(
            resolved.relativePath,
            "maxEntries",
            budget.max,
            budget.count,
            `Reading "${resolved.relativePath}" went over maxEntries (${budget.max}).`,
          );
        }

        entries.push({
          path: joinRelative(resolved.relativePath, dirent.name),
          name: dirent.name,
          type: entryType(dirent),
          depth,
        });
      }
    };

    const handle = await this.openDirectoryHandle(resolved);

    if (handle) {
      try {
        await collect(`/proc/self/fd/${handle.fd}`);
      } finally {
        await handle.close();
      }
    } else {
      await collect(resolved.absolutePath);

      const after = await lstat(resolved.absolutePath, { bigint: true });

      if (after.isSymbolicLink() || !sameIdentity(after, resolved.stats)) {
        throw this.changedError(resolved.relativePath, resolved.relativePath, "was replaced");
      }
    }

    return entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  }

  /**
   * Linux only: a descriptor for the checked folder, opened without following
   * a link, whose identity matches the check. `undefined` when the platform
   * or `/proc` cannot be used, so the caller falls back to reading by path.
   */
  private async openDirectoryHandle(resolved: Resolved): Promise<FileHandle | undefined> {
    if (process.platform !== "linux") {
      return undefined;
    }

    let handle: FileHandle;

    try {
      handle = await open(
        resolved.absolutePath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      const code = errorCode(error);

      if (code === "ELOOP" || code === "ENOTDIR") {
        throw this.changedError(resolved.relativePath, resolved.relativePath, "was replaced");
      }

      throw error;
    }

    try {
      const opened = await handle.stat({ bigint: true });

      if (!sameIdentity(opened, resolved.stats)) {
        throw this.changedError(resolved.relativePath, resolved.relativePath, "was replaced");
      }

      const viaProc = await lstat(`/proc/self/fd/${handle.fd}`).then(
        () => true,
        () => false,
      );

      if (viaProc) {
        return handle;
      }
    } catch (error) {
      await handle.close();

      throw error;
    }

    await handle.close();

    return undefined;
  }

  private changedError(input: string, relativePath: string, what: string): FsLinkRefusedError {
    return new FsLinkRefusedError(
      input,
      this.root,
      relativePath,
      "identity-changed",
      `"${relativePath}" ${what} between the check and the read; refusing to read it.`,
    );
  }

  private sizeError(relativePath: string, max: number, actual: number): FsLimitExceededError {
    return new FsLimitExceededError(
      relativePath,
      "maxFileBytes",
      max,
      actual,
      `"${relativePath}" is larger than maxFileBytes (${max} bytes).`,
    );
  }
}

/**
 * Create a reader confined to `root`: paths stay inside it, symbolic links
 * (and Windows junctions) are refused at every component, and reads are
 * bounded in size and count. The root is canonicalised once, here
 * (synchronously); a root that is itself a link is refused unless
 * `allowSymlinkedRoot` is set.
 *
 * @example
 * import { createConfinedReader } from "@warlock.js/fs";
 *
 * const folder = createConfinedReader(userChosenFolder, { maxFileBytes: 8 * 1024 * 1024 });
 * const room = await folder.readJson("rooms/main/room.json");
 *
 * for await (const entry of folder.walk("rooms", { maxEntries: 20_000 })) {
 *   if (entry.type === "file") console.log(entry.path);
 * }
 */
export function createConfinedReader(
  root: string,
  options: ConfinedReaderOptions = {},
): ConfinedReader {
  return new ConfinedReader(root, options);
}
