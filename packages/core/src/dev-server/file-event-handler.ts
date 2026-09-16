import events from "@mongez/events";
import type { DependencyGraph } from "./dependency-graph";
import { devLogSuccess } from "./dev-logger";
import type { FileManager } from "./file-manager";
import type { FileOperations } from "./file-operations";
import { FILE_PROCESSING_BATCH_SIZE, isTimingsEnabled } from "./flags";
import type { ManifestManager } from "./manifest-manager";
import { clearFileExistsCache } from "./parse-imports";
import { Path } from "../utils/normalized-path";

/** Lets an isolated editor save reach HMR without the former fixed 50ms delay. */
const ISOLATED_SAVE_QUIET_WINDOW_MS = 12;

/** Bounds a sustained formatter or checkout stream so it cannot postpone HMR forever. */
const BATCH_MAX_WAIT_MS = 60;

/**
 * Receives raw watcher events and processes them in a single debounced batch.
 * Order within a batch: adds → changes → deletes, so changes can reference
 * newly-added files and deletes fire last.
 */
export class FileEventHandler {
  private pendingChanges = new Set<string>();
  private pendingAdds = new Set<string>();
  private pendingDeletes = new Set<string>();

  /** When this batch's first watcher event arrived — the debounce-wait phase start. */
  private batchStartedAt?: number;

