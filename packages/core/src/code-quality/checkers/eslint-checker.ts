// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ESLint types not available
import { ESLint } from "eslint";

export type ESLintResult = {
  tool: "ESLint";
  filePath: string;
  results: any; // ESLint.LintResult
};

/**
 * Check a single file for ESLint errors
 */
export async function checkSingleFile(
  filePath: string,
): Promise<ESLintResult | null> {
  try {
    const eslint = new ESLint();
    const results = await eslint.lintFiles([filePath]);

    return {
      tool: "ESLint",
      filePath,
      results: results[0],
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check entire project for ESLint errors
 */
export async function checkProject(
  projectPath: string,
): Promise<ESLintResult[]> {
  try {
    const eslint = new ESLint();

    // ESLint will automatically use .eslintrc and scan the directory
    const results = await eslint.lintFiles([`${projectPath}/**/*.{ts,tsx}`]);

    // Filter out files with no issues for cleaner results
    const resultsWithIssues = results.filter(
      (result: any) => result.errorCount > 0 || result.warningCount > 0,
    );

    return resultsWithIssues.map((result: any) => ({
      tool: "ESLint",
      filePath: result.filePath.replace(/\\/g, "/"),
      results: result,
    }));
  } catch (error) {
    return [];
  }
}
