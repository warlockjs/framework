import type { DoctorBootContext, DoctorCheck } from "../check.types";

/**
 * Describe the failed modules as an indented block, one per line, cause first.
 * The file that failed is the only thing that makes this actionable, so it is
 * never summarised away.
 */
function describeFailures(context: DoctorBootContext): string {
  return context.moduleFailures
    .map((failure) => `  - ${failure.file}: ${failure.message}`)
    .join("\n");
}

/**
 * Reports the route surface the app will actually serve.
 *
 * NEEDS A BOOTED APP — and now gets one. Routes exist only as the side effect of
 * importing the module that declares them, so a doctor that did not import app
 * code reported `0 routes` for an app the dev server served fourteen routes
 * for. The boot pass imports the same modules, in the same order, and boots
 * (never starts) the same connectors, so the number printed here is the number
 * `warlock dev` prints for the same project — the two are read off the same
 * router after the same registrations.
 *
 * Verdicts:
 * - a module failed to import → `fail`, naming every file and its cause. This
 *   is the finding doctor exists for: a route file that throws on import is
 *   invisible at runtime, it just 404s;
 * - route modules on disk but nothing registered → `fail` (they loaded and
 *   registered nothing, which is not a state a working app is in);
 * - no route modules at all → `ok`, stated plainly. A worker or CLI-only app is
 *   a legitimate shape and must not be nagged;
 * - otherwise → `ok` with the count, split into what app code registered and
 *   what connectors added.
 */
export const routesCheck: DoctorCheck = {
  name: "routes",
  run: (context) => {
    if (context.moduleFailures.length > 0) {
      const count = context.moduleFailures.length;

      return {
        name: "routes",
        status: "fail",
        detail:
          `${count} app module(s) failed to load — the routes they declare will 404:\n` +
          describeFailures(context),
      };
    }

    if (!context.booted) {
      return {
        name: "routes",
        status: "fail",
        detail: "app modules could not be discovered — nothing to report on",
      };
    }

    if (context.totalRoutes === 0) {
      if (context.routeModules === 0) {
        return {
          name: "routes",
          status: "ok",
          detail: "no route modules found (src/app/*/routes.ts) — this app serves no HTTP routes",
        };
      }

      return {
        name: "routes",
        status: "fail",
        detail:
          `${context.routeModules} route module(s) loaded without error but registered 0 routes — ` +
          "every request will 404",
      };
    }

    const fromConnectors = context.totalRoutes - context.appRoutes;
    const breakdown =
      fromConnectors > 0
        ? `${context.appRoutes} from ${context.routeModules} route module(s), ` +
          `${fromConnectors} from connectors`
        : `from ${context.routeModules} route module(s)`;

    return {
      name: "routes",
      status: "ok",
      detail: `${context.totalRoutes} registered (${breakdown})`,
    };
  },
};