  /** Slowest watcher-settle duration seen so far this batch, when `devServer.timings` is on. */
  private watcherSettleMs?: number;

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private maxWaitTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly fileOperations: FileOperations,
    private readonly manifest: ManifestManager,
    private readonly dependencyGraph: DependencyGraph,
    private readonly files: Map<string, FileManager>,
  ) {}

  public handleFileChange(absolutePath: string, settleMs?: number): void {
    this.recordTimingStart(settleMs);
    this.pendingChanges.add(Path.toRelative(absolutePath));
    this.schedulePendingEvents();
  }

  public handleFileAdd(absolutePath: string, settleMs?: number): void {
    this.recordTimingStart(settleMs);
    this.pendingAdds.add(Path.toRelative(absolutePath));
    this.schedulePendingEvents();
  }

  public handleFileDelete(absolutePath: string, settleMs?: number): void {
    this.recordTimingStart(settleMs);
    this.pendingDeletes.add(Path.toRelative(absolutePath));
    this.schedulePendingEvents();
  }

  private schedulePendingEvents(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => this.flushPendingEvents(), ISOLATED_SAVE_QUIET_WINDOW_MS);

    if (this.maxWaitTimer === undefined) {
      this.maxWaitTimer = setTimeout(() => this.flushPendingEvents(), BATCH_MAX_WAIT_MS);
    }
  }

  private flushPendingEvents(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.maxWaitTimer !== undefined) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }

    void this.processBatch();
  }

  /**
   * Mark the debounce-wait phase start on the first event of a batch, and
   * track the slowest watcher-settle duration seen this batch. `settleMs`
   * only arrives when `devServer.timings` is on (see `FilesWatcher`), so
   * this is a no-op past the cheap `performance.now()` call when it's off.
   */
  private recordTimingStart(settleMs?: number): void {
    if (this.batchStartedAt === undefined) {
      this.batchStartedAt = performance.now();
    }

    if (settleMs === undefined) return;

    this.watcherSettleMs =
      this.watcherSettleMs === undefined ? settleMs : Math.max(this.watcherSettleMs, settleMs);
  }

  private async processBatch(): Promise<void> {
    const changes = Array.from(this.pendingChanges);
    const adds = Array.from(this.pendingAdds);
    const deletes = Array.from(this.pendingDeletes);

    this.pendingChanges.clear();
    this.pendingAdds.clear();
    this.pendingDeletes.clear();

    const debounceWaitMs =
      this.batchStartedAt !== undefined ? performance.now() - this.batchStartedAt : undefined;
    const watcherSettleMs = this.watcherSettleMs;
    this.batchStartedAt = undefined;
    this.watcherSettleMs = undefined;

    if (changes.length === 0 && adds.length === 0 && deletes.length === 0) return;

    // Both .env files and warlock.config.ts live outside src/ — they should
    // never enter the dep graph, only ride along in the batch event so the
    // dev server can react (config reload / restart warning).
    const externalChanges = changes.filter(isExternalPath);
    const externalAdds = adds.filter(isExternalPath);
    const codeChanges = changes.filter((p) => !isExternalPath(p));
    const codeAdds = adds.filter((p) => !isExternalPath(p));

    // Multi-file batches can race the filesystem on Windows.
    if (codeAdds.length + codeChanges.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      clearFileExistsCache();
    }

    const { added: addedCodePaths, vanished } = await this.processBatchAdds(codeAdds);
    const changedCodePaths = await this.processBatchChanges(codeChanges);
    await this.processBatchDeletes(deletes);

    this.fileOperations.updateFileDependents();
    this.fileOperations.syncFilesToManifest();
    await this.manifest.save();

    // Emit only the code paths that genuinely changed (hash differs). A no-op
    // save — an editor that fsyncs without writing — reports no change and is
    // dropped here, where we still know the pre-change hash. (Doing this
    // downstream is impossible: the source has already been overwritten, so a
    // content compare always looks unchanged — which is exactly why emptying a
    // file used to silently skip HMR.) External paths (.env / warlock.config.ts)
    // ride along untouched so the dev server can still react to them. Paths
    // that vanished between the add event and their read/stat (a rename or
    // move racing the filesystem) are folded into `deleted` instead of
    // `added` — they were already unwound as deletions in processBatchAdds.
    events.trigger("dev-server:batch-complete", {
      added: [...externalAdds, ...addedCodePaths],
      changed: [...externalChanges, ...changedCodePaths],
      deleted: [...deletes, ...vanished],
      timings: isTimingsEnabled()
        ? { watcherSettleMs: watcherSettleMs ?? 0, debounceWaitMs: debounceWaitMs ?? 0 }
        : undefined,
    });
  }

  /**
   * Reprocess each changed file and return only the paths that genuinely
   * changed. `updateFile` returns false when the on-disk hash matches the
   * last-processed hash (e.g. an editor that fsyncs on save without writing),
   * so those no-ops are kept out of the reload batch. Emptying a file changes
   * its hash, so it is correctly reported as changed.
   */
  private async processBatchChanges(relativePaths: string[]): Promise<string[]> {
    const changed: string[] = [];
    await runInBatches(relativePaths, FILE_PROCESSING_BATCH_SIZE, async (path) => {
      if (await this.fileOperations.updateFile(path)) {
        changed.push(path);
      }
    });
    return changed;
  }

  /**
   * Process pending add events. Returns the paths that genuinely became
   * available (`added`) separately from paths that no longer existed by the
   * time they were read/stat'd (`vanished`) — the latter is a rename or move
   * racing the filesystem, not a failure, so it is unwound as a deletion
   * instead of being logged as an error.
   */
  private async processBatchAdds(
    relativePaths: string[],
  ): Promise<{ added: string[]; vanished: string[] }> {
    const added: string[] = [];
    const vanished: string[] = [];

    await runInBatches(relativePaths, FILE_PROCESSING_BATCH_SIZE, async (path) => {
      try {
        const fileManager = await this.fileOperations.addFile(path);

        if (fileManager.state === "deleted") {
          await this.fileOperations.deleteFile(path);
          vanished.push(path);
          return;
        }

        added.push(path);
        devLogSuccess(`Added file: ${path}`);
      } catch (error) {
        console.error(`Failed to add file ${path}:`, error);
      }
    });

    return { added, vanished };
  }

  private async processBatchDeletes(relativePaths: string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      await this.fileOperations.deleteFile(relativePath);
      devLogSuccess(`Deleted file: ${relativePath}`);
    }
  }
}

function isEnvFile(path: string): boolean {
  const basename = path.split("/").pop() || path;
  return basename === ".env" || basename.startsWith(".env.");
}

/** Paths watched but never added to the dependency graph. */
function isExternalPath(path: string): boolean {
  return isEnvFile(path) || path === "warlock.config.ts";
}

async function runInBatches<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}
