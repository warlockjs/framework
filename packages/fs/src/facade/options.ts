import path from "node:path";
import type { Stats } from "node:fs";
import type { StandardSchemaV1 } from "./standard-schema";

/** Read options. `encoding: null` returns a `Buffer`; otherwise a decoded string. */
export type ReadOptions = { encoding?: BufferEncoding | null };

/**
 * JSON read options. `schema` validates the parsed value against any Standard
 * Schema (seal / zod / valibot); `default` is returned when the file is missing
 * (instead of throwing).
 */
export type ReadJsonOptions<T = unknown> = {
  schema?: StandardSchemaV1<T>;
  default?: T;
};

/** Write options shared by the string/Buffer writers. */
export type WriteOptions = {
  /** Text encoding for string writes (default `utf-8`). Ignored for `Buffer`. */
  encoding?: BufferEncoding;
  /** Write via a temp file + rename so readers never see a half-written file. */
  atomic?: boolean;
  /** Create missing parent directories (default `true`). */
  ensureDir?: boolean;
  /** When `false`, throw if the target already exists (drives `create`). Default `true`. */
  overwrite?: boolean;
};

/** JSON write options — adds the pretty-print `indent` (default `2`). */
export type WriteJsonOptions = WriteOptions & { indent?: number };

/** JSON merge options — shallow spread by default; `deep` for a recursive merge. */
export type MergeJsonOptions = WriteJsonOptions & { deep?: boolean };

/** Copy options (files + directories). */
export type CopyOptions = {
  /** Overwrite an existing destination (default `true`). */
  overwrite?: boolean;
  /** Throw if the destination already exists (default `false`). */
  errorOnExist?: boolean;
  /** Follow symlinks instead of copying the link (default `false`). */
  dereference?: boolean;
};

/** Move options. `ensureDir` (default `true`) creates the destination's parent. */
export type MoveOptions = {
  overwrite?: boolean;
  ensureDir?: boolean;
};

/** Directory-listing options. `recursive` walks the whole tree. */
export type ListOptions = { recursive?: boolean };

/** Directory-walk options. */
export type WalkOptions = {
  recursive?: boolean;
  followSymlinks?: boolean;
};

/** One entry yielded by `walk()`. Discriminated by `type` (never `kind`). */
export type WalkEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
};

/**
 * Normalized stats — a small, stable shape (with the raw `node:fs.Stats` kept
 * on `raw` as an escape hatch). Discriminated by `type`, not `kind`.
 */
export type FileStats = {
  path: string;
  name: string;
  size: number;
  type: "file" | "directory";
  lastModified: Date;
  raw: Stats;
};

/**
 * Normalize a raw `node:fs.Stats` into a {@link FileStats}.
 *
 * @param filePath - The path the stats were read for.
 * @param raw - The raw `node:fs.Stats`.
 * @returns The normalized stats.
 */
export function normalizeStats(filePath: string, raw: Stats): FileStats {
  return {
    path: filePath,
    name: path.basename(filePath),
    size: raw.size,
    type: raw.isDirectory() ? "directory" : "file",
    lastModified: raw.mtime,
    raw,
  };
}
