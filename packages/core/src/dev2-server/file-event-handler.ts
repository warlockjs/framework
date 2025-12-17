import events from "@mongez/events";
import { debounce } from "@mongez/reinforcements";
import { devLogSuccess } from "./dev-logger";
import type { FileOperations } from "./file-operations";
import { FILE_PROCESSING_BATCH_SIZE } from "./flags";
import type { ManifestManager } from "./manifest-manager";
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
   */
  private async processBatchAdds(relativePaths: string[]) {
    if (relativePaths.length === 0) return;

    const BATCH_SIZE = FILE_PROCESSING_BATCH_SIZE;

    for (let i = 0; i < relativePaths.length; i += BATCH_SIZE) {
      const batch = relativePaths.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (relativePath) => {
          try {
            await this.fileOperations.addFile(relativePath);
            devLogSuccess(`Added file: ${relativePath}`);
          } catch (error) {
            // File might already exist, ignore
          }
        }),
      );
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
