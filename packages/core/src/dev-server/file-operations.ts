import events from "@mongez/events";
import type { DependencyGraph } from "./dependency-graph";
import { DEV_SERVER_EVENTS } from "./events";
import { FileManager } from "./file-manager";
import type { ManifestManager } from "./manifest-manager";
import { parseImports } from "./parse-imports";
import { Path } from "./path";
import type { SpecialFilesCollector } from "./special-files-collector";
import { areSetsEqual } from "./utils";

/**
 * FileOperations — add/update/delete lifecycle for a single file.
 *
 * Coordinates the dependency graph, manifest, and special-files collector
 * so the orchestrator and event handler can stay declarative.
 */
export class FileOperations {
  public constructor(
    private readonly files: Map<string, FileManager>,
    private readonly dependencyGraph: DependencyGraph,
    private readonly manifest: ManifestManager,
    private readonly specialFilesCollector: SpecialFilesCollector,
  ) {}

  /**
   * Register and process a new file. Recursively pulls in any
   * not-yet-tracked dependencies so the dep graph is complete.
   */
  public async addFile(relativePath: string): Promise<FileManager> {
    const existing = this.files.get(relativePath);
    if (existing) return existing;

    const fileManager = new FileManager(Path.toAbsolute(relativePath), this.files, this);

    // Register before processing so recursive deps see us.
    this.files.set(relativePath, fileManager);

    await fileManager.process();

    for (const depPath of fileManager.dependencies) {
      if (!this.files.has(depPath)) {
        try {
          await this.addFile(depPath);
        } catch {
          // External or missing — let the importer surface it at load time.
        }
      }
    }

    for (const dependency of fileManager.dependencies) {
      this.dependencyGraph.addDependency(relativePath, dependency);
    }

    this.specialFilesCollector.addFile(fileManager);

    await this.reloadFilesWaitingForDependency(relativePath);

    return fileManager;
  }

  /**
   * Reprocess a file after a change. Re-syncs the dep graph and special-files
   * collector when its imports or path classification shift.
   */
  public async updateFile(relativePath: string): Promise<boolean> {
    const fileManager = this.files.get(relativePath);
    if (!fileManager) {
      await this.addFile(relativePath);
      return true;
    }

    const oldDependencies = new Set(fileManager.dependencies);

    try {
      const hasChanged = await fileManager.process();
      if (!hasChanged) return false;

      if (!areSetsEqual(oldDependencies, fileManager.dependencies)) {
        this.dependencyGraph.updateFile(
          relativePath,
          fileManager.dependencies,
          fileManager.typeOnlyDependencies,
        );
      }

      this.specialFilesCollector.updateFile(fileManager);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a file. Notifies dependents so they surface broken-import errors.
   */
  public async deleteFile(relativePath: string): Promise<void> {
    const fileManager = this.files.get(relativePath);
    if (!fileManager) return;

    const dependents = this.dependencyGraph.getDependents(relativePath);

    this.dependencyGraph.removeFile(relativePath);
    this.specialFilesCollector.removeFile(relativePath);
    this.manifest.removeFile(relativePath);

    for (const dependentPath of dependents) {
      const dependentFile = this.files.get(dependentPath);
      if (dependentFile) {
        events.trigger(DEV_SERVER_EVENTS.FILE_READY, dependentFile);
      }
    }

    // Slight delay so in-flight reads still find the FileManager.
    setTimeout(() => this.files.delete(relativePath), 300);
  }

  /**
   * Re-process any file whose imports might now resolve to a freshly added
   * file. Covers "import A from './b'" where b.ts only just got created.
   */
  private async reloadFilesWaitingForDependency(newFilePath: string): Promise<void> {
    const dependents: string[] = [];

    for (const [existingPath, existingFile] of this.files) {
      if (existingPath === newFilePath) continue;
      if (existingFile.state !== "ready") continue;

      try {
        const importMap = await parseImports(existingFile.source, existingFile.absolutePath);
        for (const [, resolved] of importMap) {
          if (resolved && Path.toRelative(resolved.absolutePath) === newFilePath) {
            dependents.push(existingPath);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    for (const dependentPath of dependents) {
      const dependentFile = this.files.get(dependentPath);
      if (!dependentFile) continue;
      try {
        await dependentFile.process({ force: true });
        this.dependencyGraph.updateFile(
          dependentPath,
          dependentFile.dependencies,
          dependentFile.typeOnlyDependencies,
        );
      } catch {
        // File still has issues — ignore.
      }
    }
  }

  public updateFileDependents(): void {
    for (const [relativePath, fileManager] of this.files) {
      fileManager.dependents = this.dependencyGraph.getDependents(relativePath);
    }
  }

  public syncFilesToManifest(): void {
    for (const [relativePath, fileManager] of this.files) {
      this.manifest.setFile(relativePath, fileManager.toManifest());
    }
  }
}
