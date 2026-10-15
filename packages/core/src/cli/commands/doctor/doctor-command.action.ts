import type { CommandActionData } from "../../../commands/types";
import { bootForDiagnostics } from "./boot-for-diagnostics";
import { defaultDoctorChecks } from "./checks";
import { fixLocaleSources } from "./checks/locales-ts-deprecated.check";
import { printReport } from "./format-report";
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
 * @param data Parsed CLI args, including the optional safe migration flag.
 */
export async function doctorCommandAction(data: CommandActionData): Promise<void> {
  if (data.options.fix === true) {
    for (const result of fixLocaleSources()) {
      const file = result.file.replace(process.cwd(), ".").replaceAll("\\", "/");
      console.log(`${result.convertible ? "converted" : "manual"} ${file}: ${result.reason}`);
    }
  }
  const context = await bootForDiagnostics();

  const report = await runChecks(defaultDoctorChecks, context);

  printReport(report);

  if (report.hasFailures) {
    process.exit(report.exitCode);
  }
}
