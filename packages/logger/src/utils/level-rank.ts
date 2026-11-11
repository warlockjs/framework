import type { LogLevel } from "../types";

/**
 * Severity ranks used by the minimum-level filters. Higher number = more
 * severe. `debug` is noisiest and easiest to drop; `success` sits beside
 * `info` — it's an informational outcome, not a warning.
 */
export const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * Whether `level` is at least as severe as `minLevel`. An unknown level is
 * kept: a filter must never silently swallow an entry it cannot rank.
 */
export function meetsMinLevel(level: LogLevel, minLevel: LogLevel | undefined): boolean {
  if (!minLevel) return true;

  const rank = LEVEL_RANK[level];
  const minimum = LEVEL_RANK[minLevel];

  if (rank === undefined || minimum === undefined) return true;

  return rank >= minimum;
}
