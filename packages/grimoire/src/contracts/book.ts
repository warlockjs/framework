/**
 * The generated book under `grimoire/book/`. Warlock writes every file here;
 * the folder is ignored by git and rebuilt when sources or written files
 * change. Paths of the files are decided by `bookEntryPath()` and the
 * constants in `src/paths`.
 *
 * JSON files carry no timestamps except `manifest.json`, so an unchanged
 * project rewrites nothing and golden files stay stable.
 */
import type {
  BookFacts,
  BookFileType,
  BookMobileApp,
  BookPage,
  BookScreen,
  BookSite,
} from "./adapter";
import type { RouteFreshness } from "./findings";

/** The version of every book and collected JSON shape. Bumped only for a breaking change. */
export const BOOK_SCHEMA_VERSION = 1;

/** A route as a book entry or list shows it. */
export type BookRouteRef = {
  method: string;
  path: string;
  name: string | null;
};

/**
 * `grimoire/book/<mirror path>.json`: one per code file.
 * `src/app/auth/controllers/login.controller.ts` →
 * `grimoire/book/app/auth/controllers/login.controller.json`.
 */
export type BookEntry = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  /** The source file. */
  file: string;
  module: string;
  type: BookFileType;
  lines: number;
  /** The header sentence, or `null`. */
  about: string | null;
  /** The feature that owns the file, or `null`. */
  feature: string | null;
  /** Features that import the file without owning it. */
  borrowedBy: string[];
  /** `<feature>/<flow>` of every flow whose steps reach the file. */
  flows: string[];
  exports: { name: string; about: string | null }[];
  /** External packages it imports (`@warlock.js/core`, `dayjs`), by package name. */
  packages: string[];
  /** Project files it imports. */
  imports: string[];
  /** Project files that import it. */
  importedBy: string[];
  /**
   * Routes this file registers (`via: "registers"`, a routes file) or handles
   * (`via: "handles"`, the handler's file). Routes that only reach the file
   * through imports are answered by `scry --impact`, not stored here.
   */
  routes: (BookRouteRef & { via: "registers" | "handles" })[];
  /** Pages this file is the page, setup or layout file of: `<site> <route>`. */
  pages: { site: string; route: string; via: "page" | "setup" | "layout" }[];
  /** Mobile screens this file is the screen or layout file of. */
  screens: { app: string; route: string; via: "screen" | "layout" }[];
};

/** `grimoire/book/app/routes.json`: every route, grouped by the module of its routes file. */
export type BookRoutesFile = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  /** Module (`src/app/catalog`) → routes, in registration order. `(none)` holds routes with no source file. */
  modules: Record<string, (BookRouteRef & { handlerFile: string | null })[]>;
};

/** `grimoire/book/web/<site>.pages.json`: the pages of one site. */
export type BookSitePagesFile = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  site: BookSite;
  pages: BookPage[];
};

/** `grimoire/book/mobile/<app>.screens.json`: one mobile app and its screens. */
export type BookMobileScreensFile = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  app: Omit<BookMobileApp, "screens">;
  screens: BookScreen[];
};

/**
 * The data behind `grimoire/book/<module>/index.md`, the module summary.
 *
 * The Markdown is:
 *
 * ```md
 * # src/app/catalog
 *
 * Feature: catalog. 14 files, 820 lines.
 *
 * ## Files
 * - controllers/new-arrivals.controller.ts  controller  Answers the new arrivals request.
 *
 * ## Routes
 * - GET /products/new-arrivals
 *
 * ## Used by
 * - src/app/orders (3 files)
 * ```
 *
 * Sections with nothing in them are left out. Files are listed by path
 * relative to the module, in path order; the header sentence is omitted when
 * the file has none.
 */
export type BookModuleSummary = {
  module: string;
  /** Owning features of the module's files, most files first. */
  features: string[];
  files: { file: string; type: BookFileType; lines: number; about: string | null }[];
  routes: BookRouteRef[];
  /** Other modules importing files of this one, with how many of their files do. */
  usedBy: { module: string; files: number }[];
};

/** One source file as the manifest remembers it. */
export type BookManifestFile = {
  /** sha256 of the content (hex). */
  hash: string;
  /** Size and modification time, to skip hashing unchanged files. */
  size: number;
  mtimeMs: number;
  /** The book entry path (`grimoire/book/...json`), or `null` for a file with no entry. */
  entry: string | null;
};

/**
 * `grimoire/book/manifest.json`: the fingerprint that says whether the book is
 * fresh. The book is fresh when the grimoire version, adapter name and version
 * and `schemaVersion` match, the set of files under the source roots is the
 * same, every file's hash matches, and the written-files hash matches.
 */
export type BookManifest = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  /** `@warlock.js/grimoire` version that wrote the book. */
  grimoireVersion: string;
  adapter: { name: string; version: string };
  /** ISO time of the last build that changed anything. */
  builtAt: string;
  sourceRoots: string[];
  /** Every file under the source roots (code or not), by project-relative path. */
  files: Record<string, BookManifestFile>;
  /** Test files scanned for `@proves`, with their hashes. */
  tests: Record<string, string>;
  /** `WrittenGrimoire.hash` the ownership and book maps were built from. */
  writtenHash: string;
  /**
   * The cache of facts that need the app booted (routes, named things). It is
   * stale when any input's hash differs from the one stored here, or an input
   * was added or removed.
   */
  boot: {
    /** ISO time the routes were read, or `null` when never. */
    collectedAt: string | null;
    inputs: Record<string, string>;
  };
};

/**
 * `grimoire/book/.cache/facts.json`: the adapter's last answer, so a file-only
 * question never calls the adapter's `routes()` and loading the book reads one
 * file. Machine use only.
 */
export type BookFactsCache = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  facts: BookFacts;
};

/** The book as `loadBook()` returns it. */
export type LoadedBook = {
  /** Absolute project root. */
  root: string;
  manifest: BookManifest;
  facts: BookFacts;
  routes: RouteFreshness;
};

/** Options of `buildBook()`. */
export type BuildBookOptions = {
  /**
   * `fresh`: refresh stale route facts (may boot the app through the adapter).
   * `cached`: never boot; reuse cached route facts, reported `stale` when their
   * inputs changed and `missing` when there are none.
   * Default `cached`. `warlock grimoire build` and `check` pass `fresh`.
   */
  routes?: "fresh" | "cached";
  /** Rebuild every entry even when the manifest says the book is fresh. */
  force?: boolean;
  /** Clock for `builtAt`. */
  now?: () => Date;
};

/** What `buildBook()` did. */
export type BuildBookResult = {
  book: LoadedBook;
  /** `false` when the manifest matched: the adapter was not called and nothing was written. */
  rebuilt: boolean;
  /** Source files added, changed or removed since the previous manifest. */
  changed: string[];
};

/**
 * What the book entries need from the written files: owner, borrowers and
 * flows per source file. `openGrimoire()` computes it (ownership and book
 * maps) and hands it to `writeBook()`.
 */
export type BookAnnotations = {
  /** `WrittenGrimoire.hash` it was computed from; stored in the manifest. */
  writtenHash: string;
  /** Test file → sha256, stored in the manifest. */
  tests: Record<string, string>;
  files: Record<string, { feature: string | null; borrowedBy: string[]; flows: string[] }>;
};

/** What `writeBook()` wrote. Unchanged files are not rewritten. */
export type WriteBookResult = {
  /** Book files created or changed (entries, summaries, lists), project-relative. */
  written: string[];
  /** Book files removed because their source is gone. */
  removed: string[];
};

