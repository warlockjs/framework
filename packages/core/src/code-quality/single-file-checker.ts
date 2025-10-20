import { colors } from "@mongez/copper";
import path from "path";
import * as eslintChecker from "./checkers/eslint-checker";
import * as tsChecker from "./checkers/typescript-checker";
import { getConfig } from "./config";
import * as eslintFormatter from "./formatters/eslint-formatter";
import * as tsFormatter from "./formatters/typescript-formatter";

/**
 * Check a single file for code quality issues
 * This runs on every file change (fast, async, non-blocking)
 */
export async function checkSingleFile(filePath: string) {
  // Fire and forget - don't block
  setTimeout(async () => {
    try {
      const config = getConfig();

      if (config.displayStrategy === "silent") {
        return;
      }

      // Run checks based on strategy
      let tsResult = null;
      let eslintResult = null;

      if (
        config.displayStrategy === "sequential" ||
        config.displayStrategy === "typescript-only" ||
        config.displayStrategy === "combined"
      ) {
        tsResult = await tsChecker.checkSingleFile(filePath);
      }

      if (
        config.displayStrategy === "sequential" ||
        config.displayStrategy === "eslint-only" ||
        config.displayStrategy === "combined"
      ) {
        eslintResult = await eslintChecker.checkSingleFile(filePath);
      }

      // Display based on strategy
      if (config.displayStrategy === "sequential") {
        // Display TypeScript first (more important)
        if (tsResult) tsFormatter.displayErrors(tsResult);
        if (eslintResult) eslintFormatter.displayErrors(eslintResult);
      } else if (config.displayStrategy === "combined") {
        displayCombinedSummary(tsResult, eslintResult);
      } else if (config.displayStrategy === "typescript-only" && tsResult) {
        tsFormatter.displayErrors(tsResult);
      } else if (config.displayStrategy === "eslint-only" && eslintResult) {
        eslintFormatter.displayErrors(eslintResult);
      }
    } catch (error) {
      console.log(
        colors.dim(
          `⚠️ Code quality check failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }, 0);
}

/**
 * Display combined summary for single file
 */
function displayCombinedSummary(tsResult: any, eslintResult: any) {
  const fileName = path
    .basename(tsResult?.filePath || eslintResult?.filePath)
    .replace(/\\/g, "/");

  console.log(
    `\n${colors.dim("╭─")} ${colors.bold(colors.cyanBright("Code Quality"))} ${colors.dim("→")} ${colors.cyan(fileName)}`,
  );

  let totalErrors = 0;
  let totalWarnings = 0;

  if (tsResult && tsResult.diagnostics.length > 0) {
    const errors = tsResult.diagnostics.filter(
      (d: any) => d.category === 3,
    ).length;
    const warnings = tsResult.diagnostics.filter(
      (d: any) => d.category === 0,
    ).length;

    totalErrors += errors;
    totalWarnings += warnings;

    console.log(
      `\n${colors.dim("├─")} ${colors.bold("TypeScript")} ${colors.dim("→")} ${errors > 0 ? colors.red(`${errors} error${errors !== 1 ? "s" : ""}`) : colors.green("0 errors")}${colors.dim(", ")}${warnings > 0 ? colors.yellow(`${warnings} warning${warnings !== 1 ? "s" : ""}`) : colors.dim("0 warnings")}`,
    );
    tsFormatter.displayErrors(tsResult);
  }

  if (
    eslintResult &&
    (eslintResult.results.errorCount > 0 ||
      eslintResult.results.warningCount > 0)
  ) {
    totalErrors += eslintResult.results.errorCount;
    totalWarnings += eslintResult.results.warningCount;

    console.log(
      `\n${colors.dim("├─")} ${colors.bold("ESLint")} ${colors.dim("→")} ${eslintResult.results.errorCount > 0 ? colors.red(`${eslintResult.results.errorCount} error${eslintResult.results.errorCount !== 1 ? "s" : ""}`) : colors.green("0 errors")}${colors.dim(", ")}${eslintResult.results.warningCount > 0 ? colors.yellow(`${eslintResult.results.warningCount} warning${eslintResult.results.warningCount !== 1 ? "s" : ""}`) : colors.dim("0 warnings")}`,
    );
    eslintFormatter.displayErrors(eslintResult);
  }

  console.log(
    `\n${colors.dim("╰─")} ${colors.bold("Summary")} ${colors.dim("→")} ${totalErrors > 0 ? colors.red(`${totalErrors} error${totalErrors !== 1 ? "s" : ""}`) : colors.green("✓ No errors")}${colors.dim(", ")}${totalWarnings > 0 ? colors.yellow(`${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}`) : colors.dim("0 warnings")}\n`,
  );
}
