import { affectedFiles } from "./affected-files";
import { applyConventionFixes } from "./fixes";
import path from "node:path";
import { createProblem, type ToolingProblem } from "../problem";
import {
  runTypecheck,
  type TypecheckOptions,
  type TypecheckResult,
} from "../typecheck/run-typecheck";
import { type GitRunner, listChangedFiles } from "./changed-files";
import {
  CHECK_STEPS,
  type CheckReport,
  type CheckStep,
  type CheckStepName,
  type CheckStepStatus,
  checkExitCode,
} from "./check-report.types";
import { runConventions } from "./conventions-step";
import { collectApiRouteFacts } from "./api-route-references";
import { checkNodeVersion } from "./environment-step";
import { checkFamilyVersions } from "./family-versions-step";
import { runLint } from "./lint-step";
import { listSourceFiles, listTestFiles } from "./source-files";
import {
  findVitest,
  parseVitestReport,
  runVitest,
  type VitestRunner,
  vitestArguments,
  vitestRunFailure,
} from "./tests-step";

/** Runs the typecheck step. The CLI swaps in a child process so a heap overflow cannot end `check`. */
export type TypecheckRunner = (
  options: TypecheckOptions,
) => Promise<TypecheckResult> | TypecheckResult;

/** Inputs of {@link runCheck}. */
export type CheckOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** Oxlint is the only supported linter. */
  lint?: "oxlint";
  /** Limit every step to the files changed against `base` (default HEAD) plus untracked files. */
  changed?: boolean;
  /** Apply safe convention fixes before checking. */
  fix?: boolean;
  /** Compare with `git merge-base <base> HEAD` instead of HEAD. Implies `changed`. */
  base?: string;
  /** Steps not to run. */
  skip?: readonly CheckStepName[];
  /** tsconfig path, relative to `cwd`. Default: `tsconfig.json`. */
  project?: string;
  /** How git is run. */
  git?: GitRunner;
  /** How the typecheck runs. Default: in this process. */
  typecheck?: TypecheckRunner;
  /** How vitest runs. */
  vitest?: VitestRunner;
  /** Where the app's vitest CLI is. Default: resolved from the app root. */
  vitestBinary?: string | null;
  /** The Node.js version to check. Default: the running one. */
  nodeVersion?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusOf(problems: readonly ToolingProblem[]): CheckStepStatus {
  const errors = problems.filter((problem) => problem.severity === "error");

  if (errors.some((problem) => problem.category === "environment")) return "blocked";

  return errors.length > 0 ? "failed" : "passed";
}

/** Bundles one step's timing, status and problems. */
type StepOutcome = { status?: CheckStepStatus; detail: string | null; problems: ToolingProblem[] };

/**
 * The single verify command: typecheck, lint, the tests affected by the
 * change, and the framework's convention checks, as one report with one entry
 * per problem and an exit code that tells "your code" (1) from "this machine"
 * (2).
 *
 * Every step runs even when an earlier one failed, so one run lists every
 * problem. The only exception: with `changed`, a git failure leaves no file
 * list, and every step after `environment` is `blocked`.
 */
