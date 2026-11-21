/**
 * `buildBook` and `loadBook`: the freshness fingerprint, the facts cache and
 * the route (boot) cache. Entries are written by `writeBook` (write.ts).
 */
import { readFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import type { BookAdapter, BookFacts, BookFile } from "../contracts/adapter";
import {
  BOOK_SCHEMA_VERSION,
  type BookFactsCache,
  type BookManifest,
  type BookManifestFile,
  type BuildBookOptions,
  type BuildBookResult,
  type LoadedBook,
} from "../contracts/book";
import type { RouteFreshness } from "../contracts/findings";
import { GrimoireError } from "../codes";
import { importClosure, fileGraph } from "../graph";
import { GRIMOIRE_PATHS, isCodeFile, isInsideFolder } from "../paths";
import {
  cleanFolder,
  hashFile,
  hashIfExists,
  IO_CONCURRENCY,
  isMissing,
  listFiles,
  mapLimit,
  readJson,
  toJson,
  writeBookFile,
} from "./io";
import {
  cleanPath,
  normalizeFiles,
  normalizeMobile,
  normalizeNamed,
  normalizePages,
  normalizeRoutes,
  normalizeSites,
} from "./normalize";
import { entryPathsFor } from "./render";

/** Where `writeBook` remembers what it wrote (see write.ts). */
export const WRITE_STATE_PATH = `${GRIMOIRE_PATHS.book}/.cache/written.json`;

let cachedVersion: string | null = null;

/** The `@warlock.js/grimoire` version, from its package.json. */
export function grimoireVersion(): string {
  if (cachedVersion !== null) return cachedVersion;

  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      version?: unknown;
    };
    cachedVersion = typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }

  return cachedVersion;
}

const absolutePath = (root: string, file: string): string => path.join(root, ...file.split("/"));

type StoredBook = { manifest: BookManifest; facts: BookFacts };

/**
 * `facts.json` as written since type-only import edges were recorded. A cache
 * without the marker comes from an older version: it is not reused, so file
 * facts are scanned once more.
 */
type StoredFactsCache = BookFactsCache & { typeOnlyEdges?: boolean };

async function readStoredBook(root: string): Promise<StoredBook | null> {
  const manifest = await readJson<BookManifest>(absolutePath(root, GRIMOIRE_PATHS.bookManifest));
  const cache = await readJson<StoredFactsCache>(absolutePath(root, GRIMOIRE_PATHS.bookFactsCache));

  if (
    manifest === null ||
    cache === null ||
    manifest.schemaVersion !== BOOK_SCHEMA_VERSION ||
    cache.schemaVersion !== BOOK_SCHEMA_VERSION ||
    cache.typeOnlyEdges !== true ||
    typeof manifest.files !== "object" ||
    typeof cache.facts !== "object"
  ) {
    return null;
  }

  return { manifest, facts: cache.facts };
}

/** The current state of every code file under the source roots (images, fonts and certificates are not part of the book). */
type Scan = {
  files: Record<string, Omit<BookManifestFile, "entry">>;
  /** A file kept its hash but its size or mtime moved: the manifest needs the new stat. */
  statMoved: boolean;
};

/** Stat every code file; hash only those whose size or mtime differ from the previous manifest. */
async function scanSourceRoots(
  root: string,
  sourceRoots: readonly string[],
  previous: Record<string, BookManifestFile>,
): Promise<Scan> {
  let files: string[];

  try {
    files = (await listFiles(root, sourceRoots)).filter(isCodeFile);
  } catch (error) {
    throw new GrimoireError(
      "GR8001",
      `The source roots could not be read: ${(error as Error).message}`,
    );
  }

  let statMoved = false;
  const states = await mapLimit(files, IO_CONCURRENCY, async (file) => {
    const absolute = absolutePath(root, file);

    try {
      const info = await stat(absolute);
      const before = previous[file];

      if (before !== undefined && before.size === info.size && before.mtimeMs === info.mtimeMs) {
        return { file, hash: before.hash, size: info.size, mtimeMs: info.mtimeMs };
      }

      const hash = await hashFile(absolute, info.size);

      if (before !== undefined && before.hash === hash) statMoved = true;

      return { file, hash, size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      // Deleted between the walk and the stat: treat it as gone.
      if (isMissing(error)) return null;
      throw new GrimoireError("GR8001", `${file} could not be read: ${(error as Error).message}`);
    }
  });
  const result: Scan["files"] = {};

  for (const state of states) {
    if (state !== null)
      result[state.file] = { hash: state.hash, size: state.size, mtimeMs: state.mtimeMs };
  }

  return { files: result, statMoved };
}

/** Hashes of the given files: from the scan when inside the source roots, else read (`""` when missing). */
async function hashFiles(
  root: string,
  files: readonly string[],
  scan: Scan["files"],
  sourceRoots: readonly string[],
): Promise<Record<string, string>> {
  const hashes = await mapLimit([...new Set(files)].sort(), IO_CONCURRENCY, async (file) => {
    const scanned = scan[file];

    if (scanned !== undefined) return [file, scanned.hash] as const;
    // A code file inside a source root that the scan did not find is gone; any other input (a JSON config) is read.
    if (
      isCodeFile(file) &&
      sourceRoots.some((folder) => folder === "." || isInsideFolder(file, folder))
    )
      return [file, ""] as const;

    return [file, await hashIfExists(root, file)] as const;
  });

  return Object.fromEntries(hashes);
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);

  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => right[key] === left[key])
  );
}

