import { colors } from "@mongez/copper";
import { existsSync } from "node:fs";
import path from "node:path";
import { CompilerSession } from "../../../tooling/typescript/compiler";
import type { FileManager } from "../../file-manager";
import type { FileHealthCheckerContract } from "../file-health-checker.contract";
import { FileHealthResult } from "../file-health-result";
import { BaseHealthChecker } from "./base-health-checker";

export class TypescriptHealthChecker
  extends BaseHealthChecker
  implements FileHealthCheckerContract
{
  private session: CompilerSession | null = null;
  /**
   * Health checker name
   */
  public name: string = "TypeScript";

  /**
   * Path to dedicated worker file for TypeScript checking
   * Runs in a separate thread to avoid blocking the main dev server
   */
  public workerPath: string = "./workers/ts-health.worker";

  /**
   * Display health check results in a pretty format
   */
  private displayResults(file: FileManager, result: FileHealthResult): void {
    const stats = result.getStats();

    // Only display if there are errors or warnings
    if (stats.errors === 0 && stats.warnings === 0) {
      return;
    }

    const fileName = file.relativePath.replace(/\\/g, "/");
    const errorCount = stats.errors;
    const warningCount = stats.warnings;
    const sourceLines = file.source ? file.source.split("\n") : [];

    // Display header
    // console.log(
    //   `\n${colors.dim("╭─")} ${colors.bold(colors.cyanBright("TypeScript Health"))} ${colors.dim("→")} ${colors.cyan(fileName)}`,
    // );

    // Display errors
    if (errorCount > 0) {
      const errorMessages = result.messages.filter((m) => m.type === "error");
      for (const error of errorMessages) {
        const icon = colors.redBright("✖");
        const level = colors.redBright(colors.bold("ERROR"));
        console.log(
          `\n${icon} ${level} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${error.lineNumber},${error.columnNumber})`)}`,
        );
        // Extract just the message text (remove file path prefix if present)
        const messageLines = error.message.split("\n");
        const cleanMessage = messageLines
          .map((line) => line.replace(/^[^:]+:\d+:\d+ - /, "").trim())
          .filter((line) => line.length > 0)
          .join("\n");
        console.log(`  ${colors.dim("→")} ${colors.red(cleanMessage)}`);

        // Display code line with underline indicator
        if (
          sourceLines.length > 0 &&
          error.lineNumber > 0 &&
          error.lineNumber <= sourceLines.length
        ) {
          const lineIndex = error.lineNumber - 1; // Convert to 0-based index
          const lineContent = sourceLines[lineIndex];
          const lineNum = error.lineNumber.toString().padStart(4, " ");
          const errorLength = error.length || 1;
          const columnIndex = error.columnNumber - 1; // Convert to 0-based index

          // Display the line with normal color (not all red)
          console.log(`  ${colors.dim(lineNum)} ${colors.dim("│")} ${lineContent || ""}`);

          // Display underline indicator
          // Padding accounts for: lineNum.length + 1 space + 1 (│) + 1 space = lineNum.length + 3
          // (The initial 2 spaces indent is already in the console.log)
          const prefixPadding = lineNum.length + 3;
          const columnPadding = " ".repeat(columnIndex);
          const underline = colors.redBright("~".repeat(Math.max(1, errorLength)));
          console.log(`  ${colors.dim(" ".repeat(prefixPadding))}${columnPadding}${underline}`);
        }
      }
    }

    // Display warnings
    if (warningCount > 0) {
      const warningMessages = result.messages.filter((m) => m.type === "warning");
      for (const warning of warningMessages) {
        const icon = colors.yellowBright("⚠");
        const level = colors.yellowBright(colors.bold("WARNING"));
        console.log(
          `\n${icon} ${level} ${colors.dim("in")} ${colors.cyanBright(fileName)}${colors.dim(`(${warning.lineNumber},${warning.columnNumber})`)}`,
        );
        // Extract just the message text (remove file path prefix if present)
        const messageLines = warning.message.split("\n");
        const cleanMessage = messageLines
          .map((line) => line.replace(/^[^:]+:\d+:\d+ - /, "").trim())
          .filter((line) => line.length > 0)
          .join("\n");
        console.log(`  ${colors.dim("→")} ${colors.yellow(cleanMessage)}`);

        // Display code line with underline indicator
        if (
          sourceLines.length > 0 &&
          warning.lineNumber > 0 &&
          warning.lineNumber <= sourceLines.length
        ) {
          const lineIndex = warning.lineNumber - 1; // Convert to 0-based index
          const lineContent = sourceLines[lineIndex];
          const lineNum = warning.lineNumber.toString().padStart(4, " ");
          const warningLength = warning.length || 1;
          const columnIndex = warning.columnNumber - 1; // Convert to 0-based index

          // Display the line with normal color (not all yellow)
          console.log(`  ${colors.dim(lineNum)} ${colors.dim("│")} ${lineContent || ""}`);

          // Display underline indicator
          // Padding accounts for: lineNum.length + 1 space + 1 (│) + 1 space = lineNum.length + 3
          // (The initial 2 spaces indent is already in the console.log)
          const prefixPadding = lineNum.length + 3;
          const columnPadding = " ".repeat(columnIndex);
          const underline = colors.yellowBright("~".repeat(Math.max(1, warningLength)));
          console.log(`  ${colors.dim(" ".repeat(prefixPadding))}${columnPadding}${underline}`);
        }
      }
    }

    // Display summary
    const summary = [];
    if (errorCount > 0) {
      summary.push(colors.red(`${errorCount} error${errorCount > 1 ? "s" : ""}`));
    }
    if (warningCount > 0) {
      summary.push(colors.yellow(`${warningCount} warning${warningCount > 1 ? "s" : ""}`));
    }

    // console.log(
    //   `\n${colors.dim("╰─")} ${colors.bold("TypeScript")} ${colors.dim("→")} ${summary.join(colors.dim(" and "))}`,
    // );
  }

  public async onFileChanges(files: FileManager[]): Promise<void> {
    this.session?.update(files.map((file) => ({ path: file.absolutePath, content: file.source })));
  }

  public initialize(cwd = process.cwd()): TypescriptHealthChecker {
    this.shutdown();
    if (existsSync(path.join(cwd, "tsconfig.json"))) this.session = new CompilerSession(cwd);
    return this;
  }

  public override removeFile(file: FileManager): this {
    this.session?.update([], [file.absolutePath]);
    super.removeFile(file);
    return this;
  }

  public shutdown(): void {
    this.session?.close();
    this.session = null;
  }

  public async validate(file: FileManager, result: FileHealthResult): Promise<FileHealthResult> {
    if (!this.session || !/\.tsx?$/i.test(file.absolutePath)) {
      result.markAsHealthy();
      return result;
    }
    this.session.update([{ path: file.absolutePath, content: file.source }]);
    const diagnostics = this.session.diagnostics(file.absolutePath);
    const messages = diagnostics.map((diagnostic) => ({
      type: diagnostic.severity,
      message: diagnostic.message,
      lineNumber: diagnostic.line,
      columnNumber: diagnostic.column,
      length: diagnostic.length,
    }));
    result.addErrors(messages.filter((message) => message.type === "error"));
    result.addWarnings(messages.filter((message) => message.type === "warning"));
    if (messages.length === 0) result.markAsHealthy();
    else this.displayResults(file, result);
    return result;
  }
}
