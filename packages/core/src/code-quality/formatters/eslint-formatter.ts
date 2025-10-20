import { colors } from "@mongez/copper";
import path from "path";
import { getConfig } from "../config";

/**
 * Display ESLint errors for a single file
 */
export function displayErrors(result: { filePath: string; results: any }) {
  const config = getConfig();
  const { results, filePath } = result;
  const fileName = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

  if (results.errorCount === 0 && results.warningCount === 0) {
    if (config.showSuccessMessages) {
      console.log(
        colors.green(
          `\n✓ ${colors.bold("ESLint")} ${colors.dim("→")} ${colors.greenBright("No issues")} ${colors.dim(`in ${path.basename(filePath)}`)}`,
        ),
      );
    }
    return;
  }

  for (const message of results.messages) {
    const isError = message.severity === 2;
    const isWarning = message.severity === 1;

    if (isError && !config.showErrors) continue;
    if (isWarning && !config.showWarnings) continue;

    const level = isError ? "ERROR" : "WARNING";
    const levelColor = isError ? colors.redBright : colors.yellowBright;
    const icon = isError ? "✖" : "⚠";

    console.log(
      `\n${levelColor(icon)} ${levelColor(colors.bold(level))} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${message.line},${message.column})`)}`,
    );
    console.log(
      `  ${colors.magentaBright(message.ruleId || "eslint")} ${colors.dim("→")} ${message.message}`,
    );

    if (config.showCodeSnippets && results.source) {
      const lines = results.source.split("\n");
      const line = message.line - 1;
      const startLine = Math.max(0, line - config.contextLines);
      const endLine = Math.min(lines.length - 1, line + config.contextLines);

      for (let i = startLine; i <= endLine; i++) {
        const lineNum = (i + 1).toString().padStart(4, " ");
        const isErrorLine = i === line;
        const prefix = isErrorLine ? levelColor(">") : " ";

        if (isErrorLine) {
          console.log(
            `${prefix} ${colors.dim(lineNum)} ${colors.dim("│")} ${levelColor(lines[i])}`,
          );
          const padding = " ".repeat(
            (message.column || 1) + lineNum.length + 3,
          );
          const pointer = levelColor(
            "~".repeat(
              Math.max(
                1,
                message.endColumn ? message.endColumn - message.column : 1,
              ),
            ),
          );
          console.log(`  ${padding}${pointer}`);
        } else {
          console.log(
            `${prefix} ${colors.dim(lineNum)} ${colors.dim("│")} ${colors.dim(lines[i])}`,
          );
        }
      }
    }
  }

  // Summary
  const summary = [];
  if (results.errorCount > 0) {
    summary.push(
      colors.red(
        `${results.errorCount} error${results.errorCount > 1 ? "s" : ""}`,
      ),
    );
  }
  if (results.warningCount > 0) {
    summary.push(
      colors.yellow(
        `${results.warningCount} warning${results.warningCount > 1 ? "s" : ""}`,
      ),
    );
  }

  console.log(
    `\n${colors.dim("╰─")} ${colors.bold("ESLint")} ${colors.dim("→")} ${summary.join(colors.dim(" and "))}`,
  );
}

/**
 * Display compact file list (for project scan)
 */
export function displayCompactSummary(results: any, filePath: string) {
  const fileName = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

  if (results.errorCount > 0 || results.warningCount > 0) {
    const issues = [];
    if (results.errorCount > 0)
      issues.push(
        colors.red(
          `${results.errorCount} error${results.errorCount > 1 ? "s" : ""}`,
        ),
      );
    if (results.warningCount > 0)
      issues.push(
        colors.yellow(
          `${results.warningCount} warning${results.warningCount > 1 ? "s" : ""}`,
        ),
      );

    console.log(
      `  ${colors.dim("├─")} ${colors.cyan(fileName)} ${colors.dim("→")} ${issues.join(colors.dim(", "))}`,
    );
  }
}
