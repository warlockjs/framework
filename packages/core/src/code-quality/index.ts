/**
 * Warlock Code Quality System
 *
 * Provides TypeScript and ESLint checking with beautiful formatting
 * Supports both single-file checks (on change) and full project scans (on startup)
 */

// Configuration
export { configure, getConfig, resetConfig } from "./config";
export type { CodeQualityConfig, DisplayStrategy } from "./config";

// Single file checking (on file change)
export { checkSingleFile } from "./single-file-checker";

// Project scanning (on startup)
export { scanProject } from "./project-scanner";

// Low-level checkers (if you need direct access)
export * as ESLintChecker from "./checkers/eslint-checker";
export * as TypeScriptChecker from "./checkers/typescript-checker";

// Formatters (if you need custom display)
export * as ESLintFormatter from "./formatters/eslint-formatter";
export * as SummaryFormatter from "./formatters/summary-formatter";
export * as TypeScriptFormatter from "./formatters/typescript-formatter";

// Issue tracking (progress tracking)
export * as IssueTracker from "./issue-tracker";
