import { EslintHealthChecker } from "./checkers/eslint-health-checker";
import { OxlintHealthChecker } from "./checkers/oxlint-health-checker";
import { TypescriptHealthChecker } from "./checkers/typescript-health-checker";
import type {
  BuiltInHealthCheckerOptions,
  FileHealthCheckerContract,
} from "./file-health-checker.contract";
import { hasEslint, warnEslintDeprecation } from "./eslint-support";
import { findOxlint } from "./oxlint-runner";

export { hasEslint } from "./eslint-support";

/** Explicit arrays remain custom-only; built-in booleans select among available checkers. */
export function defaultHealthCheckers(
  options: BuiltInHealthCheckerOptions = {},
  cwd = process.cwd(),
): FileHealthCheckerContract[] {
  const checkers: FileHealthCheckerContract[] = [];
  if (options.typescript !== false) checkers.push(new TypescriptHealthChecker());
  if (options.eslint === true) {
    warnEslintDeprecation();
    if (hasEslint(cwd)) checkers.push(new EslintHealthChecker());
  }
  if (options.oxlint !== false && findOxlint(cwd)) checkers.push(new OxlintHealthChecker());
  return checkers;
}
