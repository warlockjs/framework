import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { errorCodeOf } from "../../errors/error-codes";
import { createProblem, type ToolingProblem } from "../problem";

/** How a vitest run ended: its exit code, output, and the JSON report if one was written. */
export type VitestRun = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** The `--reporter=json` report, parsed; `undefined` when none was written. */
  report: unknown;
};

/** Runs the app's vitest with the given arguments. Injectable for tests. */
export type VitestRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
) => Promise<VitestRun>;

/** Ten minutes: a suite slower than that is reported as a crashed tool, not a failure. */
const TEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The app's own vitest CLI entry, resolved from the app root — never a global
 * install — or `undefined` when the app does not have vitest.
 */
export function findVitest(cwd: string): string | undefined {
  try {
    const require = createRequire(path.join(cwd, "package.json"));
    const manifestPath = require.resolve("vitest/package.json");
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    const bin =
      typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "bin") : undefined;
    const entry =
      typeof bin === "string"
        ? bin
        : typeof bin === "object" && bin !== null
          ? Reflect.get(bin, "vitest")
          : undefined;

    if (typeof entry !== "string") return undefined;

    const binary = path.resolve(path.dirname(manifestPath), entry);

    return existsSync(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The default {@link VitestRunner}: `node <vitest> <args> --reporter=json
 * --outputFile=<tmp>`, reading the report back from the file so test output on
 * stdout cannot corrupt it.
 */
export const runVitest: VitestRunner = (binary, args, cwd) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-check-vitest-"));
  const outputFile = path.join(directory, "report.json");

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [binary, ...args, "--reporter=json", `--outputFile=${outputFile}`],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: TEST_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CI: process.env.CI ?? "1" },
      },
      (error, stdout, stderr) => {
        let report: unknown;

        try {
          report = JSON.parse(readFileSync(outputFile, "utf8"));
        } catch {
          report = undefined;
        }

        rmSync(directory, { recursive: true, force: true });
        resolve({
          code: error === null ? 0 : typeof error.code === "number" ? error.code : null,
          signal: error?.signal ?? null,
          stdout,
          stderr,
          report,
        });
      },
    );
  });
};

/**
 * The vitest arguments for a run. Verified against `vitest --help` (4.1):
 * `run` executes once without watch; `related <files> --run` runs only the
 * tests that import the given source files; `--passWithNoTests` exits 0 when
 * nothing matches; `--reporter=json --outputFile=<file>` writes the report.
 */
