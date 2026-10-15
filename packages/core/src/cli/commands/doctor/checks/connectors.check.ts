import type { DoctorCheck } from "../check.types";

/**
 * Reports whether the app's connectors survive boot.
 *
 * NEEDS A BOOTED APP: the boot pass runs every connector's `boot()` and no
 * `start()`, and this check reads the outcome.
 *
 * WHAT THIS REPLACED, AND WHY: the previous version printed
 * `11 registered, none active`. Both halves were tautologies. Eleven is the
 * number of built-in connectors the manager constructs when its module is
 * imported — it is the same on every project that has ever existed and says
 * nothing about the app. And "none active" was guaranteed, because `active` is
 * set by `start()` and doctor deliberately never starts anything: the warning
 * could not be absent from a healthy app, so it could not mean anything on a
 * broken one.
 *
 * What is reported instead is a fact that varies with the project and can be
 * wrong: the connectors the app itself configured, and whether each of them
 * boots. A connector that throws on boot is a boot-time crash the user has not
 * hit yet.
 *
 * Verdicts:
 * - `warlock.config.ts > connectors` refused (duplicate or reserved name) →
 *   `fail`. The next real boot would throw the same error;
 * - a connector's `boot()` threw → `fail`, named, with the message;
 * - otherwise → `ok`, listing what booted.
 */
export const connectorsCheck: DoctorCheck = {
  name: "connectors",
  run: (context) => {
    const { connectors } = context;

    if (connectors.registrationError) {
      return {
        name: "connectors",
        status: "fail",
        detail: `warlock.config.ts > connectors was refused: ${connectors.registrationError}`,
      };
    }

    if (connectors.failures.length > 0) {
      return {
        name: "connectors",
        status: "fail",
        detail:
          `${connectors.failures.length} connector(s) failed to boot:\n` +
          connectors.failures
            .map((failure) => `  - ${failure.name}: ${failure.message}`)
            .join("\n"),
      };
    }

    if (!context.booted) {
      return undefined;
    }

    const skipped = connectors.skipped
      .map((entry) => `; skipped ${entry.name} (${entry.reason})`)
      .join("");

    const configured =
      connectors.configured.length > 0
        ? `${connectors.configured.join(", ")} from warlock.config.ts + ` +
          `${connectors.registered.length - connectors.configured.length} built-in`
        : `${connectors.registered.length} built-in, none configured in warlock.config.ts`;

    return {
      name: "connectors",
      status: "ok",
      detail: `all booted without error (${configured})${skipped}`,
    };
  },
};