/** Source files added, changed or removed between two manifests, sorted. */
function changedFiles(
  previous: Record<string, BookManifestFile>,
  current: Scan["files"],
): string[] {
  const changed: string[] = [];

  for (const [file, state] of Object.entries(current)) {
    if (previous[file]?.hash !== state.hash) changed.push(file);
  }

  for (const file of Object.keys(previous)) {
    if (current[file] === undefined) changed.push(file);
  }

  return changed.sort();
}

const NAMED_FILE_TYPES = new Set(["mail", "job", "event"]);

/**
 * Files whose change makes the route cache stale: every `routes` file and
 * everything it imports, every `config` file, `warlock.config.ts`,
 * `package.json`, and every mail, job, event and notification file (the
 * named things are cached with the routes).
 */
export function defaultRouteInputs(files: readonly BookFile[]): string[] {
  const routesFiles = files.filter((file) => file.type === "routes").map((file) => file.file);
  const inputs = new Set(importClosure(fileGraph(files), routesFiles));

  for (const file of files) {
    if (
      file.type === "config" ||
      NAMED_FILE_TYPES.has(file.type) ||
      /\.notification\.[^/]+$/.test(file.file)
    ) {
      inputs.add(file.file);
    }
  }

  inputs.add("warlock.config.ts");
  inputs.add("package.json");

  return [...inputs].sort();
}

/** The route cache's input files: the adapter's list when it has one, else the default. */
async function routeInputFiles(
  root: string,
  adapter: BookAdapter,
  files: readonly BookFile[],
): Promise<string[]> {
  return adapter.routeInputs
    ? (await adapter.routeInputs(root, files)).map(cleanPath)
    : defaultRouteInputs(files);
}

const hasBootFacts = (adapter: BookAdapter): boolean =>
  typeof adapter.routes === "function" || typeof adapter.named === "function";

async function collectBootFacts(
  root: string,
  adapter: BookAdapter,
): Promise<Pick<BookFacts, "routes" | "named">> {
  try {
    return {
      routes: adapter.routes ? normalizeRoutes(await adapter.routes(root)) : null,
      named: adapter.named ? normalizeNamed(await adapter.named(root)) : [],
    };
  } catch (error) {
    if (error instanceof GrimoireError) throw error;
    throw new GrimoireError("GR8002", `Route facts could not be read: ${(error as Error).message}`);
  }
}

/** How the stored route facts relate to the current inputs. */
function bootState(
  boot: BookManifest["boot"],
  routes: BookFacts["routes"],
  inputs: Record<string, string>,
): "fresh" | "stale" | "missing" {
  if (boot.collectedAt === null || routes === null) return "missing";

  return sameRecord(boot.inputs, inputs) ? "fresh" : "stale";
}

/** A fresh read that found under half the routes the book already holds is not trusted over the stored list. */
function shrankTooFar(stored: BookFacts["routes"], read: BookFacts["routes"]): boolean {
  return stored !== null && read !== null && stored.length > 0 && read.length * 2 < stored.length;
}

const shrankNote = (kept: number, read: number): string =>
  `a live read found ${read} routes against the ${kept} stored; kept the stored routes; run warlock grimoire build`;

