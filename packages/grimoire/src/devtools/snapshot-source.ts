/**
 * Where the panel's routes get the snapshot: opened once with
 * `routes: "cached"` (a devtools request never boots the app) and kept in
 * memory. Concurrent requests share one open. A change stamp (the book
 * manifest plus the agent-written folders and indexes, a few `stat` calls and
 * no directory walk) tells when the book changed.
 *
 * - Production (`mode: "production"`): a snapshot is reused until the stamp
 *   changes, with no time limit, unless `ttlMs` is set. A request that finds
 *   the stamp changed waits for the new open. `warm()` opens the book ahead
 *   of the first request.
 * - Development: the snapshot is reused for a short window (2 s, or five times
 *   the last open when that is longer, so a slow open on a large app is not
 *   repeated on every view; written files change while an agent works). A
 *   request that finds the stamp changed waits for the new open. After the
 *   window, with the stamp unchanged (a file edited in place), the cached
 *   snapshot is served at once and one background open refreshes it (stale
 *   while revalidate).
 *
 * An open that fails keeps serving the old snapshot; its error surfaces on a
 * request only when there is no snapshot at all. The panel passes
 * `write: true` in development, so the generated book stays current and the
 * next open is incremental; with `write: false` a stored book behind the
 * sources is rebuilt in memory on every open.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { GRIMOIRE_PATHS } from "../paths";
import { openGrimoire } from "../workspace";

/** Options of the panel's snapshot source. */
export type SnapshotSourceOptions = {
  /** The adapter, or a function that loads it. Default: the Warlock adapter, imported on first use. */
  adapter?: BookAdapter | (() => Promise<BookAdapter>);
  /**
   * How long a snapshot is reused when the book did not change (ms).
   * Default in development: 2000, or five times as long as the last open took
   * when that is longer. Default in production: no limit (reused until the
   * book changes).
   */
  ttlMs?: number;
  /** Where the source runs. `"production"` keeps a snapshot until the book changes. Default: `"development"`. */
  mode?: "development" | "production";
  /** Let `openGrimoire` write the generated book and collected files (never agent-written files). Default `false`; the devtools panel passes `true`. */
  write?: boolean;
};

/** A cached, shared snapshot of one project. */
export type SnapshotSource = {
  get(): Promise<GrimoireSnapshot>;
  /** Forget the cached snapshot; the next `get()` opens again. */
  invalidate(): void;
  /** Start opening the book now, so the first `get()` is fast. Failures are ignored here and surface on `get()`. */
  warm(): void;
  /** Resolves when no open is running (specs and shutdown). Never rejects. */
  idle(): Promise<void>;
};

/** Files and folders whose modified time moves when the book or an agent-written file is added, removed or regenerated. */
const STAMPED = [
  GRIMOIRE_PATHS.bookManifest,
  GRIMOIRE_PATHS.featuresIndex,
  GRIMOIRE_PATHS.tasksIndex,
  GRIMOIRE_PATHS.features,
  GRIMOIRE_PATHS.apps,
  GRIMOIRE_PATHS.openTasks,
  GRIMOIRE_PATHS.doneTasks,
  GRIMOIRE_PATHS.releases,
];

async function changeStamp(root: string): Promise<string> {
  const times = await Promise.all(
    STAMPED.map(async (entry) => {
      try {
        return (await stat(path.join(root, ...entry.split("/")))).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );

  return times.join(",");
}

async function loadAdapter(option: SnapshotSourceOptions["adapter"]): Promise<BookAdapter> {
  if (option === undefined) {
    const { createWarlockAdapter } = await import("../warlock");

    return createWarlockAdapter();
  }

  return typeof option === "function" ? option() : option;
}

/** Create the source for the project at `root`. */
export function createSnapshotSource(
  root: string,
  options: SnapshotSourceOptions = {},
): SnapshotSource {
  let cached: { snapshot: GrimoireSnapshot; at: number; stamp: string; took: number } | null = null;
  let opening: Promise<GrimoireSnapshot> | null = null;

  const keepUntilChanged = options.mode === "production" && options.ttlMs === undefined;
  const reuseFor = (took: number): number => options.ttlMs ?? Math.max(2000, took * 5);

  async function open(): Promise<GrimoireSnapshot> {
    const started = Date.now();
    const adapter = await loadAdapter(options.adapter);
    const snapshot = await openGrimoire(root, adapter, {
      routes: "cached",
      write: options.write ?? false,
    });

    const at = Date.now();

    cached = { snapshot, at, stamp: await changeStamp(root), took: at - started };

    return snapshot;
  }

  /** The open in flight, or a new one; concurrent callers share it. */
  function ensureOpening(): Promise<GrimoireSnapshot> {
    opening ??= open().finally(() => {
      opening = null;
    });

    return opening;
  }

  return {
    async get() {
      if (cached === null) return ensureOpening();

      const known = cached;
      const changed = (await changeStamp(root)) !== known.stamp;

      if (changed || options.mode === "production") {
        if (!changed && (keepUntilChanged || Date.now() - known.at < reuseFor(known.took))) {
          return known.snapshot;
        }

        // A failed open keeps the old snapshot; the next request tries again.
        return ensureOpening().catch(() => known.snapshot);
      }

      if (Date.now() - known.at < reuseFor(known.took)) return known.snapshot;

      // Development, nothing known to have changed: serve the old snapshot now and refresh behind it.
      ensureOpening().catch(() => {});

      return known.snapshot;
    },
    invalidate() {
      cached = null;
    },
    warm() {
      if (cached === null) ensureOpening().catch(() => {});
    },
    async idle() {
      await opening?.catch(() => {});
    },
  };
}
