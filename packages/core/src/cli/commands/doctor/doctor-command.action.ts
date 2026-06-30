import type { CommandActionData } from "../../types";
import { defaultDoctorChecks } from "./checks";
import { printReport } from "./format-report";
import { runChecks } from "./run-checks";

/**
 * Action behind `warlock doctor`. Runs the default read-only diagnostic
 * checks, prints the grouped pass/warn/fail report, and — when any check
 * failed — exits the process with a non-zero code so the command signals
 * failure to scripts/CI.
 *
 * A failing check is REPORTED (a line in the report + a non-zero exit), never
 * thrown: the runner converts any thrown check into a `fail` result first.
 *
 * On success this simply returns; the CLI manager then prints its own success
 * banner and exits zero.
 *
 * @param _data Parsed CLI args (unused — doctor takes no positional args).
 */
export async function doctorCommandAction(_data: CommandActionData): Promise<void> {
  const report = await runChecks(defaultDoctorChecks);

  printReport(report);

  if (report.hasFailures) {
    process.exit(report.exitCode);
  }
}
