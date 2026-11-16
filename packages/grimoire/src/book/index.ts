/**
 * The book (owned by T-127): collecting the adapter's facts with a freshness
 * fingerprint, the route cache, and writing the per-file mirror, the module
 * summaries, `app/routes.json` and the page and screen lists.
 *
 * Freshness rules:
 * - `buildBook` stats every file under the adapter's source roots (and the test
 *   files); a file whose size and mtime match the manifest keeps its hash,
 *   others are hashed. When the file set and hashes, the adapter name and
 *   version, the grimoire version and the schema version all match, the
 *   adapter is not called and nothing is written (`rebuilt: false`).
 * - Otherwise `files`, `sites`, `pages`, `mobile` and `tests` are collected
 *   again (all static).
 * - `routes` and `named` (the boot facts) are collected only when the caller
 *   asked for `routes: "fresh"` and an input of the boot cache changed (see
 *   `BookManifest.boot`); with `cached` the old ones are kept and reported
 *   `stale`.
 */
import type { BookAdapter } from "../contracts/adapter";
import type {
  BookAnnotations,
  BookModuleSummary,
  BuildBookOptions,
  BuildBookResult,
  LoadedBook,
  WriteBookResult,
} from "../contracts/book";

/**
 * Bring the book's facts up to date and write `manifest.json` and
 * `.cache/facts.json`. Does not write entries (see `writeBook`).
 *
 * @param root Absolute project root.
 */
export async function buildBook(
  root: string,
  adapter: BookAdapter,
  options: BuildBookOptions = {},
): Promise<BuildBookResult> {
  void root;
  void adapter;
  void options;
  throw new Error("not implemented");
}

/** Read the book from disk without calling an adapter; `null` when it was never built. */
export async function loadBook(root: string): Promise<LoadedBook | null> {
  void root;
  throw new Error("not implemented");
}

/**
 * Write the book files that depend on the written files too: one entry per
 * code file, `index.md` per module, `app/routes.json`, the page and screen
 * lists. Rewrites only files whose content changed, removes entries whose
 * source is gone, and stores `annotations.writtenHash` and `tests` in the
 * manifest.
 */
export async function writeBook(
  book: LoadedBook,
  annotations: BookAnnotations,
): Promise<WriteBookResult> {
  void book;
  void annotations;
  throw new Error("not implemented");
}

/** The Markdown of one module summary (format in `BookModuleSummary`). */
export function renderModuleSummary(summary: BookModuleSummary): string {
  void summary;
  throw new Error("not implemented");
}
