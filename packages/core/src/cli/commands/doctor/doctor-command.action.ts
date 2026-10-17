import type { CommandActionData } from "../../../commands/types";
import { bootForDiagnostics } from "./boot-for-diagnostics";
import { defaultDoctorChecks } from "./checks";
import { fixLocaleSources } from "./checks/locales-ts-deprecated.check";
import { flushAndExit } from "../../flush-and-exit";
import { withConsoleOnStderr } from "../routes/with-console-on-stderr";
import { printReport, toDoctorJson } from "./format-report";
import { runChecks } from "./run-checks";

/**
 * Action behind `warlock doctor`.
 *
 * Two steps, in this order and for a reason: ONE boot pass, then every check
 * against what that pass observed. The checks never boot anything themselves,
 * so the report cannot contain two lines that inspected the app at different
 * moments and contradicted each other — which is exactly what it used to
 * contain (`routes: 0 registered` beside `health: /health + /ready
 * registered`, in the same run, on an app serving fourteen routes).
 *
 * The pass boots every connector and starts none, so no database, cache or
 * socket connection is opened and no port is bound. See
 * `boot-for-diagnostics.ts`.
 *
 * A failing check is REPORTED (a line in the report + a non-zero exit), never
 * thrown: the runner converts any thrown check into a `fail` result first.
 *
 * On success this simply returns; the CLI manager then prints its own success
 * banner and exits zero — which also disposes of the handles the boot pass
 * left open (a Fastify instance, a Vite dev server for `web` apps).
 *
 * With `--json` the report is printed as JSON (see `toDoctorJson`): every
 * finding carries its stable `WL` code, `hint`, `skill` and `docs`.
 *
 * @param data Parsed CLI args: the optional safe migration flag and `--json`.
 */
export async function doctorCommandAction(data: CommandActionData): Promise<void> {
  const json = data.options.json === true;

  // With `--json`, stdout carries the report alone: the fix log and the boot's
  // progress lines go to stderr.
  const log = json ? console.error : console.log;

  if (data.options.fix === true) {
    for (const result of fixLocaleSources()) {
      const file = result.file.replace(process.cwd(), ".").replaceAll("\\", "/");
      log(`${result.convertible ? "converted" : "manual"} ${file}: ${result.reason}`);
    }
  }

  const context = json ? await withConsoleOnStderr(bootForDiagnostics) : await bootForDiagnostics();

  const report = await runChecks(defaultDoctorChecks, context);

  if (json) {
    console.log(JSON.stringify(toDoctorJson(report), null, 2));
  } else {
    printReport(report);
  }

  if (report.hasFailures) {
    await flushAndExit(report.exitCode);
  }
}
