import { execFile, type ChildProcess } from "node:child_process";
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

class OxlintOutputParseError extends Error {}

function outputDetail(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join("\n").slice(0, 2000);
}

export function oxlintCommandError(
  error: { code?: unknown; signal?: string | null; killed?: boolean },
  stdout: string,
  stderr: string,
): Error {
  const status = error.killed
    ? "timed out or terminated (30s limit)"
    : `failed (code ${String(error.code ?? "unknown")}${error.signal ? `, signal ${error.signal}` : ""})`;
  return new Error(
    `Oxlint could not check changed files: ${status}${outputDetail(stdout, stderr) ? `\n${outputDetail(stdout, stderr)}` : ""}`,
  );
}

export function parseOxlintResults(
  output: string,
  files: OxlintFile[],
  cwd: string,
): OxlintFileResult[] {
  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch {
    throw new OxlintOutputParseError(
      `Oxlint could not check changed files: ${output.trim().slice(0, 2000) || "empty diagnostics report"}`,
    );
  }
  if (!record(report) || !Array.isArray(report.diagnostics)) {
    throw new Error("Oxlint returned an invalid JSON diagnostics report.");
  }
  const results = files.map((file): OxlintFileResult => ({
    path: file.path,
    relativePath: file.relativePath,
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

type OxlintCommandOutput = { stdout: string; stderr: string };
type OxlintRunnerDependencies = {
  execute?: (binaryPath: string, args: string[], cwd: string) => Promise<OxlintCommandOutput>;
  exists?: (file: string) => boolean;
  platform?: NodeJS.Platform;
};

function healthy(file: OxlintFile): OxlintFileResult {
  return {
    path: file.path,
    relativePath: file.relativePath,
    healthy: true,
    errors: [],
    warnings: [],
  };
}

/** Invoked in a dedicated worker during development; lints only the supplied disk files. */
export class OxlintRunner {
  private binaryPath?: string;
  private cwd = process.cwd();
  private readonly children = new Set<ChildProcess>();

  public constructor(private readonly dependencies: OxlintRunnerDependencies = {}) {}

  public initialize(cwd: string): { success: boolean; hasConfig: boolean } {
    this.cwd = cwd;
    this.binaryPath = findOxlint(cwd);
    return { success: true, hasConfig: this.binaryPath !== undefined };
  }

  public async shutdown(): Promise<void> {
    await Promise.all(
      [...this.children].map(
        (child) =>
          new Promise<void>((resolve) => {
            child.once("close", () => resolve());
            child.kill();
          }),
      ),
    );
    this.children.clear();
  }

  private execute(binaryPath: string, args: string[], cwd: string): Promise<OxlintCommandOutput> {
    if (this.dependencies.execute) return this.dependencies.execute(binaryPath, args, cwd);
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [binaryPath, ...args],
        {
          cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          this.children.delete(child);
          // Exit 1 with a JSON report is the normal result for lint errors.
          if (error && (error.code !== 1 || error.killed)) {
            reject(oxlintCommandError(error, stdout, stderr));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
      this.children.add(child);
    });
  }

  public async checkFiles(files: OxlintFile[]): Promise<OxlintFileResult[]> {
    const exists = this.dependencies.exists ?? existsSync;
    const lintable = files.filter(
      (file) => /\.[cm]?[jt]sx?$/i.test(file.path) && exists(file.path),
    );
    if (!this.binaryPath || lintable.length === 0) return files.map(healthy);
    const platform = this.dependencies.platform ?? process.platform;
    const limit = platform === "win32" ? 24 * 1024 : platform === "linux" ? 512 * 1024 : 128 * 1024;
    const size = (arg: string) =>
      platform === "win32" ? arg.length + 3 : Buffer.byteLength(arg) + 1;
    const flags = ["--format=json", "--threads=1", "--no-error-on-unmatched-pattern", "--"];
    const baseSize = [process.execPath, this.binaryPath, ...flags].reduce(
      (sum, arg) => sum + size(arg),
      0,
    );
    const batches: OxlintFile[][] = [];
    let batch: OxlintFile[] = [];
    let batchSize = baseSize;
    for (const file of lintable) {
      const argumentSize = size(path.relative(this.cwd, file.path));
      if (baseSize + argumentSize > limit)
        throw new Error(`Oxlint file path exceeds the command-line budget: ${file.relativePath}`);
      if (batch.length && batchSize + argumentSize > limit) {
        batches.push(batch);
        batch = [];
        batchSize = baseSize;
      }
      batch.push(file);
      batchSize += argumentSize;
    }
    if (batch.length) batches.push(batch);
    const results = new Map(files.map((file) => [file.path, healthy(file)]));
    for (const filesInBatch of batches) {
      const output = await this.execute(
        this.binaryPath,
        [...flags, ...filesInBatch.map((file) => path.relative(this.cwd, file.path))],
        this.cwd,
      );
      let checked: OxlintFileResult[];
      try {
        checked = parseOxlintResults(output.stdout, filesInBatch, this.cwd);
      } catch (error) {
        if (!(error instanceof OxlintOutputParseError)) throw error;
        const detail = outputDetail(output.stdout, output.stderr) || "empty diagnostics report";
        throw new Error(`Oxlint could not check changed files: ${detail}`);
      }
      for (const result of checked) results.set(result.path, result);
    }
    return files.map((file) => results.get(file.path) ?? healthy(file));
  }
}
