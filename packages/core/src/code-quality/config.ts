/**
 * Display strategies for code quality results
 */
export type DisplayStrategy =
  | "sequential" // TS first, then ESLint
  | "combined" // Single combined summary
  | "typescript-only" // Only TypeScript
  | "eslint-only" // Only ESLint
  | "silent"; // No output

/**
 * Configuration for code quality checks
 */
export type CodeQualityConfig = {
  displayStrategy: DisplayStrategy;
  showSuccessMessages: boolean;
  showWarnings: boolean;
  showErrors: boolean;
  showCodeSnippets: boolean;
  contextLines: number; // Lines before/after error
  enableInitialScan: boolean; // Run full scan on startup
};

/**
 * Default configuration
 */
const defaultConfig: CodeQualityConfig = {
  displayStrategy: "sequential",
  showSuccessMessages: true,
  showWarnings: true,
  showErrors: true,
  showCodeSnippets: true,
  contextLines: 2,
  enableInitialScan: true,
};

let config: CodeQualityConfig = { ...defaultConfig };

/**
 * Configure the code quality checker
 */
export function configure(newConfig: Partial<CodeQualityConfig>) {
  config = { ...config, ...newConfig };
}

/**
 * Get current configuration
 */
export function getConfig(): CodeQualityConfig {
  return { ...config };
}

/**
 * Reset configuration to defaults
 */
export function resetConfig() {
  config = { ...defaultConfig };
}