async function writeStoredBook(
  root: string,
  manifest: BookManifest,
  facts: BookFacts | null,
): Promise<void> {
  if (facts !== null) {
    const cache: StoredFactsCache = {
      schemaVersion: BOOK_SCHEMA_VERSION,
      typeOnlyEdges: true,
      facts,
    };
    await writeBookFile(root, GRIMOIRE_PATHS.bookFactsCache, toJson(cache));
  }

  // The manifest last: a reader that sees it also sees the facts it describes.
  await writeBookFile(root, GRIMOIRE_PATHS.bookManifest, toJson(manifest));
}

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
  const projectRoot = path.resolve(root);
  const mode = options.routes ?? "cached";
  const now = options.now ?? (() => new Date());
  // `write: false` (passed by `openGrimoire({ write: false })`) computes in memory only.
  const write = options.write !== false;
  const sourceRoots = [
    ...new Set((await adapter.sourceRoots(projectRoot)).map(cleanFolder)),
  ].sort();
  const stored = await readStoredBook(projectRoot);
  const previousFiles = stored?.manifest.files ?? {};
  const scan = await scanSourceRoots(projectRoot, sourceRoots, previousFiles);
  const version = grimoireVersion();

  // ── The fast path: nothing under the source roots (or the tests) changed. ──
  if (stored !== null && options.force !== true) {
    const { manifest, facts } = stored;
    const sameSetup =
      manifest.grimoireVersion === version &&
      manifest.adapter.name === adapter.name &&
      manifest.adapter.version === adapter.version &&
      manifest.sourceRoots.length === sourceRoots.length &&
      manifest.sourceRoots.every((folder, index) => folder === sourceRoots[index]);
    const sameFiles =
      sameSetup &&
      Object.keys(previousFiles).length === Object.keys(scan.files).length &&
      Object.entries(scan.files).every(([file, state]) => previousFiles[file]?.hash === state.hash);
    const sameTests =
      sameFiles &&
      sameRecord(
        manifest.tests,
        await hashFiles(projectRoot, Object.keys(manifest.tests), scan.files, sourceRoots),
      );

    if (sameTests) {
      const inputs = await hashFiles(
        projectRoot,
        Object.keys(manifest.boot.inputs),
        scan.files,
        sourceRoots,
      );
      let routes: RouteFreshness = hasBootFacts(adapter)
        ? bootState(manifest.boot, facts.routes, inputs)
        : "missing";
      let changedBook = false;
      let routeNote: string | undefined;

      if (mode === "fresh" && hasBootFacts(adapter) && routes !== "fresh") {
        // The stored input list can be older than the files (a cached rebuild keeps it): work it out again.
        const current = await hashFiles(
          projectRoot,
          await routeInputFiles(projectRoot, adapter, facts.files),
          scan.files,
          sourceRoots,
        );
        const read = await collectBootFacts(projectRoot, adapter);

        if (shrankTooFar(facts.routes, read.routes)) {
          routeNote = shrankNote(facts.routes?.length ?? 0, read.routes?.length ?? 0);
          routes = "stale";
        } else {
          Object.assign(facts, read);
          manifest.boot = {
            collectedAt: now().toISOString(),
            inputs: current,
            counts: { routes: read.routes?.length ?? 0, pages: facts.pages.length },
          };
          routes = "fresh";
          changedBook = true;
        }
      }

      if (changedBook || scan.statMoved) {
        for (const [file, state] of Object.entries(scan.files)) {
          manifest.files[file] = { ...state, entry: manifest.files[file]?.entry ?? null };
        }

        if (changedBook) manifest.builtAt = now().toISOString();

        if (write) await writeStoredBook(projectRoot, manifest, changedBook ? facts : null);
      }

      return {
        book: { root: projectRoot, manifest, facts, routes, ...(routeNote ? { routeNote } : {}) },
        rebuilt: changedBook,
        changed: [],
      };
    }
  }

  // ── Rebuild the static facts. ──
  let files: BookFile[];

  try {
    files = normalizeFiles(await adapter.files(projectRoot));
  } catch (error) {
    if (error instanceof GrimoireError) throw error;
    throw new GrimoireError(
      "GR8001",
      `The source files could not be read: ${(error as Error).message}`,
    );
  }

  let staticFacts: Omit<BookFacts, "files" | "routes" | "named">;

  try {
    staticFacts = {
      sites: adapter.sites ? normalizeSites(await adapter.sites(projectRoot)) : [],
      pages: adapter.pages ? normalizePages(await adapter.pages(projectRoot)) : [],
      mobile: adapter.mobile ? normalizeMobile(await adapter.mobile(projectRoot)) : [],
      tests: adapter.tests
        ? (await adapter.tests(projectRoot)).map(cleanPath)
        : files.filter((file) => file.type === "spec").map((file) => file.file),
    };
  } catch (error) {
    if (error instanceof GrimoireError) throw error;
    throw new GrimoireError(
      "GR8004",
      `Pages or screens could not be read: ${(error as Error).message}`,
    );
  }

  staticFacts.tests = [...new Set(staticFacts.tests)].sort();

  const inputs = await hashFiles(
    projectRoot,
    await routeInputFiles(projectRoot, adapter, files),
    scan.files,
    sourceRoots,
  );
  const previousBoot = stored?.manifest.boot ?? { collectedAt: null, inputs: {} };
  let boot = previousBoot;
  let routeNote: string | undefined;
  let bootFacts: Pick<BookFacts, "routes" | "named"> = {
    routes: stored?.facts.routes ?? null,
    named: stored?.facts.named ?? [],
  };
  let routes: RouteFreshness = hasBootFacts(adapter)
    ? bootState(previousBoot, bootFacts.routes, inputs)
    : "missing";

  if (mode === "fresh" && hasBootFacts(adapter) && (routes !== "fresh" || options.force === true)) {
    const read = await collectBootFacts(projectRoot, adapter);

    if (shrankTooFar(bootFacts.routes, read.routes)) {
      routeNote = shrankNote(bootFacts.routes?.length ?? 0, read.routes?.length ?? 0);
      routes = "stale";
    } else {
      bootFacts = read;
      boot = {
        collectedAt: now().toISOString(),
        inputs,
        counts: { routes: read.routes?.length ?? 0, pages: staticFacts.pages.length },
      };
      routes = "fresh";
    }
  }

  const facts: BookFacts = { files, ...bootFacts, ...staticFacts };
  const entries = entryPathsFor(facts);
  const manifest: BookManifest = {
    schemaVersion: BOOK_SCHEMA_VERSION,
    grimoireVersion: version,
    adapter: { name: adapter.name, version: adapter.version },
    builtAt: now().toISOString(),
    sourceRoots,
    files: Object.fromEntries(
      Object.entries(scan.files).map(([file, state]) => [
        file,
        { ...state, entry: entries.get(file) ?? null },
      ]),
    ),
    tests: await hashFiles(projectRoot, facts.tests, scan.files, sourceRoots),
    writtenHash: stored?.manifest.writtenHash ?? "",
    boot,
  };

  // A forced build rewrites every entry: forget what `writeBook` wrote.
  if (write) {
    if (options.force === true)
      await rm(absolutePath(projectRoot, WRITE_STATE_PATH), { force: true });

    await writeStoredBook(projectRoot, manifest, facts);
  }

  return {
    book: { root: projectRoot, manifest, facts, routes, ...(routeNote ? { routeNote } : {}) },
    rebuilt: true,
    changed: changedFiles(previousFiles, scan.files),
  };
}

