import events from "@mongez/events";
import { unlinkAsync } from "@mongez/fs";
import type { DependencyGraph } from "./dependency-graph";
import { DEV_SERVER_EVENTS } from "./events";
import { FileManager } from "./file-manager";
import type { ManifestManager } from "./manifest-manager";
import { Path } from "./path";
import type { SpecialFilesCollector } from "./special-files-collector";
import { areSetsEqual, warlockCachePath } from "./utils";

/**
 * FileOperations
 * Handles file lifecycle operations: add, update, delete
 *
 * Responsibilities:
 * - Create/update/delete FileManager instances
 * - Manage cache files
 * - Update dependency graph
 * - Update special files collector
 * - Trigger events
 */
export class FileOperations {
  public constructor(
    private readonly files: Map<string, FileManager>,
    private readonly dependencyGraph: DependencyGraph,
    private readonly manifest: ManifestManager,
    private readonly specialFilesCollector: SpecialFilesCollector,
  ) {}

  /**
   * Add a new file to the system
   * @param relativePath - Relative path of the file
   * @returns The created FileManager instance
   */
  public async addFile(relativePath: string): Promise<FileManager> {
    // Check if already tracked
    if (this.files.has(relativePath)) {
      throw new Error(`File already exists: ${relativePath}`);
    }

    const absolutePath = Path.toAbsolute(relativePath);
    const fileManager = new FileManager(absolutePath, this.files);

    // Add to tracking
    this.files.set(relativePath, fileManager);

    // Initialize the file (load, transpile, transform imports)
    await fileManager.init();

    // Add to dependency graph
    for (const dependency of fileManager.dependencies) {
      this.dependencyGraph.addDependency(relativePath, dependency);
    }

    // Add to special files collector
    this.specialFilesCollector?.addFile(fileManager);

    // Check if any existing files were waiting for this dependency
    // (i.e., they have broken imports that can now be resolved)
    await this.reloadFilesWaitingForDependency(relativePath);

    // Trigger event
    events.trigger(DEV_SERVER_EVENTS.FILE_READY, fileManager);

    return fileManager;
  }

  /**
   * Reload files that might have been waiting for this dependency
   * When a file is added, check if any existing files have imports
   * that could now resolve to this new file
   */
  private async reloadFilesWaitingForDependency(newFilePath: string): Promise<void> {
    const { parseImports } = await import("./parse-imports");
    const newFileRelativePath = newFilePath;
    const potentialDependents: string[] = [];

    // Check all existing files to see if any of their imports could resolve to the new file
    for (const [existingPath, existingFile] of this.files) {
      if (existingPath === newFilePath) continue;

      // Re-parse imports from the source to check if any could resolve to the new file
      try {
        const importMap = await parseImports(existingFile.source, existingFile.absolutePath);

        // Check if any import in the map resolves to the new file
        for (const [importPath, resolvedPath] of importMap) {
          if (resolvedPath && Path.toRelative(resolvedPath) === newFileRelativePath) {
            // This import could now be resolved! Add to dependents
            potentialDependents.push(existingPath);
            break; // Found a match, no need to check other imports
          }
        }
      } catch (error) {
        // Skip files that can't be parsed
        continue;
      }
    }

    // Retranspile and reload potential dependents
    if (potentialDependents.length > 0) {
      for (const dependentPath of potentialDependents) {
        const dependentFile = this.files.get(dependentPath);
        if (dependentFile) {
          try {
            // Force reprocess to re-parse imports and resolve to new file (with bundle awareness)
            await dependentFile.forceReprocess(this.bundler);

            // Update dependency graph
            this.dependencyGraph.updateFile(dependentPath, dependentFile.dependencies);

            // Trigger reload event
            events.trigger(DEV_SERVER_EVENTS.FILE_READY, dependentFile);
          } catch (error) {
            // Ignore errors - the file might still have broken imports
          }
        }
      }
    }
  }

  /**
   * Update an existing file
   * @param relativePath - Relative path of the file
   * @returns True if file was changed, false if unchanged
   */
  public async updateFile(relativePath: string): Promise<boolean> {
    const fileManager = this.files.get(relativePath);

    if (!fileManager) {
      // File not tracked, treat as new file
      await this.addFile(relativePath);
      return true;
    }

    // Store old dependencies
    const oldDependencies = new Set(fileManager.dependencies);

    try {
      // Update the file (with bundle awareness)
      const hasChanged = await fileManager.update(this.bundler);

      if (!hasChanged) {
        return false;
      }

      // Update dependency graph if dependencies changed
      const newDependencies = fileManager.dependencies;
      if (!areSetsEqual(oldDependencies, newDependencies)) {
        this.dependencyGraph.updateFile(relativePath, newDependencies);
      }

      // Update special files collector
      this.specialFilesCollector.updateFile(fileManager);

      // Trigger event
      events.trigger(DEV_SERVER_EVENTS.FILE_READY, fileManager);

      return true;
    } catch (error) {
      // Failed to update (likely broken imports)
      // Don't trigger FILE_READY event for broken files
      return false;
    }
  }

  /**
   * Delete a file from the system
   * @param relativePath - Relative path of the file
   */
  public async deleteFile(relativePath: string): Promise<void> {
    const fileManager = this.files.get(relativePath);

    if (!fileManager) {
      return;
    }

    // Get dependents before removing (so we can notify them)
    const dependents = this.dependencyGraph.getDependents(relativePath);

    // Delete cache file
    try {
      const cachePath = warlockCachePath(fileManager.cachePath);
      await unlinkAsync(cachePath);
    } catch (error) {
      // Cache file might not exist, ignore
    }

    // Remove from dependency graph
    this.dependencyGraph.removeFile(relativePath);

    // Remove from special files collector
    this.specialFilesCollector.removeFile(relativePath);

    // Remove from tracking
    this.files.delete(relativePath);
    this.manifest.removeFile(relativePath);

    // Trigger reload of dependents so they see the broken import error
    for (const dependentPath of dependents) {
      const dependentFile = this.files.get(dependentPath);
      if (dependentFile) {
        // Trigger event to reload the dependent (will fail with import error)
        events.trigger(DEV_SERVER_EVENTS.FILE_READY, dependentFile);
      }
    }
  }

  /**
   * Update dependents in all FileManager instances from dependency graph
   */
  public updateFileDependents(): void {
    for (const [relativePath, fileManager] of this.files) {
      const dependents = this.dependencyGraph.getDependents(relativePath);
      fileManager.dependents = dependents;
    }
  }

  /**
   * Sync all FileManager instances to manifest
   */
  public syncFilesToManifest(): void {
    for (const [relativePath, fileManager] of this.files) {
      this.manifest.setFile(relativePath, fileManager.toManifest());
    }
  }
}
