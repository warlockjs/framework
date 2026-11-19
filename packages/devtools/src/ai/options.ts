import type { DevtoolsMode } from "../production/contracts";
import type { DevtoolsAiOptions, ResolvedDevtoolsAiOptions } from "./types";

/** Default `retentionDays` per mode. */
export const DEVTOOLS_AI_RETENTION_DAYS: Readonly<Record<DevtoolsMode, number>> = {
  development: 30,
  production: 90,
};

/** Default `flushIntervalMs`. */
export const DEVTOOLS_AI_FLUSH_INTERVAL_MS = 60_000;

/**
 * Applies the defaults of `devtools.ai` for `mode`. Throws an `Error` naming
 * the option when `retentionDays` is not a whole number from 1 to 400 or
 * `flushIntervalMs` is below 5000 (the same style as `resolveDevtoolsOptions`).
 */
export function resolveDevtoolsAiOptions(
  options: DevtoolsAiOptions | undefined,
  mode: DevtoolsMode,
): ResolvedDevtoolsAiOptions {
  const reports = options?.reports ?? true;
  const retentionDays = options?.retentionDays ?? DEVTOOLS_AI_RETENTION_DAYS[mode];
  const flushIntervalMs = options?.flushIntervalMs ?? DEVTOOLS_AI_FLUSH_INTERVAL_MS;

  if (typeof reports !== "boolean") {
    throw new Error('Devtools option "ai.reports" must be true or false.');
  }

  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 400) {
    throw new Error('Devtools option "ai.retentionDays" must be a whole number from 1 to 400.');
  }

  if (
    typeof flushIntervalMs !== "number" ||
    !Number.isFinite(flushIntervalMs) ||
    flushIntervalMs < 5000
  ) {
    throw new Error('Devtools option "ai.flushIntervalMs" must be at least 5000.');
  }

  return { reports, retentionDays, flushIntervalMs, mode };
}
