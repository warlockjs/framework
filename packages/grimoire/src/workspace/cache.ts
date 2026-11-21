/**
 * Keeps the opened book in memory between calls of one process (the MCP
 * server answers many questions per process) and says cheaply whether it is
 * still current.
 *
 * Freshness is a stamp of `stat` results, no file is read: the size and
 * modified time of every code and test file the book lists, the modified time
 * of each folder that holds one and of every folder above it up to the project root (a new or removed file moves its
 * folder; a new module folder moves its parent), every
 * file under the written folders (`grimoire/features`, `apps`, `releases`,
 * `tasks`, `screenshots`), the book manifest, the test results file and
 * `package.json`. A stamp that equals the one taken after the last open
 * returns the same snapshot; any difference opens the book again.
 */
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot, OpenGrimoireOptions } from "../contracts/snapshot";
import { GRIMOIRE_PATHS } from "../paths";
import { resolveResultsFile } from "../test-results";
import { DERIVED_PATH } from "./derived";
import { openGrimoire } from "./index";
import { openStoredGrimoire } from "./stored";

/** The written folders whose every file is part of the stamp. */
const WRITTEN_TREES = [
  GRIMOIRE_PATHS.features,
  GRIMOIRE_PATHS.apps,
  GRIMOIRE_PATHS.releases,
  GRIMOIRE_PATHS.tasks,
  GRIMOIRE_PATHS.screenshots,
];

const STAT_BATCH = 256;

async function statLine(absolute: string, withSize: boolean): Promise<string> {
  try {
    const info = await stat(absolute);

    return withSize ? `${info.size}:${info.mtimeMs}` : String(info.mtimeMs);
  } catch {
    return "-";
  }
}

async function statAll(files: readonly string[], withSize: boolean): Promise<string[]> {
  const lines: string[] = [];

  for (let start = 0; start < files.length; start += STAT_BATCH) {
    lines.push(
      ...(await Promise.all(
        files.slice(start, start + STAT_BATCH).map((file) => statLine(file, withSize)),
      )),
    );
  }

  return lines;
}

/** Every file below `folder` (absolute paths, sorted); a missing folder gives none. */
async function filesUnder(folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;

    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const next = path.join(current, entry.name);

      if (entry.isDirectory()) await walk(next);
      else found.push(next);
    }
  };

  await walk(folder);

  return found.sort();
}

/**
 * The freshness stamp of a project, from the files of `snapshot` (its code and
 * test files) and the written folders as they are now. Reads no file content.
 */
export async function stampOf(
  root: string,
  snapshot: GrimoireSnapshot,
  testResultsFile?: string,
): Promise<string> {
  return (await takeStamp(root, snapshot, testResultsFile)).stamp;
}

/**
 * The stat lines of a stamp hold `size:mtime` or `mtime`; the newest mtime of them that is not after `until`
 * (a time in the future is clock skew, not an edit), 0 when none.
 */
function newestOf(lines: readonly string[], until: number): number {
  let newest = 0;

  for (const line of lines) {
    const value = Number(line.split(":").pop());

    if (Number.isFinite(value) && value <= until && value > newest) newest = value;
  }

  return newest;
}

/** Every folder above `folder` up to (not including) the project root. */
function withAncestors(folders: readonly string[]): string[] {
  const all = new Set<string>();

  for (const folder of folders) {
    let current = folder;

    while (current !== "." && current !== "" && current !== "/") {
      all.add(current);
      current = path.posix.dirname(current.split(path.sep).join("/"));
    }
  }

  return [...all].sort();
}

/** The stamp, and the newest modified time among the code, test and written files and their folders. */
async function takeStamp(
  root: string,
  snapshot: GrimoireSnapshot,
  testResultsFile?: string,
): Promise<{ stamp: string; newest: number }> {
  const listed = [
    ...snapshot.book.facts.files.map((file) => file.file),
    ...snapshot.book.facts.tests,
  ];
  const folders = withAncestors([...new Set(listed.map((file) => path.dirname(file)))]);
  const written = (
    await Promise.all(WRITTEN_TREES.map((tree) => filesUnder(path.join(root, ...tree.split("/")))))
  ).flat();
  const singles = [
    path.join(root, ...GRIMOIRE_PATHS.bookManifest.split("/")),
    path.join(root, ...GRIMOIRE_PATHS.bookRoutes.split("/")),
    path.join(root, ...DERIVED_PATH.split("/")),
    resolveResultsFile(root, testResultsFile),
    path.join(root, "package.json"),
  ];
  const [fileLines, folderLines, writtenLines, singleLines] = await Promise.all([
    statAll(
      listed.map((file) => path.join(root, ...file.split("/"))),
      true,
    ),
    statAll(
      folders.map((folder) => path.join(root, ...folder.split(path.sep))),
      false,
    ),
    statAll(written, true),
    statAll(singles, true),
  ]);

  const stamp = createHash("sha1")
    .update(
      JSON.stringify([listed, fileLines, folders, folderLines, written, writtenLines, singleLines]),
    )
    .digest("hex");

  return { stamp, newest: newestOf([...fileLines, ...folderLines, ...writtenLines], Date.now()) };
}

