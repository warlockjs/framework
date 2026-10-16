import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type OxlintFile = { path: string; relativePath: string };
export type OxlintMessage = {
  type: "error" | "warning";
  message: string;
  lineNumber: number;
  columnNumber: number;
  length: number;
  filePath: string;
  relativePath: string;
  ruleId?: string;
};
export type OxlintFileResult = OxlintFile & {
  healthy: boolean;
  errors: OxlintMessage[];
  warnings: OxlintMessage[];
};

const CONFIG_FILES = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"];

/** Resolve the app's optional CLI package, without using global PATH binaries. */
export function findOxlint(cwd: string): string | undefined {
  if (!CONFIG_FILES.some((name) => existsSync(path.join(cwd, name)))) return undefined;
  try {
    const require = createRequire(path.join(cwd, "package.json"));
    const packagePath = require.resolve("oxlint/package.json");
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
      bin?: { oxlint?: unknown } | string;
    };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.oxlint;
    if (typeof bin !== "string") return undefined;
    const binaryPath = path.resolve(path.dirname(packagePath), bin);
    return existsSync(binaryPath) ? binaryPath : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coordinate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

export function parseOxlintResults(
  output: string,
  files: OxlintFile[],
  cwd: string,
): OxlintFileResult[] {
  const report: unknown = JSON.parse(output);
  if (!record(report) || !Array.isArray(report.diagnostics)) {
    throw new Error("Oxlint returned an invalid JSON diagnostics report.");
  }
  const results = files.map((file): OxlintFileResult => ({
    ...file,
    healthy: true,
    errors: [],
    warnings: [],
  }));
  const byPath = new Map(results.map((result) => [path.resolve(result.path), result]));
  for (const diagnostic of report.diagnostics) {
    if (!record(diagnostic) || typeof diagnostic.message !== "string") continue;
    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") continue;
    const target =
      typeof diagnostic.filename === "string"
        ? byPath.get(path.resolve(cwd, diagnostic.filename))
        : undefined;
    if (!target) {
      throw new Error(`Oxlint: ${diagnostic.message}`);
    }
    const label = Array.isArray(diagnostic.labels) ? diagnostic.labels.find(record) : undefined;
    const span = record(label) && record(label.span) ? label.span : {};
    const message: OxlintMessage = {
      type: diagnostic.severity,
      message: diagnostic.message,
      lineNumber: coordinate(span.line),
      columnNumber: coordinate(span.column),
      length: coordinate(span.length),
      filePath: target.path,
      relativePath: target.relativePath,
      ...(typeof diagnostic.code === "string" ? { ruleId: diagnostic.code } : {}),
    };
    target.healthy = false;
    (message.type === "error" ? target.errors : target.warnings).push(message);
  }
  return results;
}

/** Invoked in a dedicated worker during development; lints only the supplied disk files. */
export class OxlintRunner {
  private binaryPath?: string;
  private cwd = process.cwd();

  public initialize(cwd: string): { success: boolean; hasConfig: boolean } {
    this.cwd = cwd;
    this.binaryPath = findOxlint(cwd);
    return { success: true, hasConfig: this.binaryPath !== undefined };
  }

  public async checkFiles(files: OxlintFile[]): Promise<OxlintFileResult[]> {
    const lintable = files.filter(
      (file) => /\.[cm]?[jt]sx?$/i.test(file.path) && existsSync(file.path),
    );
    if (!this.binaryPath || lintable.length === 0) {
      return files.map((file) => ({ ...file, healthy: true, errors: [], warnings: [] }));
    }
    const binaryPath = this.binaryPath;
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          binaryPath,
          "--format=json",
          "--threads=1",
          "--no-error-on-unmatched-pattern",
          "--",
          ...lintable.map((file) => file.path),
        ],
        {
          cwd: this.cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          // Exit 1 with a JSON report is the normal result for lint errors.
          if (error && (error.code !== 1 || error.killed)) {
            reject(
              new Error(`Oxlint could not check changed files: ${stderr.trim() || error.message}`),
            );
            return;
          }
          if (!stdout.trim()) {
            reject(new Error(`Oxlint returned no diagnostics report: ${stderr.trim()}`));
            return;
          }
          resolve(stdout);
        },
      );
    });
    return parseOxlintResults(output, files, this.cwd);
  }
}
