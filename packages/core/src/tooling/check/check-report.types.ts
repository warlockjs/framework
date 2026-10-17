import type { ToolingProblem } from "../problem";

/** The steps `warlock check` runs, in order. */
export const CHECK_STEPS = ["environment", "typecheck", "lint", "tests", "conventions"] as const;

/** One step name. */
export type CheckStepName = (typeof CHECK_STEPS)[number];

/**
 * - `passed`: ran and found no error.
 * - `failed`: ran and found at least one error-severity problem.
 * - `skipped`: does not apply (no lint config, no tests, nothing changed, `--skip`).
 * - `blocked`: could not run because of this machine; an environment problem says why.
 */
export type CheckStepStatus = "passed" | "failed" | "skipped" | "blocked";

/** One step of the report. */
export type CheckStep = {
  name: CheckStepName;
  status: CheckStepStatus;
  durationMs: number;
  /** One line on what the step did or why it did not run, or `null`. */
  detail: string | null;
};

/**
 * Exit codes of `warlock check` and `warlock typecheck`:
 *
 * | Code | Meaning                                                                    |
 * | ---- | -------------------------------------------------------------------------- |
 * | 0    | no error-severity problem (warnings are allowed)                           |
 * | 1    | problems in your code only: type, lint, test or convention errors          |
 * | 2    | this machine: Node version, missing tool, unreachable service, busy port,  |
 * |      | git unavailable, a tool that crashed — the run is incomplete               |
 *
 * 2 wins over 1: when the machine kept a step from running, the run did not
 * check everything, so "only your code is wrong" cannot be claimed.
 */
export const CHECK_EXIT_CODES = {
  ok: 0,
  code: 1,
  environment: 2,
} as const;

/** One of {@link CHECK_EXIT_CODES}. */
export type CheckExitCode = (typeof CHECK_EXIT_CODES)[keyof typeof CHECK_EXIT_CODES];

/** The exit code for a set of problems; see {@link CHECK_EXIT_CODES}. */
export function checkExitCode(problems: readonly ToolingProblem[]): CheckExitCode {
  const errors = problems.filter((problem) => problem.severity === "error");

  if (errors.some((problem) => problem.category === "environment")) {
    return CHECK_EXIT_CODES.environment;
  }

  return errors.length > 0 ? CHECK_EXIT_CODES.code : CHECK_EXIT_CODES.ok;
}

/** What `warlock check --json` prints. */
export type CheckReport = {
  schemaVersion: 1;
  /** `true` when the exit code is 0. */
  ok: boolean;
  exitCode: CheckExitCode;
  /** Whether the run was limited to changed files. */
  changed: boolean;
  /** The changed files the run was limited to (project-relative), or `null` for a full run. */
  files: string[] | null;
  steps: CheckStep[];
  /** One entry per problem, in step order. */
  problems: ToolingProblem[];
  summary: {
    errors: number;
    warnings: number;
    /** Error-severity problems in the code. */
    code: number;
    /** Error-severity problems with the machine. */
    environment: number;
  };
};