type Entry = { snapshot: GrimoireSnapshot; stamp: string };

/** What a cached open is asked with; two different asks never share an entry. */
function keyOf(root: string, options: OpenGrimoireOptions): string {
  return JSON.stringify([root, options.write !== false, options.testResultsFile ?? null]);
}

/** A book cache: `open()` returns the kept snapshot while the stamp holds. */
export type BookCache = {
  /** The snapshot for `root`: kept when nothing changed, else opened again. `force`, or `routes: "fresh"`, always opens. */
  open(
    root: string,
    adapter: BookAdapter,
    options?: OpenGrimoireOptions,
  ): Promise<GrimoireSnapshot>;
  /** Forget everything kept. */
  clear(): void;
};

/**
 * Create a cache. `reopen` is how the book is opened (default `openGrimoire`);
 * specs pass a counter to see how many times the book was really opened.
 */
export function createBookCache(reopen: typeof openGrimoire = openGrimoire): BookCache {
  const kept = new Map<string, Entry>();
  const opening = new Map<string, Promise<GrimoireSnapshot>>();
  // Opens that write the book's files wait for each other, per project.
  const writing = new Map<string, Promise<unknown>>();

  const openOnce = async (
    key: string,
    root: string,
    adapter: BookAdapter,
    options: OpenGrimoireOptions,
  ): Promise<GrimoireSnapshot> => {
    // The clock is read before the open, so a file edited while it ran is seen as newer than the stamp.
    const startedAt = Date.now();
    const snapshot = await reopen(root, adapter, options);
    const { stamp, newest } = await takeStamp(root, snapshot, options.testResultsFile);

    // A change after the start may not be in the snapshot: keep it unstamped so the next call opens again.
    kept.set(key, {
      snapshot,
      stamp: newest > startedAt ? `unsettled:${stamp}` : stamp,
    });

    return snapshot;
  };

  return {
    async open(root, adapter, options = {}) {
      const key = keyOf(root, options);
      const known = kept.get(key);
      const mustOpen = options.force === true || options.routes === "fresh";

      if (known !== undefined && !mustOpen) {
        const stamp = await stampOf(root, known.snapshot, options.testResultsFile);

        if (stamp === known.stamp) return known.snapshot;
      }

      // Concurrent callers wait for the same open.
      const running = opening.get(key);

      if (running !== undefined && !mustOpen) return running;

      let started: Promise<GrimoireSnapshot>;

      if (options.write === false) {
        started = openOnce(key, root, adapter, options);
      } else {
        const before = writing.get(root) ?? Promise.resolve();

        started = before.catch(() => undefined).then(() => openOnce(key, root, adapter, options));
        writing.set(root, started);
        started
          .catch(() => undefined)
          .finally(() => {
            if (writing.get(root) === started) writing.delete(root);
          });
      }

      const tracked = started.finally(() => {
        if (opening.get(key) === tracked) opening.delete(key);
      });

      opening.set(key, tracked);

      return tracked;
    },
    clear() {
      kept.clear();
    },
  };
}

/** The process-wide cache the MCP tools and `warlock scry` use. */
export const openedBooks: BookCache = createBookCache();

/** `openGrimoire` that keeps the book in memory while nothing changed. */
export function openGrimoireCached(
  root: string,
  adapter: BookAdapter,
  options: OpenGrimoireOptions = {},
): Promise<GrimoireSnapshot> {
  return openedBooks.open(root, adapter, options);
}

/** The same cache over the read-only open (`openStoredGrimoire`): never builds, never writes. */
export const storedBooks: BookCache = createBookCache(openStoredGrimoire);

/** `openStoredGrimoire` that keeps the book in memory while nothing changed. */
export function openStoredGrimoireCached(
  root: string,
  adapter: BookAdapter,
  options: OpenGrimoireOptions = {},
): Promise<GrimoireSnapshot> {
  return storedBooks.open(root, adapter, { ...options, write: false });
}
