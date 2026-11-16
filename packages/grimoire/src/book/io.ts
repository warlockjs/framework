/**
 * File helpers of the book builder: walking the source roots, hashing with a
 * stat cache, bounded concurrency, and atomic writes that never leave
 * `grimoire/book/`.
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GRIMOIRE_PATHS, toPosixPath } from "../paths";

/** How many file operations run at once. */
export const IO_CONCURRENCY = 32;

/** Files up to this size are read in one go; larger ones are streamed into the hash. */
const READ_WHOLE_LIMIT = 256 * 1024;

/** Folder names never walked under a source root. */
function isSkippedName(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

/** Run `task` over `items` with at most `limit` at once; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

/** sha256 (hex) of a string. */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** sha256 (hex) of a file's bytes; large files are streamed. */
export async function hashFile(absolute: string, size: number): Promise<string> {
  if (size <= READ_WHOLE_LIMIT) {
    return createHash("sha256").update(await readFile(absolute)).digest("hex");
  }

  const hash = createHash("sha256");
  await pipeline(createReadStream(absolute), hash);

  return hash.digest("hex");
}

/** sha256 of a project file, or `""` when it does not exist. */
export async function hashIfExists(root: string, file: string): Promise<string> {
  const absolute = path.join(root, ...file.split("/"));

  try {
    const info = await stat(absolute);

    return info.isFile() ? await hashFile(absolute, info.size) : "";
  } catch (error) {
    if (isMissing(error)) return "";
    throw error;
  }
}

/** Whether an fs error says the path is not there. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;

  return code === "ENOENT" || code === "ENOTDIR";
}

/** A source root as a clean project-relative POSIX folder (`.` for the project itself). */
export function cleanFolder(folder: string): string {
  const posix = path.posix.normalize(toPosixPath(folder)).replace(/\/+$/, "");

  return posix === "" || posix === "./" ? "." : posix;
}

/**
 * Every file under the given project-relative folders, as sorted
 * project-relative POSIX paths. `node_modules`, dot folders and the
 * `grimoire/` folder are skipped; symbolic links are not followed.
 */
export async function listFiles(root: string, folders: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  let pending = [...new Set(folders.map(cleanFolder))];

  while (pending.length > 0) {
    const nextLevel: string[] = [];

    await mapLimit(pending, IO_CONCURRENCY, async (folder) => {
      let entries: Dirent[];

      try {
        entries = await readdir(folder === "." ? root : path.join(root, ...folder.split("/")), {
          withFileTypes: true,
        });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }

      for (const entry of entries) {
        if (isSkippedName(entry.name)) continue;

        const file = folder === "." ? entry.name : `${folder}/${entry.name}`;

        if (entry.isDirectory()) {
          if (file !== "grimoire") nextLevel.push(file);
        } else if (entry.isFile()) {
          found.add(file);
        }
      }
    });

    pending = nextLevel;
  }

  return [...found].sort();
}

/** Read and parse a JSON file; `null` when it is missing or cannot be parsed. */
export async function readJson<T>(absolute: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(absolute, "utf8")) as T;
  } catch {
    return null;
  }
}

/** JSON as every generated file is written. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Whether a project-relative path stays inside `grimoire/book/` (no `..` escape). */
export function isInsideBook(bookPath: string): boolean {
  const normalized = path.posix.normalize(toPosixPath(bookPath));

  return normalized === bookPath && normalized.startsWith(`${GRIMOIRE_PATHS.book}/`);
}

/** The absolute path of a book file; throws for a path outside `grimoire/book/`. */
export function bookFile(root: string, bookPath: string): string {
  if (!isInsideBook(bookPath)) {
    throw new Error(`Grimoire refused to touch ${bookPath}: it is outside ${GRIMOIRE_PATHS.book}/.`);
  }

  return path.join(root, ...bookPath.split("/"));
}

/**
 * Write a book file atomically: the content goes to a temporary file next to
 * it, which is then renamed over the target, so a reader sees the old file or
 * the new one, never half of one.
 */
export async function writeBookFile(root: string, bookPath: string, content: string): Promise<void> {
  const target = bookFile(root, bookPath);
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

  await mkdir(path.dirname(target), { recursive: true });

  try {
    await writeFile(temporary, content);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Remove a book file (missing is fine), then any folders it leaves empty, up to the book root. */
export async function removeBookFile(root: string, bookPath: string): Promise<void> {
  const target = bookFile(root, bookPath);
  const bookRoot = path.join(root, ...GRIMOIRE_PATHS.book.split("/"));

  try {
    await unlink(target);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  let folder = path.dirname(target);

  while (folder.startsWith(`${bookRoot}${path.sep}`)) {
    try {
      await rmdir(folder);
    } catch {
      // Not empty (or already gone): the folders above it are not empty either.
      return;
    }

    folder = path.dirname(folder);
  }
}

/** Every file under `grimoire/book/`, project-relative, or `[]` when there is no book. */
export async function listBookFiles(root: string): Promise<string[]> {
  return listFiles(root, [GRIMOIRE_PATHS.book]).then((files) =>
    // `listFiles` skips dot folders, so `.cache/` never appears here.
    files.filter((file) => !file.endsWith(".tmp")),
  );
}
