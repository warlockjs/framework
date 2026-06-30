/**
 * @fileoverview Shared types for the `warlock doctor` diagnostics command.
 * @description A doctor check is a self-contained, READ-ONLY probe of one
 * facet of the application (routes, config, connectors, optional peers, health
 * endpoints, release hygiene). Each check resolves to a {@link CheckResult};
 * the runner aggregates them into a {@link DoctorReport} and derives an exit
 * code. Checks must never throw out — a thrown check is caught by the runner
 * and recorded as a `fail` so `doctor` itself can never crash.
 */

/**
 * Outcome of a single diagnostic check.
 *
 * - `"ok"`   — the facet is healthy; nothing to do.
 * - `"warn"` — non-fatal: a feature is unavailable or a soft expectation is
 *   unmet (e.g. an optional peer is not installed). Does NOT fail the command.
 * - `"fail"` — a release/runtime-blocking problem (e.g. a required config
 *   section is missing). Forces a non-zero exit.
 */
export type CheckStatus = "ok" | "warn" | "fail";

/**
 * The normalized result of running one {@link DoctorCheck}.
 */
export type CheckResult = {
  /** Stable, human-readable name of the check (e.g. `"routes"`). */
  name: string;

  /** Pass/warn/fail verdict. */
  status: CheckStatus;

  /** One-line, user-facing explanation of the verdict. */
  detail: string;
};

/**
 * A single diagnostic probe. The `run` function MUST be read-only — it may
 * introspect the router, connectors, config and `package.json`, but must never
 * mutate state. It may be sync or async, and may throw: the runner converts a
 * thrown check into a `fail` result rather than crashing `doctor`.
 */
export type DoctorCheck = {
  /** Stable, human-readable name surfaced in the report. */
  name: string;

  /** Performs the probe and returns its verdict + detail. */
  run: () => CheckResult | Promise<CheckResult>;
};

/**
 * Aggregate outcome of running every check.
 */
export type DoctorReport = {
  /** Every check result, in registration order. */
  results: CheckResult[];

  /** Count of results per status. */
  summary: Record<CheckStatus, number>;

  /**
   * Whether any check failed. The command exits non-zero when this is `true`;
   * warnings alone keep a zero exit.
   */
  hasFailures: boolean;

  /**
   * The process exit code the command should use: `1` when {@link hasFailures}
   * is `true`, otherwise `0`.
   */
  exitCode: 0 | 1;
};
