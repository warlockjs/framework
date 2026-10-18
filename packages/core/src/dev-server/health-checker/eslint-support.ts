import { existsSync } from "node:fs";
import path from "node:path";

/** Whether the app has an ESLint flat config at its root. */
export function hasEslint(cwd: string): boolean {
  return ["js", "mjs", "cjs", "ts", "mts", "cts"].some((extension) =>
    existsSync(path.join(cwd, `eslint.config.${extension}`)),
  );
}

export const ESLINT_DEPRECATION =
  "Deprecated: ESLint + Prettier support will be removed in 5.34.0. Migrate to Oxlint + Oxfmt with npx warlock upgrade --from 5.32 --to 5.33.0; remove the ESLint opt-in afterwards.";

let warned = false;

/** One warning per process, on stderr so JSON reports stay parseable. */
export function warnEslintDeprecation(): void {
  if (warned) return;
  warned = true;
  console.warn(ESLINT_DEPRECATION);
}
