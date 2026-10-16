import { existsSync } from "node:fs";
import path from "node:path";
import { EslintHealthChecker } from "./checkers/eslint-health-checker";
import { OxlintHealthChecker } from "./checkers/oxlint-health-checker";
import { TypescriptHealthChecker } from "./checkers/typescript-health-checker";
import type {
  BuiltInHealthCheckerOptions,
  FileHealthCheckerContract,
} from "./file-health-checker.contract";
import { findOxlint } from "./oxlint-runner";

function hasEslint(cwd: string): boolean {
  // ESLint is a core dependency, so an app needs only its configuration.
  return ["js", "mjs", "cjs", "ts", "mts", "cts"].some((extension) =>
    existsSync(path.join(cwd, `eslint.config.${extension}`)),
  );
}

/** Explicit arrays remain custom-only; built-in booleans select among available checkers. */
export function defaultHealthCheckers(
  options: BuiltInHealthCheckerOptions = {},
  cwd = process.cwd(),
): FileHealthCheckerContract[] {
  const checkers: FileHealthCheckerContract[] = [];
  if (options.typescript !== false) checkers.push(new TypescriptHealthChecker());
  if (options.eslint !== false && hasEslint(cwd)) checkers.push(new EslintHealthChecker());
  if (options.oxlint !== false && findOxlint(cwd)) checkers.push(new OxlintHealthChecker());
  return checkers;
}
