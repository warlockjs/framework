import { colors } from "@mongez/copper";
import type { CheckReport } from "../../../tooling/check/check-report.types";
import type { ToolingProblem } from "../../../tooling/problem";

/** `file:line:col`, as much of it as the problem has. */
function locationOf(problem: ToolingProblem): string {
  if (!problem.file) return "(project)";
  if (problem.line === null) return problem.file;

  return `${problem.file}:${problem.line}${problem.column === null ? "" : `:${problem.column}`}`;
}

/**
 * Two lines per problem: `file:line:col  CODE  message (rule)`, then the fix
 * hint. Uncolored, so it is testable; {@link printProblems} adds color.
 */
export function formatProblemLines(problems: readonly ToolingProblem[]): string[] {
  return problems.flatMap((problem) => [
    `${locationOf(problem)}  ${problem.code}  ${problem.message.split("\n")[0]}${problem.rule ? ` (${problem.rule})` : ""}`,
    `  → ${problem.hint}`,
  ]);
}

/** Print problems to stdout, errors in red and warnings in yellow. */
export function printProblems(problems: readonly ToolingProblem[]): void {
  for (const problem of problems) {
    const paint = problem.severity === "error" ? colors.red : colors.yellow;
    const [first, second] = formatProblemLines([problem]);

    console.log(paint(first ?? ""));
    console.log(colors.dim(second ?? ""));
  }
}

const STEP_SYMBOL: Record<CheckReport["steps"][number]["status"], string> = {
  passed: "✓",
  failed: "✗",
  skipped: "-",
  blocked: "!",
};

/** The step list and the verdict line of a check report, uncolored. */
export function formatCheckSummary(report: CheckReport): string[] {
  const lines = report.steps.map(
    (step) =>
      `${STEP_SYMBOL[step.status]} ${step.name.padEnd(12)} ${step.status}${step.detail ? ` — ${step.detail}` : ""}`,
  );
  const { errors, warnings, environment } = report.summary;

  lines.push("");
  lines.push(
    report.exitCode === 0
      ? `OK: ${warnings} warning(s)`
      : report.exitCode === 2
        ? `${errors} error(s), ${environment} from this machine — fix the environment first (exit 2)`
        : `${errors} error(s) in the code (exit 1)`,
  );

  return lines;
}
