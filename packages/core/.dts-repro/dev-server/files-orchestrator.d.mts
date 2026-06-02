import { DependencyGraph } from "./dependency-graph.mjs";
import { SpecialFilesCollector } from "./special-files-collector.mjs";
import { FileOperations } from "./file-operations.mjs";
import { FileManager } from "./file-manager.mjs";
import { FilesWatcher } from "./files-watcher.mjs";
import { FileHealthCheckerContract } from "./health-checker/file-health-checker.contract.mjs";
import { FilesHealthcareManager } from "./health-checker/files-healthcare.manager.mjs";
import { ModuleLoader } from "./module-loader.mjs";

//#region ../../@warlock.js/core/src/dev-server/files-orchestrator.d.ts
/**
 * Register a cleanup callback that fires before the current module is
 * unloaded by HMR. Stack-inspects the caller so user code doesn't need to
 * thread the FileManager through.
 */
declare function onCleanup(callback: () => any): void;
/**
 * Top-level coordinator for the dev server's file system.
 *
 * Owns: file discovery, the dependency graph, the manifest, the special-files
 * index, the file watcher, and the lifecycle of the ESM loader hook (which
 * provides cache-busting via `?v=N` version tokens).
 */
declare class FilesOrchestrator {
  readonly filesWatcher: FilesWatcher;
  readonly files: Map<string, FileManager>;
  private readonly manifest;
  private readonly dependencyGraph;
  private readonly healthCheckerManager;
  readonly specialFilesCollector: SpecialFilesCollector;
  readonly moduleLoader: ModuleLoader;
  readonly fileOperations: FileOperations;
  private readonly eventHandler;
  /** Main-thread end of the MessageChannel to the loader hook worker. */
  private loaderPort;
  /** Resolve callbacks for pending `flushVersionBumps()` calls. */
  private readonly pendingFlushes;
  isInitialized: boolean;
  constructor();
  add(relativePath: string): Promise<FileManager>;
  load<T>(relativePath: string, type?: string): Promise<T | undefined>;
  getDependencyGraph(): DependencyGraph;
  getInvalidationChain(file: string): string[];
  getFiles(): Map<string, FileManager>;
  getHealthCheckerManager(): FilesHealthcareManager;
  /**
   * Initialise managers and register the ESM loader hook. Must be called
   * before any user `src/` module is dynamically imported.
   */
  init(): Promise<void>;
  /**
   * Tell the hook worker a file changed. The next `import()` of it will get
   * a fresh `?v=N` URL → Node cache miss → fresh content.
   */
  bumpVersion(absolutePath: string): void;
  /**
   * Wait until the hook worker has processed every pending bump.
   *
   * `postMessage` is async — without this, a follow-up `import()` may
   * resolve before the worker increments the counter and Node will return
   * the cached old module.
   */
  flushVersionBumps(): Promise<void>;
  /**
   * Discover files on disk, reconcile against the manifest, build the dep
   * graph, and persist the new manifest. Idempotent.
   */
  initializeAll(): Promise<void>;
  checkHealth(files: {
    added: string[];
    changed: string[];
    deleted: string[];
  }): Promise<void>;
  startCheckingHealth(healthCheckers?: FileHealthCheckerContract[]): Promise<void>;
  /**
   * Glob the src directory, returning relative paths.
   */
  getAllFilesFromFilesystem(): Promise<string[]>;
  /**
   * Process every file from scratch — used when no manifest exists.
   */
  private processFiles;
  private reconcileFiles;
  watchFiles(): Promise<void>;
}
declare const filesOrchestrator: FilesOrchestrator;
//#endregion
export { FilesOrchestrator, filesOrchestrator, onCleanup };
//# sourceMappingURL=files-orchestrator.d.mts.map