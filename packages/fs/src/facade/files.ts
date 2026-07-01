import { appendFile, readFile, rename, utimes, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import nodePath from "node:path";
import { atomicWriteAsync } from "../atomic";
import { copyFileAsync } from "../copy";
import { ensureDirectoryAsync } from "../dirs";
import { fileExistsAsync, pathExistsAsync } from "../exists";
import { hashFileAsync, type HashAlgorithm } from "../hash";
import { getFileAsync } from "../read";
import { unlinkAsync } from "../remove";
import { lastModifiedAsync, statsAsync } from "../stats";
import { putFileAsync } from "../write";
import {
  normalizeStats,
  type CopyOptions,
  type FileStats,
  type MergeJsonOptions,
  type MoveOptions,
  type ReadJsonOptions,
  type ReadOptions,
  type WriteJsonOptions,
  type WriteOptions,
} from "./options";
import { validateAgainstSchema } from "./standard-schema";

function isENOENT(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;

  const output: Record<string, unknown> = { ...target };

  for (const [key, value] of Object.entries(source)) {
    output[key] = isPlainObject(value) && isPlainObject(output[key])
      ? deepMerge(output[key], value)
      : value;
  }

  return output;
}

/** Read a file as text (utf-8) or, when `encoding: null`, as a `Buffer`. */
function get(path: string): Promise<string>;
function get(path: string, options: ReadOptions & { encoding: null }): Promise<Buffer>;
function get(path: string, options: ReadOptions): Promise<string | Buffer>;
async function get(path: string, options?: ReadOptions): Promise<string | Buffer> {
  if (options && options.encoding === null) {
    return readFile(path);
  }

  return readFile(path, options?.encoding ?? "utf-8");
}

/**
 * Read + parse JSON. `options.schema` validates the parsed value against any
 * Standard Schema; `options.default` is returned when the file is missing.
 */
async function getJson<T = unknown>(path: string, options?: ReadJsonOptions<T>): Promise<T> {
  let raw: string;

  try {
    raw = await getFileAsync(path);
  } catch (error) {
    if (options && "default" in options && isENOENT(error)) {
      return options.default as T;
    }
    throw error;
  }

  const value = JSON.parse(raw) as T;

  if (options?.schema) {
    return validateAgainstSchema(path, options.schema, value);
  }

  return value;
}

/** Write a file. Routes Buffers / `{ atomic }` through the atomic writer. */
async function put(
  path: string,
  content: string | Buffer,
  options?: WriteOptions,
): Promise<void> {
  if (options?.overwrite === false && (await pathExistsAsync(path))) {
    throw new Error(`fs.files: refusing to overwrite existing path "${path}" (overwrite:false)`);
  }

  if (typeof content !== "string" || options?.atomic) {
    await atomicWriteAsync(path, content);
    return;
  }

  const encoding = options?.encoding ?? "utf-8";

  if (options?.ensureDir === false) {
    await writeFile(path, content, encoding);
    return;
  }

  if (encoding === "utf-8") {
    await putFileAsync(path, content);
    return;
  }

  await ensureDirectoryAsync(nodePath.dirname(path));
  await writeFile(path, content, encoding);
}

async function putJson(path: string, value: unknown, options?: WriteJsonOptions): Promise<void> {
  await put(path, JSON.stringify(value, null, options?.indent ?? 2), options);
}

/** Create a file, refusing to overwrite an existing one (`put` with `overwrite:false`). */
async function create(path: string, content: string | Buffer, options?: WriteOptions): Promise<void> {
  await put(path, content, { ...options, overwrite: false });
}

async function createJson(path: string, value: unknown, options?: WriteJsonOptions): Promise<void> {
  await putJson(path, value, { ...options, overwrite: false });
}

function exists(path: string): Promise<boolean> {
  return fileExistsAsync(path);
}

function remove(path: string): Promise<void> {
  return unlinkAsync(path);
}

async function copy(from: string, to: string, options?: CopyOptions): Promise<void> {
  if ((options?.errorOnExist || options?.overwrite === false) && (await pathExistsAsync(to))) {
    throw new Error(`fs.files.copy: destination "${to}" already exists`);
  }

  await copyFileAsync(from, to);
}

/** Move a file, EXDEV-safe: rename, falling back to copy+unlink across devices. */
async function move(from: string, to: string, options?: MoveOptions): Promise<void> {
  if (options?.overwrite === false && (await pathExistsAsync(to))) {
    throw new Error(`fs.files.move: destination "${to}" already exists`);
  }

  if (options?.ensureDir !== false) {
    await ensureDirectoryAsync(nodePath.dirname(to));
  }

  try {
    await rename(from, to);
  } catch (error) {
    if ((error as { code?: string }).code === "EXDEV") {
      await copyFileAsync(from, to);
      await unlinkAsync(from);
      return;
    }
    throw error;
  }
}

async function stats(path: string): Promise<FileStats> {
  return normalizeStats(path, await statsAsync(path));
}

function lastModified(path: string): Promise<Date> {
  return lastModifiedAsync(path);
}

function hash(path: string, algorithm?: HashAlgorithm): Promise<string> {
  return hashFileAsync(path, algorithm);
}

async function append(path: string, content: string | Buffer, options?: WriteOptions): Promise<void> {
  if (options?.ensureDir !== false) {
    await ensureDirectoryAsync(nodePath.dirname(path));
  }
  await appendFile(path, content, typeof content === "string" ? (options?.encoding ?? "utf-8") : undefined);
}

async function prepend(path: string, content: string | Buffer, options?: WriteOptions): Promise<void> {
  let existing = "";
  try {
    existing = await getFileAsync(path);
  } catch (error) {
    if (!isENOENT(error)) throw error;
  }
  await put(path, `${content.toString()}${existing}`, options);
}

function appendLine(path: string, line: string): Promise<void> {
  return append(path, `${line}\n`);
}

function appendJsonLine(path: string, value: unknown): Promise<void> {
  return append(path, `${JSON.stringify(value)}\n`);
}

async function size(path: string): Promise<number> {
  return (await statsAsync(path)).size;
}

async function isEmpty(path: string): Promise<boolean> {
  return (await statsAsync(path)).size === 0;
}

/** Create an empty file if missing (and its parents). Never truncates an existing file. */
async function ensure(path: string): Promise<void> {
  if (!(await pathExistsAsync(path))) {
    await putFileAsync(path, "");
  }
}

/** Create the file if missing, otherwise bump its modified time. */
async function touch(path: string): Promise<void> {
  if (await pathExistsAsync(path)) {
    const now = new Date();
    await utimes(path, now, now);
    return;
  }
  await putFileAsync(path, "");
}

/** Read → transform → write (text). */
async function edit(
  path: string,
  editor: (content: string) => string | Promise<string>,
): Promise<void> {
  const next = await editor(await getFileAsync(path));
  await put(path, next);
}

/** Read → transform → write (JSON value). */
async function editJson<T = unknown>(
  path: string,
  editor: (value: T) => T | Promise<T>,
  options?: WriteJsonOptions,
): Promise<void> {
  const next = await editor(await getJson<T>(path));
  await putJson(path, next, options);
}

/** Read → merge a partial into the JSON object → write. Shallow unless `{ deep:true }`. */
async function mergeJson<T = Record<string, unknown>>(
  path: string,
  partial: Partial<T>,
  options?: MergeJsonOptions,
): Promise<void> {
  const current = await getJson<T>(path);
  const merged = options?.deep
    ? (deepMerge(current, partial) as T)
    : ({ ...current, ...partial } as T);
  await putJson(path, merged, options);
}

/** Return the parsed JSON, or create the file with `fallback` and return it. */
async function ensureJson<T = unknown>(
  path: string,
  fallback: T,
  options?: WriteJsonOptions,
): Promise<T> {
  if (await pathExistsAsync(path)) {
    return getJson<T>(path);
  }
  await putJson(path, fallback, options);
  return fallback;
}

/** Compare a file's digest against an expected hash (case-insensitive). */
async function checksumMatches(
  path: string,
  expected: string,
  algorithm?: HashAlgorithm,
): Promise<boolean> {
  const actual = await hashFileAsync(path, algorithm);
  return actual.toLowerCase() === expected.toLowerCase();
}

/** Stream a text file line by line (constant memory). */
function readLines(path: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      const rl = readline.createInterface({
        input: createReadStream(path, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of rl) {
          yield line;
        }
      } finally {
        rl.close();
      }
    },
  };
}

/**
 * The `fs.files.*` facade — an async, ergonomic surface over the file
 * primitives. Sync callers stay on the bare primitives (`getFile`/`putFile`/…).
 */
export const files = {
  get,
  getJson,
  put,
  putJson,
  create,
  createJson,
  exists,
  remove,
  copy,
  move,
  stats,
  lastModified,
  hash,
  append,
  prepend,
  appendLine,
  appendJsonLine,
  size,
  isEmpty,
  ensure,
  touch,
  edit,
  editJson,
  mergeJson,
  ensureJson,
  checksumMatches,
  readLines,
};
