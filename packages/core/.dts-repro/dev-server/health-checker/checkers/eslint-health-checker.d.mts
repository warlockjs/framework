import { FileManager } from "../../file-manager.mjs";
import { FileHealthResult } from "../file-health-result.mjs";
import { FileHealthCheckerContract } from "../file-health-checker.contract.mjs";
import { BaseHealthChecker } from "./base-health-checker.mjs";

//#region ../../@warlock.js/core/src/dev-server/health-checker/checkers/eslint-health-checker.d.ts
declare class EslintHealthChecker extends BaseHealthChecker implements FileHealthCheckerContract {
  /**
   * ESLint instance (using new ESLint v9 API with flat config)
   */
  private eslint;
  /**
   * Health checker name
   */
  name: string;
  /**
   * Path to dedicated worker file for ESLint checking
   * Runs in a separate thread to avoid blocking the main dev server
   */
  workerPath: string;
  /**
   * Whether checker is initialized
   */
  private initialized;
  /**
   * Check if file is a lintable file
   */
  private isLintableFile;
  /**
   * Initialize the health checker
   */
  initialize(): EslintHealthChecker;
  /**
   * Display health check results in a pretty format
   */
  private displayResults;
  /**
   * Validate the health of the file
   */
  validate(file: FileManager, result: FileHealthResult): Promise<FileHealthResult>;
}
//#endregion
export { EslintHealthChecker };
//# sourceMappingURL=eslint-health-checker.d.mts.map