export function vitestArguments(files: readonly string[] | null): string[] {
  if (files === null) return ["run", "--passWithNoTests"];

  return ["related", ...files, "--run", "--passWithNoTests"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ANSI color sequences, which vitest leaves in failure messages. */
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The first meaningful lines of a failure message, bounded for one JSON field. */
function summarize(message: string): string {
  const text = message.replace(ANSI_SEQUENCE, "").trim();

  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
}

/**
 * Whether a failure message shows the machine rather than the code: a
 * refused/unreachable service (`WL8003`) or a port already taken (`WL8004`).
 */
export function environmentCodeOf(message: string): "WL8003" | "WL8004" | undefined {
  const errno = /\b(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|EADDRINUSE)\b/.exec(message)?.[1];

  if (!errno) return undefined;

  const code = errorCodeOf({ code: errno });

  return code === "WL8003" || code === "WL8004" ? code : undefined;
}

function relative(cwd: string, file: unknown): string | null {
  if (typeof file !== "string" || file.length === 0) return null;

  return (path.isAbsolute(file) ? path.relative(cwd, file) : file).split(path.sep).join("/");
}

/**
 * Turn vitest's JSON report (the Jest-compatible shape `--reporter=json`
 * writes) into problems: a failed test is `WL7301`, a file that failed before
 * its tests ran is `WL7302`, and a failure caused by an unreachable service or
 * a busy port is the matching environment code instead.
 */
export function parseVitestReport(report: unknown, cwd: string): ToolingProblem[] {
  if (!isRecord(report) || !Array.isArray(report.testResults)) return [];

  const problems: ToolingProblem[] = [];

  for (const suite of report.testResults) {
    if (!isRecord(suite)) continue;

    const file = relative(cwd, suite.name);
    const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
    const failed = assertions.filter(
      (assertion): assertion is Record<string, unknown> =>
        isRecord(assertion) && assertion.status === "failed",
    );

    for (const assertion of failed) {
      const messages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.filter(
            (message): message is string => typeof message === "string",
          )
        : [];
      const message = summarize(messages.join("\n") || "Test failed.");
      const location = isRecord(assertion.location) ? assertion.location : undefined;
      const name =
        typeof assertion.fullName === "string"
          ? assertion.fullName
          : typeof assertion.title === "string"
            ? assertion.title
            : null;
      const environment = environmentCodeOf(message);

      problems.push(
        createProblem({
          code: environment ?? "WL7301",
          source: environment ? "environment" : "vitest",
          message,
          file,
          line: typeof location?.line === "number" ? location.line : null,
          column: typeof location?.column === "number" ? location.column : null,
          rule: name,
        }),
      );
    }

    const suiteMessage = typeof suite.message === "string" ? suite.message.trim() : "";

    if (suite.status === "failed" && failed.length === 0) {
      const message = summarize(suiteMessage || "The test file failed before its tests ran.");
      const environment = environmentCodeOf(message);

      problems.push(
        createProblem({
          code: environment ?? "WL7302",
          source: environment ? "environment" : "vitest",
          message,
          file,
        }),
      );
    }
  }

  return problems;
}

/**
 * Problems for a vitest run that produced no report: a crash, a timeout or a
 * signal is the tool (`WL8007`); an exit without a report after a config or
 * import error is the code (`WL7302`).
 */
export function vitestRunFailure(run: VitestRun): ToolingProblem[] {
  const output = summarize(`${run.stderr}\n${run.stdout}`) || "vitest wrote no report.";

  if (
    run.signal !== null ||
    run.code === null ||
    run.code > 1 ||
    /heap out of memory/i.test(output)
  ) {
    return [
      createProblem({
        code: "WL8007",
        source: "environment",
        message: `vitest ${run.signal ? `was killed (${run.signal})` : `exited with ${run.code ?? "no code"}`}: ${output}`,
      }),
    ];
  }

  const environment = environmentCodeOf(output);

  return [
    createProblem({
      code: environment ?? "WL7302",
      source: environment ? "environment" : "vitest",
      message: output,
    }),
  ];
}

/** Characters one vitest command line may use for its file arguments (Windows allows about 32k in all). */
export const MAX_VITEST_ARGUMENT_CHARS = 24_000;

/**
 * Split a file list into vitest argument sets whose command lines stay under
 * `maxChars`, so a long `--changed` list does not overflow the operating
 * system's command-line limit (`spawn ENAMETOOLONG` on Windows). A short list
 * (or `null`, the whole suite) yields exactly one set, identical to
 * `build(files)`. A single file longer than the limit gets its own set.
 */
export function vitestArgumentBatches(
  files: readonly string[] | null,
  build: (files: readonly string[] | null) => string[] = vitestArguments,
  maxChars: number = MAX_VITEST_ARGUMENT_CHARS,
): string[][] {
  if (files === null) return [build(null)];

  const overhead = build([]).reduce((sum, argument) => sum + argument.length + 1, 0);
  const groups: string[][] = [];
  let current: string[] = [];
  let used = overhead;

  for (const file of files) {
    const cost = file.length + 1;

    if (current.length > 0 && used + cost > maxChars) {
      groups.push(current);
      current = [];
      used = overhead;
    }

    current.push(file);
    used += cost;
  }

  if (current.length > 0 || groups.length === 0) groups.push(current);

  return groups.map((group) => build(group));
}

function numberOf(report: unknown, key: string): number {
  const value = isRecord(report) ? report[key] : undefined;

  return typeof value === "number" ? value : 0;
}

/**
 * Run each argument set with `runner` one after the other and merge the runs
 * into one: reports are combined (test results joined, counters summed), the
 * exit code is the first non-zero one, and a batch that wrote no report makes
 * the whole run a report-less failure, so a crash is never hidden by the others.
 * One batch is returned as it is.
 */
export async function runVitestBatches(
  runner: VitestRunner,
  binary: string,
  batches: readonly (readonly string[])[],
  cwd: string,
): Promise<VitestRun> {
  const runs: VitestRun[] = [];

  for (const args of batches) runs.push(await runner(binary, args, cwd));

  const [first] = runs;

  if (runs.length === 1 && first) return first;

  const failedWithoutReport = runs.find((run) => run.report === undefined);

  if (failedWithoutReport) return failedWithoutReport;

  const counters = [
    "numTotalTests",
    "numPassedTests",
    "numFailedTests",
    "numPendingTests",
    "numTotalTestSuites",
    "numPassedTestSuites",
    "numFailedTestSuites",
  ];
  const report: Record<string, unknown> = { testResults: [] };

  for (const key of counters) {
    report[key] = runs.reduce((sum, run) => sum + numberOf(run.report, key), 0);
  }

  report.testResults = runs.flatMap((run) => {
    const results = isRecord(run.report) ? run.report.testResults : undefined;

    return Array.isArray(results) ? results : [];
  });
  report.success = runs.every((run) => !isRecord(run.report) || run.report.success !== false);

  return {
    code: runs.find((run) => run.code !== 0)?.code ?? 0,
    signal: runs.find((run) => run.signal !== null)?.signal ?? null,
    stdout: runs.map((run) => run.stdout).join(""),
    stderr: runs.map((run) => run.stderr).join(""),
    report,
  };
}
