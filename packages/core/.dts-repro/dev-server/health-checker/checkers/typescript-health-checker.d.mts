import { FileManager } from "../../file-manager.mjs";
import { FileHealthResult } from "../file-health-result.mjs";
import { FileHealthCheckerContract } from "../file-health-checker.contract.mjs";
import { BaseHealthChecker } from "./base-health-checker.mjs";

//#region ../../@warlock.js/core/src/dev-server/health-checker/checkers/typescript-health-checker.d.ts
declare class TypescriptHealthChecker extends BaseHealthChecker implements FileHealthCheckerContract {
  /**
   * Cached TypeScript program instance
   */
  private program;
  /**
   * Cached parsed TypeScript configuration
   */
  private parsedConfig;
  /**
   * Health checker name
   */
  name: string;
  /**
   * Path to dedicated worker file for TypeScript checking
   * Runs in a separate thread to avoid blocking the main dev server
   */
  workerPath: string;
  /**
   * Whether checker is initialized
   */
  private initialized;
  /**
   * Check if file is a TypeScript file
   */
  private isTypeScriptFile;
  /**
   * Extract line and column from diagnostic location
   */
  private getDiagnosticLocation;
  /**
   * Format diagnostic message
   */
  private formatDiagnosticMessage;
  /**
   * Display health check results in a pretty format
   */
  private displayResults;
  /**
   * Detect when files are changed
   */
  onFileChanges(files: FileManager[]): Promise<void>;
  /**
   * Initialize the health checker
   */
  initialize(): TypescriptHealthChecker;
  /**
   * Validate the health of the file
   */
  validate(file: FileManager, result: FileHealthResult): Promise<FileHealthResult>;
}
//#endregion
export { TypescriptHealthChecker };
//# sourceMappingURL=typescript-health-checker.d.mts.map