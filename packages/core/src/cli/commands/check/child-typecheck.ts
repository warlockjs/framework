import { execFile } from "node:child_process";
import type { TypecheckRunner } from "../../../tooling/check/run-check";
import { createProblem } from "../../../tooling/problem";
import type { TypecheckResult } from "../../../tooling/typecheck/run-typecheck";

function isTypecheckResult(value: unknown): value is TypecheckResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(Reflect.get(value, "problems")) &&
    typeof Reflect.get(value, "checkedFiles") === "number"
  );
}

/**
 * Run the typecheck step as `warlock typecheck --json` in a child process.
 *
 * The compiler is the one step that can exhaust the heap on a large app. In
 * its own process an overflow ends only that process, and `warlock check`
 * still prints its report — with a `WL8007` environment problem instead of
 * dying without output.
 *
 * @param cliEntry The warlock CLI script (`process.argv[1]` of `warlock check`).
 * @param flags The `--changed` / `--base` flags of the parent run, so the child
 *   lists the same changed files.
 */
export function childTypecheckRunner(cliEntry: string, flags: readonly string[]): TypecheckRunner {
  return (options) =>
    new Promise((resolve) => {
      const args = [cliEntry, "typecheck", "--json", ...flags];

      if (options.project) args.push("--project", options.project);

      execFile(
        process.execPath,
        args,
        {
          cwd: options.cwd ?? process.cwd(),
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          let parsed: unknown;

          try {
            parsed = JSON.parse(stdout);
          } catch {
            parsed = undefined;
          }

          if (isTypecheckResult(parsed)) {
            resolve(parsed);
            return;
          }

          const outOfMemory = /heap out of memory|ERR_WORKER_OUT_OF_MEMORY/i.test(stderr);
          const how = error?.signal
            ? `was killed (${error.signal})`
            : `exited with ${String(error?.code ?? 0)}`;

          resolve({
            ok: false,
            mode: options.files ? "files" : "program",
            files: null,
            checkedFiles: 0,
            durationMs: 0,
            buildInfoFile: null,
            problems: [
              createProblem({
                code: "WL8007",
                source: "environment",
                message: `The typecheck ${outOfMemory ? "ran out of memory" : how}: ${stderr.trim().split("\n").slice(-3).join(" ") || "no output"}`,
              }),
            ],
          });
        },
      );
    });
}
