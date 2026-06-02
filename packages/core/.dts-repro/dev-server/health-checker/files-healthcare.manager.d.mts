import { FileManager } from "../file-manager.mjs";
import { FileHealthCheckerContract } from "./file-health-checker.contract.mjs";

//#region ../../@warlock.js/core/src/dev-server/health-checker/files-healthcare.manager.d.ts
/**
 * Files Healthcare Manager
 *
 * Manages health checkers for file validation during development.
 * Supports both main-thread and worker-based checkers.
 *
 * Checkers with `workerPath` run in dedicated worker threads for performance.
 * Checkers without `workerPath` run in the main thread.
 *
 * @example
 * ```typescript
 * const manager = new FilesHealthcareManager(files);
 *
 * manager.setHealthCheckers([
 *   new TypescriptHealthChecker(),  // Has workerPath → runs in worker
 *   new CustomChecker(),             // No workerPath → runs in main thread
 * ]);
 *
 * await manager.initialize();
 * await manager.validateAllFiles();
 * ```
 */
declare class FilesHealthcareManager {
  private readonly files;
  /**
   * Registered health checkers
   */
  private healthCheckers;
  /**
   * Active worker instances (checkerName → Worker)
   */
  private workers;
  /**
   * Worker initialization promises (for ensuring workers are ready)
   */
  private workerInitPromises;
  /**
   * Aggregated stats for each checker
   */
  private checkerStats;
  /**
   * Constructor
   * @param files - Map of tracked files
   */
  constructor(files: Map<string, FileManager>);
  /**
   * Add health checkers to the manager
   * @param checkers - Checkers to add
   */
  addHealthCheckers(...checkers: FileHealthCheckerContract[]): FilesHealthcareManager;
  /**
   * Set (replace) all health checkers
   * @param checkers - New set of checkers
   */
  setHealthCheckers(checkers: FileHealthCheckerContract[]): FilesHealthcareManager;
  /**
   * Initialize all health checkers
   *
   * For checkers with `workerPath`, spawns dedicated worker threads.
   * For other checkers, calls their `initialize()` method directly.
   */
  initialize(): Promise<void>;
  /**
   * Spawn a worker for a checker
   */
  private spawnWorker;
  /**
   * Validate all tracked files
   */
  validateAllFiles(): Promise<void>;
  /**
   * Check the given files with all registered checkers
   *
   * All checkers run in parallel for performance.
   * Worker-based checkers communicate via postMessage.
   * Main-thread checkers are called directly.
   */
  checkFiles(files: FileManager[]): Promise<void>;
  /**
   * Run checker in worker thread
   */
  private runInWorker;
  /**
   * Run checker inline (main thread)
   */
  private runInline;
  /**
   * Update aggregated stats for a checker
   */
  private updateStats;
  /**
   * Detect when files are changed
   */
  onFileChanges(files: FileManager[]): Promise<void>;
  /**
   * Remove files from tracking
   * Notifies both inline checkers and worker-based checkers about removed files
   */
  removeFiles(files: FileManager[]): void;
  /**
   * Display file results (errors/warnings)
   */
  private displayFileResults;
  /**
   * Display stats for all health checkers
   */
  private displayStats;
  /**
   * Shutdown all workers
   */
  shutdown(): Promise<void>;
}
//#endregion
export { FilesHealthcareManager };
//# sourceMappingURL=files-healthcare.manager.d.mts.map