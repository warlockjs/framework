import path from "node:path";
import { createProblem, type ToolingProblem } from "../problem";
import { type GitRunner, listChangedFiles } from "./changed-files";
import { type CheckExitCode, checkExitCode } from "./check-report.types";
import { listTestFiles } from "./source-files";
import {
  findVitest,
  parseVitestReport,
  runVitest,
  type VitestRunner,
  vitestArguments,
  vitestRunFailure,
} from "./tests-step";

/** Inputs of {@link runTests}. Pass `files`, or `changed`, or neither (the whole suite). */
export type RunTestsOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /**
   * Project-relative files. Test files (`*.spec.ts`, `*.test.ts`) run as they
   * are; any other file runs the tests that import it (`vitest related`).
   */
  files?: readonly string[];
  /** Run the tests related to the files changed against `base` (default HEAD) plus untracked files. */
  changed?: boolean;
  /** Compare with `git merge-base <base> HEAD`. Implies `changed`. */
  base?: string;
  git?: GitRunner;
  vitest?: VitestRunner;
  /** Where the app's vitest CLI is. Default: resolved from the app root. */
  vitestBinary?: string | null;
};

/** What {@link runTests} returns. */
export type TestRunReport = {
  schemaVersion: 1;
  ok: boolean;
  /** Same meaning as `warlock check`: 0 passed, 1 your code, 2 this machine. */
  exitCode: CheckExitCode;
  /** `files` for explicit files, `changed` for a git-scoped run, `all` for the suite. */
  mode: "files" | "changed" | "all";
  /** The files the run was scoped to (project-relative), or `null` for the whole suite. */
  files: string[] | null;
  /** The vitest arguments used (without the reporter flags). */
  args: string[];
  total: number;
  passed: number;
  failed: number;
  /** `WL7301` / `WL7302` per failure, or an environment code. */
  problems: ToolingProblem[];
};

const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** The vitest arguments for a scoped run: `run <tests>` for test files, `related <files> --run` otherwise. */
export function testRunArguments(files: readonly string[] | null): string[] {
  if (files !== null && files.length > 0 && files.every((file) => TEST_FILE.test(file))) {
    return ["run", ...files, "--passWithNoTests"];
  }

  return vitestArguments(files);
}

function count(report: unknown, key: string): number {
  if (typeof report !== "object" || report === null) return 0;

  const value = Reflect.get(report, key);

  return typeof value === "number" ? value : 0;
}

function normalize(cwd: string, file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(cwd, file) : file;

  return relative.split(path.sep).join("/");
}

/**
 * Run the app's tests the way `warlock check` runs its tests step, for one
 * file, a set of files, or the files changed in git — the loop an agent runs
 * after editing a single file.
 *
 * @example
 * const report = await runTests({ files: ["src/app/posts/services/publish.service.ts"] });
 * report.problems.filter((problem) => problem.code === "WL7301");
 */
export async function runTests(options: RunTestsOptions = {}): Promise<TestRunReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const changed = options.changed === true || options.base !== undefined;
  let mode: TestRunReport["mode"] = "all";
  let files: string[] | null = null;

  const finish = (
    fields: Partial<TestRunReport> & { problems: ToolingProblem[] },
  ): TestRunReport => {
    const exitCode = checkExitCode(fields.problems);

    return {
      schemaVersion: 1,
      ok: exitCode === 0,
      exitCode,
      mode,
      files,
      args: [],
      total: 0,
      passed: 0,
      failed: 0,
      ...fields,
    };
  };

  if (options.files && options.files.length > 0) {
    mode = "files";
    files = options.files.map((file) => normalize(cwd, file));
  } else if (changed) {
    mode = "changed";

    const listed = await listChangedFiles({ cwd, base: options.base, git: options.git });

    if ("problem" in listed) return finish({ problems: [listed.problem] });

    files = listed.files;

    if (files.length === 0) return finish({ problems: [] });
  }

  const binary = options.vitestBinary === undefined ? findVitest(cwd) : options.vitestBinary;

  if (!binary) {
    if ((await listTestFiles(cwd)).length === 0) return finish({ problems: [] });

    return finish({
      problems: [
        createProblem({
          code: "WL8002",
          source: "environment",
          message: "The project has test files but vitest is not installed in the app.",
        }),
      ],
    });
  }

  const args = testRunArguments(files);
  const outcome = await (options.vitest ?? runVitest)(binary, args, cwd);
  const problems =
    outcome.report === undefined
      ? vitestRunFailure(outcome)
      : parseVitestReport(outcome.report, cwd);

  return finish({
    args,
    total: count(outcome.report, "numTotalTests"),
    passed: count(outcome.report, "numPassedTests"),
    failed: count(outcome.report, "numFailedTests"),
    problems,
  });
}
