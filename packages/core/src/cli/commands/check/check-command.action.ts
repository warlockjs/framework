import type { CommandActionData } from "../../../commands/types";
import { CHECK_STEPS, type CheckStepName } from "../../../tooling/check/check-report.types";
import { runCheck } from "../../../tooling/check/run-check";
import { flushAndExit } from "../../flush-and-exit";
import { childTypecheckRunner } from "./child-typecheck";
import { formatCheckSummary, printProblems } from "./format-problems";

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isStepName(value: string): value is CheckStepName {
  return (CHECK_STEPS as readonly string[]).includes(value);
}

/** Parse `--skip typecheck,lint`; throws on an unknown step name. */
export function parseSkippedSteps(value: string | undefined): CheckStepName[] {
  if (!value) return [];

  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const unknown = names.filter((name) => !isStepName(name));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown check step(s): ${unknown.join(", ")}. Valid steps: ${CHECK_STEPS.join(", ")}.`,
    );
  }

  return names.filter(isStepName);
}

/**
 * Action behind `warlock check`.
 *
 * Runs {@link runCheck} with the typecheck in a child `warlock typecheck`
 * process (so a heap overflow is reported, not fatal), prints the problems and
 * the step summary — or, with `--json`, exactly the report — and exits with
 * the report's code: 0 clean, 1 your code, 2 this machine.
 *
 * @param data Parsed CLI args: `changed`, `base`, `skip`, `project`, `json`.
 */
export async function checkCommandAction({ options }: CommandActionData): Promise<void> {
  const lint = stringOption(options.lint);
  if (lint === "eslint") {
    throw new Error(
      "ESLint support was removed in 5.34.0. Oxlint/Oxfmt is the default. Run npx warlock upgrade --from 5.33 --to 5.34.0.",
    );
  }
  if (lint !== undefined && lint !== "oxlint") {
    throw new Error("Unknown lint tool. Use --lint oxlint.");
  }
  const base = stringOption(options.base);
  const changed = options.changed === true || base !== undefined;
  const project = stringOption(options.project);
  const skip = parseSkippedSteps(stringOption(options.skip));
  const cliEntry = process.argv[1];
  const flags = [...(changed ? ["--changed"] : []), ...(base ? ["--base", base] : [])];

  const report = await runCheck({
    lint,
    fix: options.fix === true,
    changed,
    base,
    skip,
    project,
    // Progress goes to stderr in both modes, so `--json` keeps stdout a single JSON document.
    onProgress: (message) => process.stderr.write(`${message}\n`),
    ...(cliEntry ? { typecheck: childTypecheckRunner(cliEntry, flags) } : {}),
  });

  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printProblems(report.problems);

    if (report.problems.length > 0) console.log("");

    for (const line of formatCheckSummary(report)) {
      console.log(line);
    }
  }

  if (report.exitCode !== 0) {
    await flushAndExit(report.exitCode);
  }
}
