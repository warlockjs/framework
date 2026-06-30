import events from "@mongez/events";
import { debounce } from "@mongez/reinforcements";
import type { DependencyGraph } from "./dependency-graph";
import { devLogSuccess } from "./dev-logger";
import type { FileManager } from "./file-manager";
import type { FileOperations } from "./file-operations";
import { FILE_PROCESSING_BATCH_SIZE } from "./flags";
import type { ManifestManager } from "./manifest-manager";
import { clearFileExistsCache } from "./parse-imports";
import { Path } from "./path";

/**
 * Receives raw watcher events and processes them in a single debounced batch.
 * Order within a batch: adds → changes → deletes, so changes can reference
 * newly-added files and deletes fire last.
 */
export class FileEventHandler {
  private pendingChanges = new Set<string>();
  private pendingAdds = new Set<string>();
  private pendingDeletes = new Set<string>();

  private readonly processPendingEvents = debounce(() => this.processBatch(), 150);

  constructor(
    private readonly fileOperations: FileOperations,
    private readonly manifest: ManifestManager,
    private readonly dependencyGraph: DependencyGraph,
    private readonly files: Map<string, FileManager>,
  ) {}

  public handleFileChange(absolutePath: string): void {
    this.pendingChanges.add(Path.toRelative(absolutePath));
    this.processPendingEvents();
  }

  public handleFileAdd(absolutePath: string): void {
    this.pendingAdds.add(Path.toRelative(absolutePath));
    this.processPendingEvents();
  }

  public handleFileDelete(absolutePath: string): void {
    this.pendingDeletes.add(Path.toRelative(absolutePath));
    this.processPendingEvents();
  }

  private async processBatch(): Promise<void> {
    const changes = Array.from(this.pendingChanges);
    const adds = Array.from(this.pendingAdds);
    const deletes = Array.from(this.pendingDeletes);

    this.pendingChanges.clear();
    this.pendingAdds.clear();
    this.pendingDeletes.clear();

    if (changes.length === 0 && adds.length === 0 && deletes.length === 0) return;

    // Both .env files and warlock.config.ts live outside src/ — they should
    // never enter the dep graph, only ride along in the batch event so the
    // dev server can react (config reload / restart warning).
    const externalChanges = changes.filter(isExternalPath);
    const codeChanges = changes.filter(p => !isExternalPath(p));
    const codeAdds = adds.filter(p => !isExternalPath(p));

    // Multi-file batches can race the filesystem on Windows.
    if (codeAdds.length + codeChanges.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      clearFileExistsCache();
    }

    await this.processBatchAdds(codeAdds);
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
    // ride along untouched so the dev server can still react to them.
    events.trigger("dev-server:batch-complete", {
      added: adds,
      changed: [...externalChanges, ...changedCodePaths],
      deleted: deletes,
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
    await runInBatches(relativePaths, FILE_PROCESSING_BATCH_SIZE, async path => {
      if (await this.fileOperations.updateFile(path)) {
        changed.push(path);
      }
    });
    return changed;
  }

  private async processBatchAdds(relativePaths: string[]): Promise<void> {
    await runInBatches(relativePaths, FILE_PROCESSING_BATCH_SIZE, async path => {
      try {
        await this.fileOperations.addFile(path);
        devLogSuccess(`Added file: ${path}`);
      } catch (error) {
        console.error(`Failed to add file ${path}:`, error);
      }
    });
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
