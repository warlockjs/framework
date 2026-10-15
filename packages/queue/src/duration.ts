import { InvalidDurationError } from "./errors";
import type { Duration } from "./types";

const UNIT_MILLISECONDS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

/**
 * Convert a {@link Duration} to milliseconds. Numbers are already
 * milliseconds. Anything else is rejected loudly rather than guessed at.
 */
export function toMilliseconds(value: Duration | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new InvalidDurationError(value);
    }

    return Math.round(value);
  }

  const match = typeof value === "string" ? DURATION_PATTERN.exec(value.trim()) : null;

  if (!match) {
    throw new InvalidDurationError(value);
  }

  return Math.round(Number(match[1]) * UNIT_MILLISECONDS[match[2]!]!);
}
