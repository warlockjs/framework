import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DoctorCheck } from "../check.types";

/**
 * @fileoverview Small readers shared by the deployment-settings checks
 * (`upload-limits`, `cors`, `auth-tokens`, `trust-proxy`, `request-timeout`,
 * `production-logging`, `compression`, `env-files`, `memory-cache`).
 */

/**
 * Whether a config value is set. `@mongez/config` answers `null` (not
 * `undefined`) for an unregistered key, and `setConfig(name, undefined)`
 * stores `null`, so both nullish values mean "not set".
 */
export function isSet<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * A byte count as a short size for a report line: `25 MB`, `12 GB`, `512 KB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes === Infinity) return "unlimited";

  const [unit, size]: [string, number] =
    bytes >= GB ? ["GB", GB] : bytes >= MB ? ["MB", MB] : bytes >= KB ? ["KB", KB] : ["bytes", 1];

  const value = Math.round((bytes / size) * 10) / 10;

  return `${value} ${unit}`;
}

/**
 * Whether a package is installed where the project's working directory would
 * find it, not in core's own `node_modules`, so the answer reflects what the
 * app installed. Read at call time: the working directory is the app's.
 *
 * Looks for the package's `package.json` in each `node_modules` directory a
 * lookup from the project walks, instead of resolving the package itself: a
 * package whose `exports` offer only an `import` condition (every
 * `@warlock.js/*` package) cannot be resolved by `require`, though it is
 * installed.
 */
export function isInstalledInProject(packageName: string): boolean {
  try {
    const lookupPaths =
      createRequire(`${process.cwd()}/package.json`).resolve.paths(packageName) ?? [];

    return lookupPaths.some((directory) =>
      existsSync(path.join(directory, packageName, "package.json")),
    );
  } catch {
    return false;
  }
}

/**
 * A deployment-settings check that cannot fail the command. The runner turns a
 * thrown check into a `fail`, which exits non-zero; these checks only ever
 * warn, so an error while reading the app's config (a getter that throws, a
 * custom log channel that throws) becomes a `warn` naming the error instead.
 */
export function warnOnError(check: DoctorCheck): DoctorCheck {
  return {
    name: check.name,
    run: async (context) => {
      try {
        return await check.run(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
          name: check.name,
          status: "warn",
          detail: `could not read the setting this check reports on: ${message}`,
        };
      }
    },
  };
}
