import { createRequire } from "node:module";

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
 * Whether a package resolves from the project's working directory, not from
 * core's own `node_modules`, so the answer reflects what the app installed.
 * Read at call time: the working directory is the app's.
 */
export function isInstalledInProject(packageName: string): boolean {
  try {
    createRequire(`${process.cwd()}/package.json`).resolve(packageName);
    return true;
  } catch {
    return false;
  }
}
