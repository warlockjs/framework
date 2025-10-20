import { colors } from "@mongez/copper";
import path from "path";
import ts from "typescript";

type ScanSummary = {
  typescript: {
    errorCount: number;
    warningCount: number;
    filesWithIssues: Array<{ file: string; errors: number; warnings: number }>;
  };
  eslint: {
    errorCount: number;
    warningCount: number;
    filesWithIssues: Array<{ file: string; errors: number; warnings: number }>;
  };
  totalFiles: number;
  scanTime: number;
};

/**
 * Display project scan summary
 */
export function displayScanSummary(summary: ScanSummary) {
  console.log(
    colors.cyanBright(
      `\n${"=".repeat(60)}\n${colors.bold("📊 Code Quality Scan Complete")}\n${"=".repeat(60)}`,
    ),
  );

  const totalErrors = summary.typescript.errorCount + summary.eslint.errorCount;
  const totalWarnings =
    summary.typescript.warningCount + summary.eslint.warningCount;

  // TypeScript section
  console.log(
    `\n${colors.bold("⚡ TypeScript")} ${colors.dim("→")} ${summary.typescript.errorCount > 0 ? colors.red(`${summary.typescript.errorCount} errors`) : colors.green("0 errors")}${colors.dim(", ")}${summary.typescript.warningCount > 0 ? colors.yellow(`${summary.typescript.warningCount} warnings`) : colors.dim("0 warnings")}`,
  );

  if (summary.typescript.filesWithIssues.length > 0) {
    const topFiles = summary.typescript.filesWithIssues.slice(0, 5);
    for (const file of topFiles) {
      const fileName = path.relative(process.cwd(), file.file);
      const issues = [];
      if (file.errors > 0) issues.push(colors.red(`${file.errors} errors`));
      if (file.warnings > 0)
        issues.push(colors.yellow(`${file.warnings} warnings`));

      console.log(
        `  ${colors.dim("├─")} ${colors.cyan(fileName)} ${colors.dim("→")} ${issues.join(colors.dim(", "))}`,
      );
    }

    if (summary.typescript.filesWithIssues.length > 5) {
      console.log(
        colors.dim(
          `  └─ ... and ${summary.typescript.filesWithIssues.length - 5} more files`,
        ),
      );
    }
  }

  // ESLint section
  console.log(
    `\n${colors.bold("📏 ESLint")} ${colors.dim("→")} ${summary.eslint.errorCount > 0 ? colors.red(`${summary.eslint.errorCount} errors`) : colors.green("0 errors")}${colors.dim(", ")}${summary.eslint.warningCount > 0 ? colors.yellow(`${summary.eslint.warningCount} warnings`) : colors.dim("0 warnings")}`,
  );

  if (summary.eslint.filesWithIssues.length > 0) {
    const topFiles = summary.eslint.filesWithIssues.slice(0, 5);
    for (const file of topFiles) {
      const fileName = path.relative(process.cwd(), file.file);
      const issues = [];
      if (file.errors > 0) issues.push(colors.red(`${file.errors} errors`));
      if (file.warnings > 0)
        issues.push(colors.yellow(`${file.warnings} warnings`));

      console.log(
        `  ${colors.dim("├─")} ${colors.cyan(fileName)} ${colors.dim("→")} ${issues.join(colors.dim(", "))}`,
      );
    }

    if (summary.eslint.filesWithIssues.length > 5) {
      console.log(
        colors.dim(
          `  └─ ... and ${summary.eslint.filesWithIssues.length - 5} more files`,
        ),
      );
    }
  }

  // Overall summary
  console.log(`\n${colors.dim("═".repeat(60))}`);

  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(
      colors.greenBright(
        `${colors.bold("✓ Perfect!")} No issues found in ${summary.totalFiles} files`,
      ),
    );
  } else {
    const totalFilesWithIssues =
      summary.typescript.filesWithIssues.length +
      summary.eslint.filesWithIssues.length;

    console.log(
      `${colors.bold("Summary")} ${colors.dim("→")} ${totalErrors > 0 ? colors.red(`${totalErrors} errors`) : colors.green("0 errors")}${colors.dim(", ")}${totalWarnings > 0 ? colors.yellow(`${totalWarnings} warnings`) : colors.dim("0 warnings")} ${colors.dim(`in ${totalFilesWithIssues} files`)}`,
    );
  }

  console.log(
    colors.dim(`Scan completed in ${(summary.scanTime / 1000).toFixed(2)}s`),
  );
  console.log(colors.dim("═".repeat(60) + "\n"));
}

/**
 * Display compact file list (for project scan)
 */
export function displayCompactSummary(
  diagnostics: ts.Diagnostic[],
  filePath: string,
) {
  const fileName = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  const errorCount = diagnostics.filter(
    d => d.category === ts.DiagnosticCategory.Error,
  ).length;
  const warningCount = diagnostics.filter(
    d => d.category === ts.DiagnosticCategory.Warning,
  ).length;

  if (errorCount > 0 || warningCount > 0) {
    const issues = [];
    if (errorCount > 0)
      issues.push(
        colors.red(`${errorCount} error${errorCount > 1 ? "s" : ""}`),
      );
    if (warningCount > 0)
      issues.push(
        colors.yellow(`${warningCount} warning${warningCount > 1 ? "s" : ""}`),
      );

    console.log(
      `  ${colors.dim("├─")} ${colors.cyan(fileName)} ${colors.dim("→")} ${issues.join(colors.dim(", "))}`,
    );
  }
}
