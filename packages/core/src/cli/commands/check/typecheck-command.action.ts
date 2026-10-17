import type { CommandActionData } from "../../../commands/types";
import { listChangedFiles } from "../../../tooling/check/changed-files";
import { checkExitCode } from "../../../tooling/check/check-report.types";
import { runTypecheck, type TypecheckResult } from "../../../tooling/typecheck/run-typecheck";
import { flushAndExit } from "../../flush-and-exit";
import { printProblems } from "./format-problems";

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Action behind `warlock typecheck`.
 *
 * Typechecks incrementally (state in `.warlock/cache/typecheck.tsbuildinfo`).
 * `--changed` limits diagnostics to the files changed against HEAD (or the
 * merge base with `--base`) and the files importing them. `--json` prints the
 * result alone. Exit codes match `warlock check`: 0 clean, 1 type errors,
 * 2 this machine (git unavailable for `--changed`).
 *
 * @param data Parsed CLI args: `changed`, `base`, `project`, `json`.
 */
export async function typecheckCommandAction({ options }: CommandActionData): Promise<void> {
  const cwd = process.cwd();
  const base = stringOption(options.base);
  const changed = options.changed === true || base !== undefined;
  const project = stringOption(options.project);
  let result: TypecheckResult;

  if (changed) {
    const listed = await listChangedFiles({ cwd, base });

    result =
      "problem" in listed
        ? {
            ok: false,
            mode: "files",
            files: null,
            checkedFiles: 0,
            durationMs: 0,
            buildInfoFile: null,
            problems: [listed.problem],
          }
        : runTypecheck({ cwd, project, files: listed.files });
  } else {
    result = runTypecheck({ cwd, project });
  }

  const exitCode = checkExitCode(result.problems);

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printProblems(result.problems);
    console.log(
      `${result.problems.length === 0 ? "No type errors" : `${result.problems.length} problem(s)`} in ${result.checkedFiles} file(s) (${result.durationMs}ms)`,
    );
  }

  if (exitCode !== 0) {
    await flushAndExit(exitCode);
  }
}
