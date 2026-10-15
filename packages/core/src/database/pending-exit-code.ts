import type { PendingMigrationsResult } from "./resolve-pending-migrations";

/**
 * Exit codes for `warlock migrate --pending`.
 *
 * `--pending` is a GATE, not a report: it is written into `migrate --pending &&
 * deploy` and into CI steps asserting nothing is outstanding. So it must
 * distinguish three outcomes, not two.
 *
 * Two codes would fold `pending` and `unavailable` into a single non-zero, and
 * a script could no longer tell "three migrations are waiting" from "I could
 * not work out what is waiting". Those demand opposite responses — the first is
 * "run them", the second is "stop and get a human".
 *
 * `warlock migrate --list` is the report half and always exits `0`, whatever
 * the pending section says.
 */
export const PENDING_EXIT_CODE = {
  /** Computed, and nothing is pending. */
  clear: 0,
  /** Computed, and at least one migration is pending. */
  pending: 1,
  /** Could not be computed. Never conflate this with `clear`. */
  unavailable: 2,
} as const;

export type PendingExitCode = (typeof PENDING_EXIT_CODE)[keyof typeof PENDING_EXIT_CODE];

/**
 * Map a resolution outcome onto the exit code a gate should report.
 *
 * @example
 * exitCodeFor({ type: "resolved", migrations: [] }); // 0
 * exitCodeFor({ type: "unavailable", reason: "…" }); // 2
 */
export function exitCodeFor(result: PendingMigrationsResult): PendingExitCode {
  if (result.type === "unavailable") {
    return PENDING_EXIT_CODE.unavailable;
  }

  return result.migrations.length > 0 ? PENDING_EXIT_CODE.pending : PENDING_EXIT_CODE.clear;
}
