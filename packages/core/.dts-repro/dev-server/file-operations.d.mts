import { DependencyGraph } from "./dependency-graph.mjs";
import { ManifestManager } from "./manifest-manager.mjs";
import { SpecialFilesCollector } from "./special-files-collector.mjs";
import { FileManager } from "./file-manager.mjs";

//#region ../../@warlock.js/core/src/dev-server/file-operations.d.ts
/**
 * FileOperations — add/update/delete lifecycle for a single file.
 *
 * Coordinates the dependency graph, manifest, and special-files collector
 * so the orchestrator and event handler can stay declarative.
 */
declare class FileOperations {
  private readonly files;
  private readonly dependencyGraph;
  private readonly manifest;
  private readonly specialFilesCollector;
  constructor(files: Map<string, FileManager>, dependencyGraph: DependencyGraph, manifest: ManifestManager, specialFilesCollector: SpecialFilesCollector);
  /**
   * Register and process a new file. Recursively pulls in any
   * not-yet-tracked dependencies so the dep graph is complete.
   */
  addFile(relativePath: string): Promise<FileManager>;
  /**
   * Reprocess a file after a change. Re-syncs the dep graph and special-files
   * collector when its imports or path classification shift.
   */
  updateFile(relativePath: string): Promise<boolean>;
  /**
   * Remove a file. Notifies dependents so they surface broken-import errors.
   */
  deleteFile(relativePath: string): Promise<void>;
  /**
   * Re-process any file whose imports might now resolve to a freshly added
   * file. Covers "import A from './b'" where b.ts only just got created.
   */
  private reloadFilesWaitingForDependency;
  updateFileDependents(): void;
  syncFilesToManifest(): void;
}
//#endregion
export { FileOperations };
//# sourceMappingURL=file-operations.d.mts.map