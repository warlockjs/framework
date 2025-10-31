import { colors } from "@mongez/copper";
import path from "path";
import * as eslintChecker from "./checkers/eslint-checker";
import * as tsChecker from "./checkers/typescript-checker";
import { getConfig } from "./config";
import * as eslintFormatter from "./formatters/eslint-formatter";
import * as tsFormatter from "./formatters/typescript-formatter";
import * as issueTracker from "./issue-tracker";

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

      // Update tracking if file is now fixed
      let progressUpdated = false;
      if (tsResult && tsResult.diagnostics.length === 0) {
        await issueTracker.updateBaselineOnFileFix(filePath, "typescript");
        progressUpdated = true;
      }

      if (
        eslintResult &&
        eslintResult.results.errorCount === 0 &&
        eslintResult.results.warningCount === 0
      ) {
        await issueTracker.updateBaselineOnFileFix(filePath, "eslint");
        progressUpdated = true;
      }

      // Display progress if any fixes were made
      if (progressUpdated) {
        await displayProgressAfterFix();
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

/**
 * Display progress after a file is fixed
 */
async function displayProgressAfterFix() {
  const baseline = await issueTracker.loadBaseline();
  if (!baseline) {
    return;
  }

  const tsTotal = baseline.typescript.filesWithIssues.length;
  const eslintTotal = baseline.eslint.filesWithIssues.length;

  if (tsTotal === 0 && eslintTotal === 0) {
    console.log(
      colors.greenBright(
        `\n🎉 ${colors.bold("Congratulations!")} All tracked issues have been fixed!\n`,
      ),
    );
    return;
  }

  console.log(colors.dim("\n" + "─".repeat(60)));
  console.log(colors.bold(colors.cyanBright("📊 Remaining Issues to Fix")));
  console.log(colors.dim("─".repeat(60)));

  // Display TypeScript files
  if (tsTotal > 0) {
    const tsErrors = baseline.typescript.totalErrors;
    const tsWarnings = baseline.typescript.totalWarnings;
    console.log(
      `\n${colors.bold("⚡ TypeScript:")} ${colors.yellow(`${tsTotal} files`)} ${colors.dim("→")} ${tsErrors > 0 ? colors.red(`${tsErrors} errors`) : ""}${tsErrors > 0 && tsWarnings > 0 ? colors.dim(", ") : ""}${tsWarnings > 0 ? colors.yellow(`${tsWarnings} warnings`) : ""}`,
    );

    // Display up to 50 files
    const maxFiles = 50;
    const filesToDisplay = baseline.typescript.filesWithIssues.slice(
      0,
      maxFiles,
    );

    for (const file of filesToDisplay) {
      const fileName = path.relative(process.cwd(), file.file);
      const issues = [];
      if (file.errors > 0) issues.push(colors.red(`${file.errors} errors`));
      if (file.warnings > 0)
        issues.push(colors.yellow(`${file.warnings} warnings`));

      console.log(
        `  ${colors.dim("├─")} ${colors.cyan(fileName)} ${colors.dim("→")} ${issues.join(colors.dim(", "))}`,
      );
    }

    if (tsTotal > maxFiles) {
      console.log(colors.dim(`  └─ ... and ${tsTotal - maxFiles} more files`));
    }
  }

  // Display ESLint files
  if (eslintTotal > 0) {
    const eslintErrors = baseline.eslint.totalErrors;
    const eslintWarnings = baseline.eslint.totalWarnings;
    console.log(
      `\n${colors.bold("📏 ESLint:")} ${colors.yellow(`${eslintTotal} files`)} ${colors.dim("→")} ${eslintErrors > 0 ? colors.red(`${eslintErrors} errors`) : ""}${eslintErrors > 0 && eslintWarnings > 0 ? colors.dim(", ") : ""}${eslintWarnings > 0 ? colors.yellow(`${eslintWarnings} warnings`) : ""}`,
    );

    // Display up to 50 files
    const maxFiles = 50;
    const filesToDisplay = baseline.eslint.filesWithIssues.slice(0, maxFiles);

    for (const file of filesToDisplay) {
      const fileName = path.relative(process.cwd(), file.file);
      const issues = [];
      if (file.errors > 0) issues.push(colors.red(`${file.errors} errors`));
      if (file.warnings > 0)
        issues.push(colors.yellow(`${file.warnings} warnings`));

      console.log(
        `  ${colors.dim("├─")} ${colors.cyan(fileName)} ${colors.dim("→")} ${issues.join(colors.dim(", "))}`,
      );
    }

    if (eslintTotal > maxFiles) {
      console.log(
        colors.dim(`  └─ ... and ${eslintTotal - maxFiles} more files`),
      );
    }
  }

  console.log(colors.dim("─".repeat(60) + "\n"));
}
