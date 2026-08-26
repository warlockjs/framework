/**
 * @fileoverview Shared types for the `warlock doctor` diagnostics command.
 * @description A doctor check is a self-contained probe of one facet of the
 * application. Each check is handed the {@link DoctorBootContext} produced by
 * the boot pass (see `boot-for-diagnostics.ts`) and resolves to a
 * {@link CheckResult} — or to `undefined`, meaning the check does not apply to
 * this project and must not appear in the report at all. The runner aggregates
 * the results into a {@link DoctorReport} and derives an exit code. Checks must
 * never throw out — a thrown check is caught by the runner and recorded as a
 * `fail` so `doctor` itself can never crash.
 *
 * THE STANDARD EVERY CHECK IS HELD TO: a warning that a healthy project
 * triggers is a bug, not a nuance. Doctor's only asset is being believed, and
 * every false positive is spent from the same budget the one true finding will
 * need. If a check cannot say something that is both true and actionable about
 * a given project, it returns `undefined` and stays silent.
 */

/**
 * A module the boot pass could not import, and why.
 */
export type ModuleFailure = {
  /** Project-relative path of the file that failed. */
  file: string;

  /** The underlying error message (the cause, not the wrapper). */
  message: string;
};

/**
 * What the boot pass observed. Handed to every check so no check has to boot
 * anything itself — and so the report cannot contain two checks that booted the
 * app differently and disagreed about it.
 */
export type DoctorBootContext = {
  /**
   * Whether the pass completed. `false` means app discovery itself failed and
   * every app-dependent check must say so rather than report a zero.
   */
  booted: boolean;

  /** Number of `src/app/<module>/routes.ts` files found on disk. */
  routeModules: number;

  /** Routes registered by app modules alone, before late connectors booted. */
  appRoutes: number;

  /** Routes on the app router once every connector had booted. */
  totalRoutes: number;

  /** Every app module that failed to import, in load order. */
  moduleFailures: ModuleFailure[];

  /** What happened to the connectors. */
  connectors: {
    /** Names of every registered connector (built-ins + the app's own). */
    registered: string[];

    /**
     * The connectors the APP configured, i.e. registered names that are not
     * framework built-ins. This is the part of the list that varies between
     * projects — the built-in count is a constant and diagnoses nothing.
     */
    configured: string[];

    /** Names that booted without throwing. */
    booted: string[];

    /** Connectors doctor deliberately did not boot, with the reason. */
    skipped: { name: string; reason: string }[];

    /** Connectors whose `boot()` threw, with the message. */
    failures: { name: string; message: string }[];

    /**
     * Set when `warlock.config.ts > connectors` was itself refused (duplicate
     * or reserved name) — a config that would crash the next real boot.
     */
    registrationError?: string;
  };
};

/**
 * Outcome of a single diagnostic check.
 *
 * - `"ok"`   — the facet is healthy; nothing to do.
 * - `"warn"` — something a careful reader should look at, but which does not
 *   block. Reserved for genuinely unusual states: a check must not warn about
 *   a configuration the framework's own scaffold produces.
 * - `"fail"` — a defect that will break the app or the release (a required
 *   config section missing, a route module that will not import, a configured
 *   driver whose package is not installed). Forces a non-zero exit.
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
 * A single diagnostic probe.
 *
 * `run` receives the boot context and returns a verdict, or `undefined` when
 * the check is NOT APPLICABLE to this project — a changelog check on a private
 * application, a health-endpoint check on an app with no HTTP config. Returning
 * `undefined` removes the line from the report entirely; there is deliberately
 * no "skipped" status, because a report full of skipped lines is a report
 * nobody finishes reading.
 *
 * It may be sync or async, and may throw: the runner converts a thrown check
 * into a `fail` result rather than crashing `doctor`.
 */
export type DoctorCheck = {
  /** Stable, human-readable name surfaced in the report. */
  name: string;

  /** Performs the probe and returns its verdict, or `undefined` if N/A. */
  run: (
    context: DoctorBootContext,
  ) => CheckResult | undefined | Promise<CheckResult | undefined>;
};

/**
 * Aggregate outcome of running every check.
 */
export type DoctorReport = {
  /** Every applicable check result, in registration order. */
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
