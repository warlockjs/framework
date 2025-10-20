import { colors } from "@mongez/copper";
import ts from "typescript";
import * as eslintChecker from "./checkers/eslint-checker";
import * as tsChecker from "./checkers/typescript-checker";
import { getConfig } from "./config";
import * as summaryFormatter from "./formatters/summary-formatter";

/**
 * Run a full project scan (async, background process)
 * Called once on server startup
 */
export async function scanProject(projectPath: string) {
  // Fire and forget - run in background
  setTimeout(async () => {
    const config = getConfig();

    if (!config.enableInitialScan || config.displayStrategy === "silent") {
      return;
    }

    const startTime = Date.now();

    console.log(
      colors.cyanBright(
        `\n🔍 ${colors.bold("Code quality scan started...")} ${colors.dim("(running in background)")}`,
      ),
    );

    try {
      // Run both checks in parallel for speed
      const [tsResults, eslintResults] = await Promise.all([
        tsChecker.checkProject(projectPath),
        eslintChecker.checkProject(projectPath),
      ]);

      const scanTime = Date.now() - startTime;

      // Build summary
      const summary = {
        typescript: {
          errorCount: 0,
          warningCount: 0,
          filesWithIssues: [] as Array<{
            file: string;
            errors: number;
            warnings: number;
          }>,
        },
        eslint: {
          errorCount: 0,
          warningCount: 0,
          filesWithIssues: [] as Array<{
            file: string;
            errors: number;
            warnings: number;
          }>,
        },
        totalFiles: tsResults.length + eslintResults.length,
        scanTime,
      };

      // Process TypeScript results
      for (const result of tsResults) {
        const errors = result.diagnostics.filter(
          d => d.category === ts.DiagnosticCategory.Error,
        ).length;
        const warnings = result.diagnostics.filter(
          d => d.category === ts.DiagnosticCategory.Warning,
        ).length;

        summary.typescript.errorCount += errors;
        summary.typescript.warningCount += warnings;

        if (errors > 0 || warnings > 0) {
          summary.typescript.filesWithIssues.push({
            file: result.filePath,
            errors,
            warnings,
          });
        }
      }

      // Process ESLint results
      for (const result of eslintResults) {
        summary.eslint.errorCount += result.results.errorCount;
        summary.eslint.warningCount += result.results.warningCount;

        if (result.results.errorCount > 0 || result.results.warningCount > 0) {
          summary.eslint.filesWithIssues.push({
            file: result.filePath,
            errors: result.results.errorCount,
            warnings: result.results.warningCount,
          });
        }
      }

      // Sort files by errors (most errors first)
      summary.typescript.filesWithIssues.sort((a, b) => b.errors - a.errors);
      summary.eslint.filesWithIssues.sort((a, b) => b.errors - a.errors);

      // Display summary
      summaryFormatter.displayScanSummary(summary);
    } catch (error) {
      console.log(
        colors.red(
          `\n❌ Code quality scan failed: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
      );
    }
  }, 2000); // Wait 2 seconds after server starts
}
