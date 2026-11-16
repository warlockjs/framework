/**
 * Where the panel's routes get the snapshot: opened once with
 * `routes: "cached"` (a devtools request never boots the app), kept in
 * memory, and opened again when the book manifest changed or the copy is a
 * few seconds old (the written files change while an agent works).
 * Concurrent requests share one open. The panel passes `write: true`, so the
 * generated book stays current and the next open is incremental; with
 * `write: false` a stored book behind the sources is rebuilt in memory on
 * every open, and a slow open widens the reuse window.
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
   * How long a snapshot is reused when the manifest did not change (ms).
   * Default: 2000, or five times as long as the last open took when that is
   * longer, so a slow open (a large app whose stored book is behind its
   * sources) is not repeated on every view.
   */
  ttlMs?: number;
  /** Let `openGrimoire` write the generated book and collected files (never agent-written files). Default `false`; the devtools panel passes `true`. */
  write?: boolean;
};

/** A cached, shared snapshot of one project. */
export type SnapshotSource = {
  get(): Promise<GrimoireSnapshot>;
  /** Forget the cached snapshot; the next `get()` opens again. */
  invalidate(): void;
};

async function manifestStamp(root: string): Promise<number> {
  try {
    return (await stat(path.join(root, ...GRIMOIRE_PATHS.bookManifest.split("/")))).mtimeMs;
  } catch {
    return 0;
  }
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
  let cached: { snapshot: GrimoireSnapshot; at: number; stamp: number; took: number } | null = null;
  let opening: Promise<GrimoireSnapshot> | null = null;

  const reuseFor = (took: number): number => options.ttlMs ?? Math.max(2000, took * 5);

  async function open(): Promise<GrimoireSnapshot> {
    const started = Date.now();
    const adapter = await loadAdapter(options.adapter);
    const snapshot = await openGrimoire(root, adapter, {
      routes: "cached",
      write: options.write ?? false,
    });

    const at = Date.now();

    cached = { snapshot, at, stamp: await manifestStamp(root), took: at - started };

    return snapshot;
  }

  return {
    async get() {
      if (opening !== null) return opening;

      if (
        cached !== null &&
        Date.now() - cached.at < reuseFor(cached.took) &&
        (await manifestStamp(root)) === cached.stamp
      ) {
        return cached.snapshot;
      }

      // Another request may have started an open while this one read the manifest.
      if (opening !== null) return opening;

      opening = open().finally(() => {
        opening = null;
      });

      return opening;
    },
    invalidate() {
      cached = null;
    },
  };
}
