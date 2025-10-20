import { colors } from "@mongez/copper";
import path from "path";
import ts from "typescript";
import { getConfig } from "../config";

/**
 * Display TypeScript errors for a single file
 */
export function displayErrors(result: {
  filePath: string;
  diagnostics: ts.Diagnostic[];
}) {
  const config = getConfig();
  const { diagnostics, filePath } = result;
  const fileName = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

  if (diagnostics.length === 0) {
    if (config.showSuccessMessages) {
      console.log(
        colors.green(
          `\n✓ ${colors.bold("TypeScript")} ${colors.dim("→")} ${colors.greenBright("No errors")} ${colors.dim(`in ${path.basename(filePath)}`)}`,
        ),
      );
    }
    return;
  }

  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );

    if (!diagnostic.file || diagnostic.start === undefined) {
      console.log(colors.redBright(`\n${message}`));
      continue;
    }

    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );

    const isError = diagnostic.category === ts.DiagnosticCategory.Error;
    const isWarning = diagnostic.category === ts.DiagnosticCategory.Warning;

    if (isError && !config.showErrors) continue;
    if (isWarning && !config.showWarnings) continue;

    const level = isError ? "ERROR" : "WARNING";
    const levelColor = isError ? colors.redBright : colors.yellowBright;
    const icon = isError ? "✖" : "⚠";

    console.log(
      `\n${levelColor(icon)} ${levelColor(colors.bold(level))} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${line + 1},${character + 1})`)}`,
    );
    console.log(
      `  ${colors.blueBright("TS" + diagnostic.code)} ${colors.dim("→")} ${message}`,
    );

    if (config.showCodeSnippets) {
      const lines = diagnostic.file.text.split("\n");
      const startLine = Math.max(0, line - config.contextLines);
      const endLine = Math.min(lines.length - 1, line + config.contextLines);
      const errorLength = diagnostic.length || 1;

      for (let i = startLine; i <= endLine; i++) {
        const lineNum = (i + 1).toString().padStart(4, " ");
        const isErrorLine = i === line;
        const prefix = isErrorLine ? colors.redBright(">") : " ";

        if (isErrorLine) {
          console.log(
            `${prefix} ${colors.dim(lineNum)} ${colors.dim("│")} ${colors.redBright(lines[i])}`,
          );
          const padding = " ".repeat(character + lineNum.length + 4);
          const pointer = colors.red("~".repeat(Math.max(1, errorLength)));
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
  const errorCount = diagnostics.filter(
    d => d.category === ts.DiagnosticCategory.Error,
  ).length;
  const warningCount = diagnostics.filter(
    d => d.category === ts.DiagnosticCategory.Warning,
  ).length;

  const summary = [];
  if (errorCount > 0) {
    summary.push(colors.red(`${errorCount} error${errorCount > 1 ? "s" : ""}`));
  }
  if (warningCount > 0) {
    summary.push(
      colors.yellow(`${warningCount} warning${warningCount > 1 ? "s" : ""}`),
    );
  }

  console.log(
    `\n${colors.dim("╰─")} ${colors.bold("TypeScript")} ${colors.dim("→")} ${summary.join(colors.dim(" and "))}`,
  );
}
