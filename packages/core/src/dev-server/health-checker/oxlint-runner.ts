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

/** Whether the app has an oxlint config file at its root. */
export function hasOxlintConfig(cwd: string): boolean {
  return CONFIG_FILES.some((name) => existsSync(path.join(cwd, name)));
}

/** Resolve the app's optional CLI package, without using global PATH binaries. */
export function findOxlint(cwd: string): string | undefined {
  if (!hasOxlintConfig(cwd)) return undefined;
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

/** Most output one CLI run may write before Node stops it. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Most files passed to one CLI run. An 8 MiB report holds roughly 16,000
 * diagnostics, so a batch of thousands of files with several diagnostics each
 * could overflow it; a batch that still overflows is split in half and retried.
 */
export const MAX_FILES_PER_BATCH = 500;

/**
 * How long `shutdown()` waits after SIGTERM before sending SIGKILL. Below the
 * health-check manager's 500 ms wait for its workers, so a child that ignores
 * SIGTERM is still reaped before the worker is terminated.
 */
export const SHUTDOWN_KILL_GRACE_MS = 250;

const MAX_BUFFER_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
/** The OS refused the command line: too long overall, or one argument too long. */
const COMMAND_TOO_LONG_CODES = new Set(["E2BIG", "ENAMETOOLONG"]);

/** A failed CLI run; `code` keeps the process or spawn error code (`E2BIG`, maxBuffer, …). */
export class OxlintCommandError extends Error {
  public constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OxlintCommandError";
  }
}

