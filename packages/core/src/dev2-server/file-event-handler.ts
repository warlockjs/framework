import events from "@mongez/events";
import { debounce } from "@mongez/reinforcements";
import { devLogSuccess } from "./dev-logger";
import type { FileManager } from "./file-manager";
import type { FileOperations } from "./file-operations";
import { FILE_PROCESSING_BATCH_SIZE } from "./flags";
import type { ManifestManager } from "./manifest-manager";
import { clearFileExistsCache } from "./parse-imports";
import { Path } from "./path";

/**
 * File Event Handler
 * Handles runtime file system events (change, add, delete)
 * Collects events and processes them in batches for optimal performance
 */
export class FileEventHandler {
  /**
   * Pending events to process in batch
   */
  private pendingChanges = new Set<string>();
  private pendingAdds = new Set<string>();
  private pendingDeletes = new Set<string>();

  /**
   * Debounced batch processor
   * Waits for events to settle, then processes all at once
   */
  private readonly processPendingEvents = debounce(async () => {
    await this.processBatch();
  }, 150); // Wait 250ms after last event

  /**
   * Constructor
   */
  constructor(
    private readonly fileOperations: FileOperations,
    private readonly manifest: ManifestManager,
  ) {}

  /**
   * Handle file change event
   * Collects events for batch processing
   */
  public handleFileChange(absolutePath: string) {
    const relativePath = Path.toRelative(absolutePath);

    // Add to pending changes
    this.pendingChanges.add(relativePath);

    // Trigger debounced batch processor
    this.processPendingEvents();
  }

  /**
   * Handle new file added
   * Collects events for batch processing
   */
  public handleFileAdd(absolutePath: string) {
    const relativePath = Path.toRelative(absolutePath);

    // Add to pending adds
    this.pendingAdds.add(relativePath);

    // Trigger debounced batch processor
    this.processPendingEvents();
  }

  /**
   * Handle file deleted
   * Collects events for batch processing
   */
  public handleFileDelete(absolutePath: string) {
    const relativePath = Path.toRelative(absolutePath);

    // Add to pending deletes
    this.pendingDeletes.add(relativePath);

    // Trigger debounced batch processor
    this.processPendingEvents();
  }

  /**
   * Process all pending events in batch
   */
  private async processBatch() {
    // Get snapshots of pending events
    const changes = Array.from(this.pendingChanges);
    const adds = Array.from(this.pendingAdds);
    const deletes = Array.from(this.pendingDeletes);

    // Clear pending sets
    this.pendingChanges.clear();
    this.pendingAdds.clear();
    this.pendingDeletes.clear();

    // Skip if nothing to process
    if (changes.length === 0 && adds.length === 0 && deletes.length === 0) {
      return;
    }

    // For batch operations (multiple files), add extra delay to let filesystem settle
    const totalFiles = adds.length + changes.length;
    if (totalFiles > 1) {
      // Wait 500ms for filesystem to fully write all files
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Clear file exists cache so we get fresh lookups
      clearFileExistsCache();
    }

    // Silent batch processing

    // Process in order: adds first (so new files are available for import transformation),
    // then changes (can reference newly added files), then deletes
    const addedFiles = await this.processBatchAdds(adds);
    // TODO: If changed files are just saves, then skip triggering the batch completion event
    const changedFiles = await this.processBatchChanges(changes);
    const deletedFiles = await this.processBatchDeletes(deletes);

    // Update dependency graph and manifest once
    this.fileOperations.updateFileDependents();
    this.fileOperations.syncFilesToManifest();
    await this.manifest.save();

    // Trigger batch completion event (for reload execution)
    events.trigger("dev-server:batch-complete", {
      added: adds,
      changed: changes,
      deleted: deletes,
    });
  }

  /**
   * Process batch of changed files
   */
  private async processBatchChanges(relativePaths: string[]) {
    if (relativePaths.length === 0) return;

    const BATCH_SIZE = FILE_PROCESSING_BATCH_SIZE;

    for (let i = 0; i < relativePaths.length; i += BATCH_SIZE) {
      const batch = relativePaths.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (relativePath) => {
          await this.fileOperations.updateFile(relativePath);
        }),
      );
    }
  }

  /**
   * Process batch of added files
   * Uses push-to-end strategy: files that depend on other batch files are processed last
   */
  private async processBatchAdds(relativePaths: string[]) {
    if (relativePaths.length === 0) return;

    const batchSet = new Set(relativePaths);

    // PHASE 1: Parse all files in parallel to discover dependencies
    const parsedFiles = await Promise.all(
      relativePaths.map(async (relativePath) => {
        try {
          const fileManager = await this.fileOperations.parseNewFile(relativePath);
          return fileManager;
        } catch (error) {
          return null; // Skip files that can't be parsed
        }
      }),
    );

    // Filter out nulls
    const validFiles = parsedFiles.filter((f): f is FileManager => f !== null);

    // PHASE 2: Reorder - push files with batch dependencies to the end
    const noDeps: FileManager[] = [];
    const hasDeps: FileManager[] = [];

    for (const file of validFiles) {
      const dependsOnBatch = [...file.dependencies].some((dep) => batchSet.has(dep));
      if (dependsOnBatch) {
        hasDeps.push(file);
      } else {
        noDeps.push(file);
      }
    }

    // Combine: no-deps first, has-deps last
    const orderedFiles = [...noDeps, ...hasDeps];

    // PHASE 3: Process sequentially with retry for failures
    const failed: FileManager[] = [];

    for (const file of orderedFiles) {
      try {
        await this.fileOperations.finalizeNewFile(file);
        devLogSuccess(`Added file: ${file.relativePath}`);
      } catch (error) {
        failed.push(file);
      }
    }

    // Retry failed files once (their dependencies might be ready now)
    for (const file of failed) {
      try {
        await this.fileOperations.finalizeNewFile(file);
        devLogSuccess(`Added file: ${file.relativePath}`);
      } catch (error) {
        // Log error but continue - file may have other issues
        console.error(`Failed to add file ${file.relativePath}:`, error);
      }
    }
  }

  /**
   * Process batch of deleted files
   */
  private async processBatchDeletes(relativePaths: string[]) {
    if (relativePaths.length === 0) return;

    for (const relativePath of relativePaths) {
      await this.fileOperations.deleteFile(relativePath);
      devLogSuccess(`Deleted file: ${relativePath}`);
    }
  }
}
