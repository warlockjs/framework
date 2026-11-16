/**
 * `writeBook`: writes the entries, module summaries, `app/routes.json` and
 * the page and screen lists, touching only files whose content changed.
 *
 * It remembers what it wrote in `.cache/written.json` (a hash per book file
 * and a stamp of its inputs), so a run with the same facts and annotations
 * returns at once without reading or writing any book file, and a run after a
 * change compares hashes in memory instead of reading every entry back.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BOOK_SCHEMA_VERSION,
  type BookAnnotations,
  type LoadedBook,
  type WriteBookResult,
} from "../contracts/book";
import { GRIMOIRE_PATHS } from "../paths";
import { grimoireVersion, WRITE_STATE_PATH } from "./build";
import {
  bookFile,
  hashText,
  isInsideBook,
  IO_CONCURRENCY,
  listBookFiles,
  mapLimit,
  readJson,
  removeBookFile,
  toJson,
  writeBookFile,
} from "./io";
import { renderBook } from "./render";

/** `.cache/written.json`: what the last `writeBook` wrote. Machine use only. */
type WriteState = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  /** Hash of everything the content depends on (version, facts, annotations). */
  stamp: string;
  /** Book file → sha256 of the content written. */
  files: Record<string, string>;
};

/** Book files `writeBook` never removes. */
function isKept(bookPath: string): boolean {
  return (
    bookPath === GRIMOIRE_PATHS.bookManifest ||
    bookPath === GRIMOIRE_PATHS.testResults ||
    bookPath.startsWith(`${GRIMOIRE_PATHS.book}/.cache/`) ||
    bookPath.startsWith(`${GRIMOIRE_PATHS.staticSite}/`)
  );
}

/** Whether a book file not listed in a write state looks like one `writeBook` wrote. */
const isGenerated = (bookPath: string): boolean =>
  /\.(?:json|md)$/.test(bookPath) && !isKept(bookPath);

async function readDiskText(root: string, bookPath: string): Promise<string | null> {
  try {
    return await readFile(bookFile(root, bookPath), "utf8");
  } catch {
    return null;
  }
}

/**
 * Write the book files that depend on the written files too: one entry per
 * code file, `index.md` per module, `app/routes.json`, the page and screen
 * lists. Rewrites only files whose content changed, removes entries whose
 * source is gone, and stores `annotations.writtenHash` and `tests` in the
 * manifest (`book.manifest` is updated in place).
 */
export async function writeBook(
  book: LoadedBook,
  annotations: BookAnnotations,
): Promise<WriteBookResult> {
  const root = book.root;
  const statePath = path.join(root, ...WRITE_STATE_PATH.split("/"));
  const previous = await readJson<WriteState>(statePath);
  const state =
    previous?.schemaVersion === BOOK_SCHEMA_VERSION && typeof previous.files === "object"
      ? previous
      : null;
  const stamp = hashText(
    JSON.stringify([grimoireVersion(), BOOK_SCHEMA_VERSION, book.facts, annotations.files]),
  );
  const written: string[] = [];
  const removed: string[] = [];

  if (state === null || state.stamp !== stamp) {
    const contents = renderBook(book.facts, annotations);
    const hashes = new Map(
      [...contents].map(([bookPath, content]) => [bookPath, hashText(content)]),
    );
    const changed = await mapLimit(
      [...contents.keys()].sort(),
      IO_CONCURRENCY,
      async (bookPath) => {
        const content = contents.get(bookPath) ?? "";

        if (state !== null) {
          if (state.files[bookPath] === hashes.get(bookPath)) return null;
        } else if ((await readDiskText(root, bookPath)) === content) {
          // No record of the last write (first run, or after `force`): compare with the disk once.
          return null;
        }

        await writeBookFile(root, bookPath, content);

        return bookPath;
      },
    );

    for (const bookPath of changed) if (bookPath !== null) written.push(bookPath);

    const known =
      state === null ? (await listBookFiles(root)).filter(isGenerated) : Object.keys(state.files);
    // `written.json` is a file on disk: a path in it that leaves `grimoire/book/` is ignored, never removed.
    const gone = known
      .filter((bookPath) => isInsideBook(bookPath) && !contents.has(bookPath) && !isKept(bookPath))
      .sort();

    await mapLimit(gone, IO_CONCURRENCY, async (bookPath) => removeBookFile(root, bookPath));
    removed.push(...gone);

    const next: WriteState = {
      schemaVersion: BOOK_SCHEMA_VERSION,
      stamp,
      files: Object.fromEntries([...hashes].sort(([left], [right]) => (left < right ? -1 : 1))),
    };

    await writeBookFile(root, WRITE_STATE_PATH, toJson(next));
  }

  const manifest = book.manifest;
  const sameTests =
    Object.keys(manifest.tests).length === Object.keys(annotations.tests).length &&
    Object.entries(annotations.tests).every(([file, hash]) => manifest.tests[file] === hash);

  if (
    manifest.writtenHash !== annotations.writtenHash ||
    !sameTests ||
    written.length > 0 ||
    removed.length > 0
  ) {
    manifest.writtenHash = annotations.writtenHash;
    manifest.tests = { ...annotations.tests };

    if (written.length > 0 || removed.length > 0) manifest.builtAt = new Date().toISOString();

    await writeBookFile(root, GRIMOIRE_PATHS.bookManifest, toJson(manifest));
  }

  return { written, removed };
}