/** Read the book from disk without calling an adapter; `null` when it was never built. */
export async function loadBook(root: string): Promise<LoadedBook | null> {
  const projectRoot = path.resolve(root);
  const stored = await readStoredBook(projectRoot);

  if (stored === null) return null;

  return {
    root: projectRoot,
    manifest: stored.manifest,
    facts: stored.facts,
    // Not checked against the sources here; `buildBook` tells fresh from stale.
    routes: stored.facts.routes === null ? "missing" : "cached",
  };
}

/** What `checkBook` found: the stored book, and how far the files have moved from it. */
export type BookCheck = {
  /** The stored book, with its route freshness measured against the files as they are now. */
  book: LoadedBook;
  /** Code and test files added, changed or removed since the last build, sorted. */
  changed: string[];
};

/**
 * The cheap change check of `buildBook` with nothing rebuilt and nothing
 * written: scans the source roots (hashing only files whose size or time
 * moved) and compares them, and the tests, with the manifest. The adapter is
 * asked for its source roots only, never for files or route facts. `null`
 * when the book was never built (or was written by an older schema).
 *
 * @param root Absolute project root.
 */
export async function checkBook(root: string, adapter: BookAdapter): Promise<BookCheck | null> {
  const projectRoot = path.resolve(root);
  const stored = await readStoredBook(projectRoot);

  if (stored === null) return null;

  const { manifest, facts } = stored;
  const sourceRoots = [
    ...new Set((await adapter.sourceRoots(projectRoot)).map(cleanFolder)),
  ].sort();
  const scan = await scanSourceRoots(projectRoot, sourceRoots, manifest.files);
  const changed = new Set(changedFiles(manifest.files, scan.files));
  const tests = await hashFiles(projectRoot, Object.keys(manifest.tests), scan.files, sourceRoots);

  for (const [file, hash] of Object.entries(tests)) {
    if (manifest.tests[file] !== hash) changed.add(file);
  }

  const inputs = await hashFiles(
    projectRoot,
    Object.keys(manifest.boot.inputs),
    scan.files,
    sourceRoots,
  );
  const routes: RouteFreshness = hasBootFacts(adapter)
    ? bootState(manifest.boot, facts.routes, inputs)
    : "missing";

  return {
    book: { root: projectRoot, manifest, facts, routes },
    changed: [...changed].sort(),
  };
}
