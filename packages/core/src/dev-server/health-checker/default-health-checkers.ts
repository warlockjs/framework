import { OxlintHealthChecker } from "./checkers/oxlint-health-checker";
import { TypescriptHealthChecker } from "./checkers/typescript-health-checker";
import type {
  BuiltInHealthCheckerOptions,
  FileHealthCheckerContract,
} from "./file-health-checker.contract";
import { findOxlint } from "./oxlint-runner";

/** Explicit arrays remain custom-only; built-in booleans select among available checkers. */
export function defaultHealthCheckers(
  options: BuiltInHealthCheckerOptions = {},
  cwd = process.cwd(),
): FileHealthCheckerContract[] {
  if ("eslint" in options)
    throw new Error(
      "ESLint support was removed in 5.34.0. Remove healthCheckers.eslint and use Oxlint/Oxfmt; run npx warlock upgrade --from 5.33 --to 5.34.0.",
    );
  const checkers: FileHealthCheckerContract[] = [];
  if (options.typescript !== false) checkers.push(new TypescriptHealthChecker());
  if (options.oxlint !== false && findOxlint(cwd)) checkers.push(new OxlintHealthChecker());
  return checkers;
}
