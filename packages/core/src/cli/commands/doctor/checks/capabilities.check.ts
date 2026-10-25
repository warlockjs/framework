import { listCapabilities } from "../../../../capabilities/capability";
import type { DoctorCheck } from "../check.types";

/**
 * Warns about a required capability that nothing provided while the app booted.
 *
 * NEEDS A BOOTED APP: capabilities are filled by `provideCapability()` calls in
 * modules that load at boot (`main.ts`, `routes.ts`, event files), and the boot
 * pass imports exactly those modules. A required capability still empty after
 * it is a slot the first caller will trip over with a `WL2008` error.
 *
 * Verdicts:
 * - no capability defined → not applicable, no line;
 * - the boot pass did not complete → not applicable (the routes check already
 *   reports that);
 * - a required capability has no provider → `warn`, naming each one and the
 *   file that defined it (a warning, not a failure: the code path that reads it
 *   may be one the app never takes);
 * - otherwise → `ok`, with the count.
 */
export const capabilitiesCheck: DoctorCheck = {
  name: "capabilities",
  run: (context) => {
    const capabilities = listCapabilities();

    if (capabilities.length === 0 || !context.booted) return undefined;

    const missing = capabilities.filter(
      (capability) => capability.required && !capability.provided,
    );

    if (missing.length > 0) {
      return {
        name: "capabilities",
        status: "warn",
        code: "WL2008",
        detail:
          `${missing.length} required capability(ies) have no provider after boot:\n` +
          missing
            .map(
              (capability) =>
                `  - ${capability.name}${capability.definedIn ? ` (defined in ${capability.definedIn})` : ""}`,
            )
            .join("\n") +
          "\ncall provideCapability() from a main.ts, routes.ts or event file, or define it with { required: false }",
      };
    }

    return {
      name: "capabilities",
      status: "ok",
      detail: `${capabilities.length} capability(ies), every required one provided`,
    };
  },
};
