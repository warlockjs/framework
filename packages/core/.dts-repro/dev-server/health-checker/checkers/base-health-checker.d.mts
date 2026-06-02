import { FileManager } from "../../file-manager.mjs";
import { FileHealthResult } from "../file-health-result.mjs";
import { FileHealthCheckerContract, HealthCheckerFilesStats } from "../file-health-checker.contract.mjs";

//#region ../../@warlock.js/core/src/dev-server/health-checker/checkers/base-health-checker.d.ts
type CheckerFile = {
  file: FileManager;
  healthResult: FileHealthResult;
};
declare abstract class BaseHealthChecker implements FileHealthCheckerContract {
  /**
   * List of checked files
   */
  protected files: Map<string, CheckerFile>;
  /**
   * Health checker name (unique identifier)
   */
  abstract name: string;
  /**
   * Path to worker file (without extension)
   *
   * If provided, the checker runs in a dedicated worker thread.
   * If undefined, the checker runs in the main thread.
   *
   * @see FileHealthCheckerContract.workerPath
   */
  workerPath?: string;
  /**
   * Initialize the health checker
   */
  abstract initialize(): void;
  /**
   * Detect when files are changed
   */
  onFileChanges(files: FileManager[]): Promise<void>;
  /**
   * Remove the given file from the checker
   */
  removeFile(file: FileManager): BaseHealthChecker;
  /**
   * Validate the health of the file
   */
  check(file: FileManager): Promise<FileHealthResult>;
  /**
   * Validate the health of the file
   */
  abstract validate(file: FileManager, result: FileHealthResult): Promise<FileHealthResult>;
  /**
   * Get the stats of the health checker
   */
  stats(): Promise<HealthCheckerFilesStats>;
}
//#endregion
export { BaseHealthChecker };
//# sourceMappingURL=base-health-checker.d.mts.map