/** A check stopped because the runner is shutting down; not a lint or tool failure. */
export class OxlintCheckCancelledError extends Error {
  public constructor() {
    super("Oxlint check cancelled: the development server is shutting down.");
    this.name = "OxlintCheckCancelledError";
  }
}

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function oxlintCommandError(
  error: { code?: unknown; signal?: string | null; killed?: boolean },
  stdout: string,
  stderr: string,
): OxlintCommandError {
  const status =
    error.code === MAX_BUFFER_CODE
      ? `produced more than ${MAX_OUTPUT_BYTES / (1024 * 1024)} MiB of output`
      : error.killed
        ? "timed out or terminated (30s limit)"
        : `failed (code ${String(error.code ?? "unknown")}${error.signal ? `, signal ${error.signal}` : ""})`;
  return new OxlintCommandError(
    `Oxlint could not check changed files: ${status}${outputDetail(stdout, stderr) ? `\n${outputDetail(stdout, stderr)}` : ""}`,
    typeof error.code === "string" ? error.code : undefined,
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
  /** Overrides the per-platform command-line budget, in the units of {@link oxlintArgumentSize}. */
  commandLineLimit?: number;
};

/**
 * The share of the command-line budget one argument uses. Windows counts
 * UTF-16 characters plus quoting and a separator. POSIX `execve` counts the
 * argument's bytes, its NUL terminator and its slot in the `argv` pointer
 * array (8 bytes on 64-bit systems), all against `ARG_MAX`.
 */
export function oxlintArgumentSize(argument: string, platform: NodeJS.Platform): number {
  return platform === "win32" ? argument.length + 3 : Buffer.byteLength(argument) + 1 + 8;
}

/**
 * The command-line budget per platform, well below the real limits: Linux's
 * `ARG_MAX` is about 2 MB (512 KiB here), Windows allows 32,767 characters
 * (24 KiB here) and other systems get 128 KiB.
 */
function commandLineLimit(platform: NodeJS.Platform): number {
  return platform === "win32" ? 24 * 1024 : platform === "linux" ? 512 * 1024 : 128 * 1024;
}

function uncheckedResult(file: OxlintFile, code: string): OxlintFileResult {
  return {
    path: file.path,
    relativePath: file.relativePath,
    healthy: false,
    errors: [],
    warnings: [
      {
        type: "warning",
        message: `Oxlint could not check this file: its path is too long for one command line (${code}).`,
        lineNumber: 1,
        columnNumber: 1,
        length: 1,
        filePath: file.path,
        relativePath: file.relativePath,
      },
    ],
  };
}

const OXLINT_FLAGS = ["--format=json", "--threads=1", "--no-error-on-unmatched-pattern", "--"];

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
  private shuttingDown = false;

  public constructor(private readonly dependencies: OxlintRunnerDependencies = {}) {}

  public initialize(cwd: string): { success: boolean; hasConfig: boolean } {
    this.cwd = cwd;
    this.binaryPath = findOxlint(cwd);
    this.shuttingDown = false;
    return { success: true, hasConfig: this.binaryPath !== undefined };
  }

  /**
   * Stop every running CLI child: SIGTERM first, then SIGKILL after
   * {@link SHUTDOWN_KILL_GRACE_MS} for a child that ignores it. Pending checks
   * reject with {@link OxlintCheckCancelledError}.
   */
  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      [...this.children].map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            const timer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_KILL_GRACE_MS);
            child.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill("SIGTERM");
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
          maxBuffer: MAX_OUTPUT_BYTES,
        },
        (error, stdout, stderr) => {
          this.children.delete(child);
          if (error && this.shuttingDown) {
            reject(new OxlintCheckCancelledError());
            return;
          }
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

  /**
   * Lint one batch. A batch whose report overflows the output buffer is split
   * in half and retried, down to single files; a single file whose path the OS
   * refuses as too long is reported as unchecked instead of failing the check.
   */
  private async checkBatch(
    binaryPath: string,
    filesInBatch: OxlintFile[],
  ): Promise<OxlintFileResult[]> {
    if (this.shuttingDown) throw new OxlintCheckCancelledError();
    let output: OxlintCommandOutput;
    try {
      output = await this.execute(
        binaryPath,
        [...OXLINT_FLAGS, ...filesInBatch.map((file) => path.relative(this.cwd, file.path))],
        this.cwd,
      );
    } catch (error) {
      if (this.shuttingDown) throw new OxlintCheckCancelledError();
      const code = errorCodeOf(error);
      if (code === MAX_BUFFER_CODE && filesInBatch.length > 1) {
        const middle = Math.ceil(filesInBatch.length / 2);
        return [
          ...(await this.checkBatch(binaryPath, filesInBatch.slice(0, middle))),
          ...(await this.checkBatch(binaryPath, filesInBatch.slice(middle))),
        ];
      }
      const [only] = filesInBatch;
      if (code && COMMAND_TOO_LONG_CODES.has(code) && only && filesInBatch.length === 1) {
        return [uncheckedResult(only, code)];
      }
      throw error;
    }
    try {
      return parseOxlintResults(output.stdout, filesInBatch, this.cwd);
    } catch (error) {
      if (!(error instanceof OxlintOutputParseError)) throw error;
      const detail = outputDetail(output.stdout, output.stderr) || "empty diagnostics report";
      throw new Error(`Oxlint could not check changed files: ${detail}`, { cause: error });
    }
  }

  public async checkFiles(files: OxlintFile[]): Promise<OxlintFileResult[]> {
    const exists = this.dependencies.exists ?? existsSync;
    const lintable = files.filter(
      (file) => /\.[cm]?[jt]sx?$/i.test(file.path) && exists(file.path),
    );
    const binaryPath = this.binaryPath;
    if (!binaryPath || lintable.length === 0) return files.map(healthy);
    const platform = this.dependencies.platform ?? process.platform;
    const limit = this.dependencies.commandLineLimit ?? commandLineLimit(platform);
    const size = (arg: string) => oxlintArgumentSize(arg, platform);
    const baseSize = [process.execPath, binaryPath, ...OXLINT_FLAGS].reduce(
      (sum, arg) => sum + size(arg),
      0,
    );
    const batches: OxlintFile[][] = [];
    let batch: OxlintFile[] = [];
    let batchSize = baseSize;
    const flush = () => {
      if (batch.length) batches.push(batch);
      batch = [];
      batchSize = baseSize;
    };
    for (const file of lintable) {
      const argumentSize = size(path.relative(this.cwd, file.path));
      if (baseSize + argumentSize > limit) {
        // Over the conservative budget on its own: run it alone, since the
        // real limit is usually far higher.
        flush();
        batches.push([file]);
        continue;
      }
      if (batch.length >= MAX_FILES_PER_BATCH || batchSize + argumentSize > limit) flush();
      batch.push(file);
      batchSize += argumentSize;
    }
    flush();
    const results = new Map(files.map((file) => [file.path, healthy(file)]));
    for (const filesInBatch of batches) {
      for (const result of await this.checkBatch(binaryPath, filesInBatch)) {
        results.set(result.path, result);
      }
    }
    return files.map((file) => results.get(file.path) ?? healthy(file));
  }
}