export async function runCheck(options: CheckOptions = {}): Promise<CheckReport> {
  const selection: unknown = options.lint;
  if (selection !== undefined && selection !== "oxlint")
    throw new Error(
      "ESLint support was removed in 5.34.0. Oxlint/Oxfmt is the default; run npx warlock upgrade --from 5.33 --to 5.34.0.",
    );
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const changed = options.changed === true || options.base !== undefined;
  const skip = new Set(options.skip ?? []);
  const steps: CheckStep[] = [];
  const problems: ToolingProblem[] = [];
  let files: string[] | null = null;
  let filesBlocked = false;

  const run = async (name: CheckStepName, body: () => Promise<StepOutcome> | StepOutcome) => {
    const startedAt = Date.now();

    if (skip.has(name)) {
      steps.push({ name, status: "skipped", durationMs: 0, detail: "skipped with --skip" });
      return;
    }

    if (filesBlocked && name !== "environment") {
      steps.push({
        name,
        status: "blocked",
        durationMs: 0,
        detail: "the changed files could not be listed",
      });
      return;
    }

    let outcome: StepOutcome;

    try {
      outcome = await body();
    } catch (error) {
      outcome = {
        detail: null,
        problems: [
          createProblem({
            code: "WL8007",
            source: "environment",
            message: `The ${name} step crashed: ${errorMessage(error)}`,
          }),
        ],
      };
    }

    problems.push(...outcome.problems);
    steps.push({
      name,
      status: outcome.status ?? statusOf(outcome.problems),
      durationMs: Date.now() - startedAt,
      detail: outcome.detail,
    });
  };

  await run("environment", async () => {
    const found = [...checkNodeVersion(cwd, options.nodeVersion), ...checkFamilyVersions(cwd)];

    if (changed) {
      const listed = await listChangedFiles({
        cwd,
        base: options.base,
        git: options.git,
        includeDeleted: true,
      });

      if ("problem" in listed) {
        filesBlocked = true;
        found.push(listed.problem);
      } else {
        filesBlocked = true;
        files = await affectedFiles(cwd, listed.files, options.project);
        filesBlocked = false;
      }
    }

    return {
      detail: `Node ${options.nodeVersion ?? process.versions.node}${files ? `, ${files.length} changed file(s)` : ""}`,
      problems: found,
    };
  });

  const targets = async (): Promise<string[]> => files ?? (await listSourceFiles(cwd));

  if (options.fix && !filesBlocked && !skip.has("conventions")) {
    try {
      const fixTargets = await targets();
      applyConventionFixes(
        cwd,
        runConventions(
          cwd,
          fixTargets,
          options.project,
          collectApiRouteFacts(cwd, await listSourceFiles(cwd)),
        ),
      );
    } catch (error) {
      problems.push(
        createProblem({
          code: "WL8007",
          source: "environment",
          message: `Could not apply fixes: ${errorMessage(error)}`,
        }),
      );
    }
  }

  await run("typecheck", async () => {
    if (files !== null && files.length === 0) {
      return { status: "skipped", detail: "no changed files", problems: [] };
    }

    const typecheck = options.typecheck ?? runTypecheck;
    const result = await typecheck({
      cwd,
      project: options.project,
      ...(files !== null ? { files } : {}),
    });

    return {
      detail: `${result.checkedFiles} file(s) checked in ${result.durationMs}ms`,
      problems: result.problems,
    };
  });

  await run("lint", async () => {
    const lintFiles = await targets();

    if (lintFiles.length === 0) {
      return { status: "skipped", detail: "no files to lint", problems: [] };
    }

    const { linters, problems: found } = await runLint(cwd, lintFiles);

    if (linters.length === 0) {
      return {
        status: "skipped",
        detail: "no Oxlint config",
        problems: [],
      };
    }

    return { detail: `${linters.join(" + ")} over ${lintFiles.length} file(s)`, problems: found };
  });

  await run("tests", async () => {
    if (files !== null && files.length === 0) {
      return { status: "skipped", detail: "no changed files", problems: [] };
    }

    const binary = options.vitestBinary === undefined ? findVitest(cwd) : options.vitestBinary;

    if (!binary) {
      if ((await listTestFiles(cwd)).length === 0) {
        return { status: "skipped", detail: "no test files", problems: [] };
      }

      return {
        detail: null,
        problems: [
          createProblem({
            code: "WL8002",
            source: "environment",
            message: "The project has test files but vitest is not installed in the app.",
          }),
        ],
      };
    }

    const vitest = options.vitest ?? runVitest;
    const outcome = await vitest(binary, vitestArguments(files), cwd);
    const found =
      outcome.report === undefined
        ? vitestRunFailure(outcome)
        : parseVitestReport(outcome.report, cwd);
    const total =
      typeof outcome.report === "object" && outcome.report !== null
        ? Reflect.get(outcome.report, "numTotalTests")
        : undefined;

    return {
      detail: typeof total === "number" ? `${total} test(s) ran` : null,
      problems: found,
    };
  });

  await run("conventions", async () => {
    const conventionFiles = await targets();

    return {
      detail: `${conventionFiles.length} file(s) checked`,
      // Facts come from the whole project even when only changed files are checked:
      // a route registered in one file may be referenced from another.
      problems: runConventions(
        cwd,
        conventionFiles,
        options.project,
        collectApiRouteFacts(cwd, await listSourceFiles(cwd)),
      ),
    };
  });

  // Keep the declared order even if a future step is added out of sequence.
  steps.sort((first, second) => CHECK_STEPS.indexOf(first.name) - CHECK_STEPS.indexOf(second.name));

  const exitCode = checkExitCode(problems);
  const errors = problems.filter((problem) => problem.severity === "error");

  return {
    schemaVersion: 1,
    ok: exitCode === 0,
    exitCode,
    changed,
    files,
    steps,
    problems,
    summary: {
      errors: errors.length,
      warnings: problems.length - errors.length,
      code: errors.filter((problem) => problem.category === "code").length,
      environment: errors.filter((problem) => problem.category === "environment").length,
    },
  };
}
