import { cp, readdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import nodePath from "node:path";
import { ensureDirectoryAsync } from "../dirs";
import { directoryExistsAsync, pathExistsAsync } from "../exists";
import { hashFileAsync, type HashAlgorithm } from "../hash";
import { listAsync, listDirectoriesAsync, listFilesAsync } from "../list";
import { removeDirectoryAsync } from "../remove";
import { statsAsync } from "../stats";
import {
  normalizeStats,
  type CopyOptions,
  type FileStats,
  type ListOptions,
  type MoveOptions,
  type WalkEntry,
  type WalkOptions,
} from "./options";

/** Recursive (by default) directory walker — a constant-memory async iterator. */
async function* walk(root: string, options?: WalkOptions): AsyncGenerator<WalkEntry> {
  const recursive = options?.recursive ?? true;
  const followSymlinks = options?.followSymlinks ?? false;
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const full = nodePath.join(dir, entry.name);
      const isLink = entry.isSymbolicLink();
      let isDirectory = entry.isDirectory();

      if (isLink && followSymlinks) {
        isDirectory = (await stat(full)).isDirectory();
      }

      yield { path: full, name: entry.name, type: isDirectory ? "directory" : "file" };

      if (isDirectory && recursive && (!isLink || followSymlinks)) {
        stack.push(full);
      }
    }
  }
}

async function collect(root: string, keep: (entry: WalkEntry) => boolean): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of walk(root, { recursive: true })) {
    if (keep(entry)) paths.push(entry.path);
  }
  return paths;
}

function ensure(path: string): Promise<void> {
  return ensureDirectoryAsync(path);
}

function remove(path: string): Promise<void> {
  return removeDirectoryAsync(path);
}

/** Clear a directory's contents but keep the directory (created if missing). */
async function empty(path: string): Promise<void> {
  await ensureDirectoryAsync(path);
  const entries = await readdir(path);
  await Promise.all(
    entries.map((entry) => rm(nodePath.join(path, entry), { recursive: true, force: true })),
  );
}

function exists(path: string): Promise<boolean> {
  return directoryExistsAsync(path);
}

async function copy(from: string, to: string, options?: CopyOptions): Promise<void> {
  if ((options?.errorOnExist || options?.overwrite === false) && (await pathExistsAsync(to))) {
    throw new Error(`fs.dirs.copy: destination "${to}" already exists`);
  }

  // Only set optional keys when defined — Node's cp rejects `undefined` values
  // (they must be booleans when the property is present).
  const cpOptions: Parameters<typeof cp>[2] = {
    recursive: true,
    force: options?.overwrite !== false,
  };
  if (options?.errorOnExist !== undefined) cpOptions.errorOnExist = options.errorOnExist;
  if (options?.dereference !== undefined) cpOptions.dereference = options.dereference;

  await cp(from, to, cpOptions);
}

/** Move a directory, EXDEV-safe: rename, falling back to copy+remove across devices. */
async function move(from: string, to: string, options?: MoveOptions): Promise<void> {
  if (options?.overwrite === false && (await pathExistsAsync(to))) {
    throw new Error(`fs.dirs.move: destination "${to}" already exists`);
  }

  if (options?.ensureDir !== false) {
    await ensureDirectoryAsync(nodePath.dirname(to));
  }

  try {
    await rename(from, to);
  } catch (error) {
    if ((error as { code?: string }).code === "EXDEV") {
      await cp(from, to, { recursive: true });
      await removeDirectoryAsync(from);
      return;
    }
    throw error;
  }
}

async function stats(path: string): Promise<FileStats> {
  return normalizeStats(path, await statsAsync(path));
}

/** Total byte size of a directory tree (sum of file sizes). */
async function size(path: string): Promise<number> {
  let total = 0;
  for await (const entry of walk(path, { recursive: true })) {
    if (entry.type === "file") {
      total += (await stat(entry.path)).size;
    }
  }
  return total;
}

/** Number of immediate entries (files + subdirectories). */
async function count(path: string): Promise<number> {
  return (await readdir(path)).length;
}

async function isEmpty(path: string): Promise<boolean> {
  return (await readdir(path)).length === 0;
}

function list(path: string, options?: ListOptions): Promise<string[]> {
  return options?.recursive ? collect(path, () => true) : listAsync(path);
}

function listFiles(path: string, options?: ListOptions): Promise<string[]> {
  return options?.recursive
    ? collect(path, (entry) => entry.type === "file")
    : listFilesAsync(path);
}

function listDirs(path: string, options?: ListOptions): Promise<string[]> {
  return options?.recursive
    ? collect(path, (entry) => entry.type === "directory")
    : listDirectoriesAsync(path);
}

/**
 * Stable fingerprint of a directory tree: hashes every file (path-sorted) and
 * folds the relative path + per-file digest into one hash. Two trees with the
 * same relative layout + contents produce the same hash.
 */
async function hash(path: string, algorithm?: HashAlgorithm): Promise<string> {
  const filePaths = (await collect(path, (entry) => entry.type === "file")).sort();
  const digest = createHash(algorithm ?? "sha256");

  for (const filePath of filePaths) {
    const relative = nodePath.relative(path, filePath).split(nodePath.sep).join("/");
    digest.update(`${relative}\0${await hashFileAsync(filePath, algorithm)}\n`);
  }

  return digest.digest("hex");
}

/**
 * The `fs.dirs.*` facade — an async, ergonomic surface over the directory
 * primitives, plus recursive `walk`/`list*`/`size` and a directory fingerprint.
 */
export const dirs = {
  ensure,
  remove,
  empty,
  exists,
  copy,
  move,
  stats,
  size,
  count,
  isEmpty,
  list,
  listFiles,
  listDirs,
  walk,
  hash,
};
