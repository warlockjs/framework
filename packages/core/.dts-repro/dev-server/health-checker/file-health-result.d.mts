//#region ../../@warlock.js/core/src/dev-server/health-checker/file-health-result.d.ts
type FileHealthStats = {
  /**
   * File Health State
   */
  state: "healthy" | "defective";
  /**
   * Number of errors
   */
  errors: number;
  /**
   * Number of warnings
   */
  warnings: number;
};
type FileHealthMessage = {
  /**
   * Message
   */
  message: string;
  /**
   * Type of the message
   */
  type: "error" | "warning";
  /**
   * Line number
   */
  lineNumber: number;
  /**
   * Column number
   */
  columnNumber: number;
  /**
   * Length of the error/warning span
   */
  length?: number;
  /**
   * Rule ID (for ESLint)
   */
  ruleId?: string;
};
declare class FileHealthResult {
  /**
   * Result of the health check
   */
  result: "healthy" | "defective";
  /**
   * Messages list (either for errors or warnings)
   */
  messages: FileHealthMessage[];
  /**
   * Mark as healthy
   */
  markAsHealthy(): void;
  /**
   * Add errors
   */
  addErrors(messages: FileHealthMessage[]): void;
  /**
   * Add warnings
   */
  addWarnings(messages: FileHealthMessage[]): void;
  /**
   * Get file health stats
   */
  getStats(): FileHealthStats;
}
//#endregion
export { FileHealthResult };
//# sourceMappingURL=file-health-result.d.mts.map